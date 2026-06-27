import type { Run } from "../schemas/run.schema.js";
import type { Task } from "../schemas/task.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import type { LoadedRule } from "../schemas/rule.schema.js";
import type { ValidationResult } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import type { Planner } from "../planner/planner.js";
import type { PlannerMode } from "../planner/planner-registry.js";
import { RunManager } from "./run-manager.js";
import { StateManager } from "./state-manager.js";
import { EventStore } from "./event-store.js";
import { LogManager } from "./log-manager.js";
import { ReportGenerator } from "./report-generator.js";
import { RuleLoader } from "../rules/rule-loader.js";
import { ContextPackBuilder } from "../context/context-pack-builder.js";
import { ValidationEngine } from "../validation/validation-engine.js";
import { ExecutorRegistry } from "../executor/executor-registry.js";
import { GitService } from "../git/git-service.js";
import { SafetyChecker } from "../safety/safety-checker.js";
import { ProcessManager } from "./process-manager.js";
import { QualityGate } from "../quality/quality-gate.js";
import type { QualityGateResult } from "../schemas/quality.schema.js";
import { writeTextFile, ensureDir, atomicWriteJsonFile } from "../utils/fs.js";
import { getContextDir, getOutputsDir } from "../utils/paths.js";
import { now } from "../utils/time.js";
import { commandExists } from "../utils/command-exists.js";
import path from "node:path";
import picocolors from "picocolors";
import { getEventBus } from "../ui/event-bus.js";
import type { UiEvent } from "../ui/event-bus.js";

export class RunLifecycle {
  private rootPath: string;
  private projectId: string;
  private config: FlowTaskConfig;
  private runManager: RunManager;
  private stateManager: StateManager;
  private eventStore: EventStore;
  private logManager: LogManager;
  private ruleLoader: RuleLoader;
  private planner?: Planner;
  private contextPackBuilder: ContextPackBuilder;
  private validationEngine: ValidationEngine;
  private executorRegistry: ExecutorRegistry;
  private gitService: GitService;
  private safetyChecker: SafetyChecker;
  private processManager: ProcessManager;

  constructor(rootPath: string, projectId: string, config: FlowTaskConfig, planner?: Planner) {
    this.rootPath = rootPath;
    this.projectId = projectId;
    this.config = config;
    this.runManager = new RunManager(rootPath);
    this.stateManager = new StateManager(rootPath);
    this.eventStore = new EventStore(rootPath);
    this.logManager = new LogManager(rootPath);
    this.ruleLoader = new RuleLoader();
    this.planner = planner;
    this.contextPackBuilder = new ContextPackBuilder();
    this.validationEngine = new ValidationEngine(config);
    this.executorRegistry = new ExecutorRegistry();
    this.executorRegistry.setLogManager(this.logManager);
    this.gitService = new GitService();
    this.safetyChecker = new SafetyChecker();
    this.processManager = new ProcessManager();
  }

  async executeRun(
    prompt: string,
    options?: {
      mode?: Run["mode"];
      template?: string;
      debug?: boolean;
      plannerMode?: PlannerMode;
      quality?: boolean;
    },
  ): Promise<{ run: Run; success: boolean }> {
    const mode = options?.mode ?? "auto";
    const debug = options?.debug ?? false;

    const run = await this.runManager.createRun(this.projectId, prompt, mode);
    await this.eventStore.appendToRun(run.runId, {
      type: "run_created",
      runId: run.runId,
      message: `Run created: ${run.title}`,
    });

    await this.logManager.writeRuntime(run.runId, `Run started: ${run.title}`);
    console.log(picocolors.cyan(`\nFlowTask Run: ${run.title}`));
    console.log(picocolors.dim(`Run ID: ${run.runId}`));
    console.log(picocolors.dim(`Mode: ${mode}\n`));

    if (debug) {
      console.log(picocolors.yellow(`[debug] Project: ${this.projectId}`));
      console.log(picocolors.yellow(`[debug] Root: ${this.rootPath}`));
    }

    let updatedRun = await this.runManager.updateRunStatus(run.runId, "planning");
    await this.runManager.savePrompt(run.runId, prompt);

    console.log(picocolors.dim("  Loading rules..."));
    const rules: LoadedRule[] = await this.ruleLoader.loadRules(this.rootPath, this.config.rules);
    const rulesContext = this.ruleLoader.mergeRules(rules);
    await this.runManager.saveRulesContext(run.runId, rulesContext);
    console.log(picocolors.dim(`  ${rules.length} rules loaded`));
    await this.eventStore.appendToRun(run.runId, {
      type: "rules_loaded",
      runId: run.runId,
      details: { count: rules.length },
    });

    if (debug) {
      console.log(picocolors.yellow(`[debug] Rules loaded: ${rules.length}`));
    }

    const usePlanner = this.planner;
    let planResult;

    console.log(picocolors.cyan("\n  Planning..."));
    if (usePlanner && (options?.plannerMode === "ai" || options?.plannerMode === "auto")) {
      const plannerType = this.config.planner?.type ?? "internal-ai";
      const isExternal = plannerType === "external-ai";
      const startedEvent = isExternal ? "ai_planner_started" : "internal_ai_planner_started";
      const passedEvent = isExternal
        ? "ai_planner_validation_passed"
        : "internal_ai_planner_validation_passed";
      const failedEvent = isExternal
        ? "ai_planner_validation_failed"
        : "internal_ai_planner_validation_failed";
      const repairFailedEvent = isExternal
        ? "ai_planner_repair_failed"
        : "internal_ai_planner_repair_failed";
      const fallbackEvent = isExternal
        ? "ai_planner_fallback_to_simple"
        : "internal_ai_planner_fallback_to_simple";

      await this.eventStore.appendToRun(run.runId, {
        type: startedEvent as never,
        runId: run.runId,
      });
      const executors = this.config.executors ?? {};
      const availableExecutors = (
        await Promise.all(
          Object.entries(executors).map(async ([name, cfg]) => {
            if (cfg.type === "shell" || cfg.type === "manual") return name;
            if (cfg.type === "command" && cfg.command) {
              const exists = await commandExists(cfg.command);
              return exists ? name : null;
            }
            return name;
          }),
        )
      ).filter((n): n is string => n !== null);

      try {
        planResult = await usePlanner.createPlan({
          projectRoot: this.rootPath,
          prompt,
          rulesContext,
          template: options?.template,
          availableExecutors,
          runId: run.runId,
        });
        await this.eventStore.appendToRun(run.runId, {
          type: passedEvent as never,
          runId: run.runId,
          message: `Planner created ${planResult.tasks.length} tasks`,
        });
        if (debug) console.log(picocolors.yellow(`[debug] Planner used`));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await this.eventStore.appendToRun(run.runId, {
          type: (errorMessage.includes("after repair") ? repairFailedEvent : failedEvent) as never,
          runId: run.runId,
          details: { error: errorMessage },
        });

        if (options?.plannerMode === "ai") {
          console.log(picocolors.red(`\n  Planner failed: ${errorMessage}`));
          console.log(
            picocolors.yellow(
              "  Run with --planner simple to skip AI planning, or check the raw output in .flowtask/runs/<runId>/outputs/",
            ),
          );
          throw err;
        }

        await this.eventStore.appendToRun(run.runId, {
          type: fallbackEvent as never,
          runId: run.runId,
          details: { error: errorMessage },
        });

        console.log(picocolors.yellow(`\n  Planner still returned invalid output after retry.`));
        console.log(
          picocolors.yellow(`  Falling back to simple planner because planner mode is "auto".`),
        );
        console.log(picocolors.dim(`  Tip: Run with --planner simple to skip AI planning.`));
        console.log(
          picocolors.dim(`  Tip: Run with --planner ai to fail instead of falling back.`),
        );
      }
    }

    if (!planResult) {
      const { SimplePlanner } = await import("../planner/simple-planner.js");
      const simplePlanner = new SimplePlanner();
      planResult = await simplePlanner.createPlan({
        projectRoot: this.rootPath,
        prompt,
        rulesContext,
        template: options?.template,
      });
    }

    await this.runManager.savePlan(run.runId, planResult.planMarkdown);
    console.log(picocolors.green(`  Plan created: ${planResult.tasks.length} tasks`));

    const defaultExecutor = this.config.defaultExecutor ?? "shell";
    const tasksWithRunId = planResult.tasks.map((t) => {
      const executor = this.executorRegistry.has(t.executor) ? t.executor : defaultExecutor;
      if (executor !== t.executor) {
        console.log(
          picocolors.yellow(
            `  Task "${t.title}" uses unknown executor "${t.executor}", falling back to "${defaultExecutor}"`,
          ),
        );
      }
      return { ...t, executor, runId: run.runId };
    });

    // Check command executors exist; fall back to default if not
    for (const task of tasksWithRunId) {
      const cfg = this.executorRegistry.getConfig(task.executor);
      if (cfg && cfg.type === "command" && cfg.command) {
        const exists = await commandExists(cfg.command);
        if (!exists) {
          console.log(
            picocolors.yellow(
              `  Task "${task.title}" uses executor "${task.executor}" (command "${cfg.command}" not found), falling back to "${defaultExecutor}"`,
            ),
          );
          task.executor = defaultExecutor;
        }
      }
    }

    await this.runManager.saveTasks(run.runId, tasksWithRunId);

    updatedRun = await this.runManager.updateRunStatus(run.runId, "running");
    updatedRun = { ...updatedRun, taskCount: tasksWithRunId.length };
    await this.runManager.saveRun(updatedRun);

    await this.eventStore.appendToRun(run.runId, {
      type: "run_started",
      runId: run.runId,
      message: `Run started with ${tasksWithRunId.length} tasks`,
    });

    const isPlanOnly = mode === "plan-only";
    const isDryRun = mode === "dry-run";

    await this.stateManager.saveProjectState({
      projectId: this.projectId,
      status: isPlanOnly || isDryRun ? "idle" : "has_running_run",
      activeRunId: isPlanOnly || isDryRun ? undefined : run.runId,
      lastRunId: run.runId,
      updatedAt: now(),
    });

    if (isPlanOnly) {
      console.log(picocolors.yellow("\nPlan-only mode. Tasks generated but not executed.\n"));
      console.log(planResult.planMarkdown);
      await this.runManager.updateRunStatus(run.runId, "planning");
      return { run: { ...updatedRun, status: "planning" }, success: true };
    }

    if (isDryRun) {
      console.log(picocolors.yellow("\nDry-run mode. Showing what would happen:\n"));
      for (let i = 0; i < tasksWithRunId.length; i++) {
        const t = tasksWithRunId[i]!;
        console.log(`  [${i + 1}/${tasksWithRunId.length}] ${t.title} (executor: ${t.executor})`);
      }
      await this.runManager.updateRunStatus(run.runId, "planning");
      return { run: { ...updatedRun, status: "planning" }, success: true };
    }

    const eventBus = getEventBus();
    const eventBusUnsubscribe = eventBus.subscribe(async (event: UiEvent) => {
      if ("runId" in event && event.runId !== run.runId) return;
      if (
        event.type === "executor_started" ||
        event.type === "executor_output" ||
        event.type === "executor_exited" ||
        event.type === "executor_failed"
      ) {
        try {
          const storeEvent = {
            type: event.type,
            runId: event.runId ?? run.runId,
            taskId: "taskId" in event ? event.taskId : undefined,
            details: { ...event },
          } as never;
          await this.eventStore.appendToRun(run.runId, storeEvent);
        } catch {
          // persistence is non-critical
        }
      }
    });

    await this.gitService.takeBeforeSnapshot(this.rootPath, run.runId);

    try {
      const runSuccess = await this.executeTasks(
        run,
        prompt,
        rulesContext,
        updatedRun,
        tasksWithRunId,
      );

      await this.gitService.takeAfterSnapshot(this.rootPath, run.runId);

      const shouldRunQuality = options?.quality ?? this.config.quality.enabledByDefault ?? false;
      let qualityPassed = true;
      if (runSuccess && shouldRunQuality) {
        const qResult = await this.runQualityGate(run.runId, true, this.config.quality.commands);
        if (qResult && qResult.status !== "passed") {
          qualityPassed = false;
        }
      }

      const finalSuccess = runSuccess && qualityPassed;
      const finalRun = finalSuccess
        ? await this.runManager.updateRunStatus(run.runId, "completed")
        : await this.runManager.updateRunStatus(run.runId, "failed");

      const finalTasks = await this.runManager.loadTasks(run.runId);
      const report = new ReportGenerator().generate(finalRun, finalTasks);
      const reportMarkdown = new ReportGenerator().generateMarkdown(report);
      await this.runManager.saveFinalReport(run.runId, reportMarkdown);

      await this.eventStore.appendToRun(run.runId, {
        type: runSuccess ? "run_completed" : "run_failed",
        runId: run.runId,
        message: `Run ${runSuccess ? "completed" : "failed"}`,
      });

      if (runSuccess) {
        console.log(picocolors.green(`\n✓ Run completed successfully`));
      } else {
        console.log(picocolors.red(`\n✗ Run failed`));
      }
      console.log(picocolors.dim(`Report: ${run.runId}/final-report.md\n`));

      const state = await this.stateManager.loadProjectState();
      if (state) {
        await this.stateManager.saveProjectState({
          ...state,
          status: runSuccess ? "idle" : "has_failed_run",
          activeRunId: runSuccess ? undefined : run.runId,
          lastRunId: run.runId,
        });
      }

      return { run: finalRun, success: runSuccess };
    } finally {
      eventBusUnsubscribe();
    }
  }

  async continueRun(runId: string, _quality?: boolean): Promise<{ success: boolean }> {
    const tasks = await this.runManager.loadTasks(runId);
    const pending = tasks.filter((t) => t.status === "pending" || t.status === "interrupted");

    if (pending.length === 0) {
      return { success: true };
    }

    const run = await this.runManager.loadRun(runId);
    if (!run) return { success: false };

    const prompt = await this.runManager.loadPrompt(runId);
    const rulesContext = await this.runManager.loadRulesContext(runId);

    const runSuccess = await this.executeTasks(run, prompt, rulesContext, run, tasks);

    if (runSuccess) {
      console.log(picocolors.green("\n✓ Run completed"));
    } else {
      console.log(picocolors.red("\n✗ Run failed"));
    }

    return { success: runSuccess };
  }

  async executeSingleTask(runId: string, taskId: string): Promise<boolean> {
    const tasks = await this.runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return false;

    const run = await this.runManager.loadRun(runId);
    if (!run) return false;

    const prompt = await this.runManager.loadPrompt(runId);
    const rulesContext = await this.runManager.loadRulesContext(runId);

    const result = await this.executeTask(run, prompt, rulesContext, task, tasks);
    return result;
  }

  private async executeTasks(
    run: Run,
    prompt: string,
    rulesContext: string,
    _updatedRun: Run,
    tasks: Task[],
  ): Promise<boolean> {
    let runSuccess = true;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      if (task.status !== "pending" && task.status !== "interrupted") continue;

      const depsMet = task.dependsOn.every((depId) => {
        const depTask = tasks.find((t) => t.id === depId);
        return depTask && depTask.status === "done";
      });

      if (!depsMet) {
        console.log(
          picocolors.yellow(
            `  [${i + 1}/${tasks.length}] ${task.title} — waiting for dependencies`,
          ),
        );
        continue;
      }

      const success = await this.executeTask(run, prompt, rulesContext, task, tasks);

      task.status = success ? "done" : "failed";

      if (!success) {
        runSuccess = false;
        break;
      }
    }

    return runSuccess;
  }

  private async executeTask(
    run: Run,
    prompt: string,
    rulesContext: string,
    task: Task,
    allTasks: Task[],
  ): Promise<boolean> {
    const taskIndex = allTasks.indexOf(task);
    const i = taskIndex >= 0 ? taskIndex : 0;

    await this.runManager.updateTaskStatus(run.runId, task.id, "running");

    const abortController = new AbortController();
    this.processManager.registerController(run.runId, abortController);

    await this.logManager.writeTaskLog(run.runId, task.id, `Task started: ${task.title}`);
    await this.eventStore.appendToRun(run.runId, {
      type: "task_started",
      runId: run.runId,
      taskId: task.id,
      message: `Task started: ${task.title}`,
    });

    console.log(picocolors.cyan(`\n  [${i + 1}/${allTasks.length}] ${task.title}`));

    const completedTasks = allTasks.filter((t) => t.status === "done" || t.status === "failed");

    const contextPack = this.contextPackBuilder.build({
      prompt,
      rulesContext,
      run,
      task,
      completedTasks,
      isRetry: false,
    });

    const contextDir = getContextDir(this.rootPath, run.runId);
    await ensureDir(contextDir);
    const contextPackPath = path.join(contextDir, `context-pack.${task.id}.md`);
    await writeTextFile(contextPackPath, contextPack.markdown);

    await this.eventStore.appendToRun(run.runId, {
      type: "context_pack_created",
      runId: run.runId,
      taskId: task.id,
    });

    let executorResult: ExecutorResult;
    let validationResult: ValidationResult | null = null;
    let retryCount = 0;
    const maxRetries = task.maxRetries;

    do {
      const executor = this.executorRegistry.get(task.executor);

      if (!executor) {
        console.log(
          picocolors.red(`\n  Unknown executor: "${task.executor}". Task cannot be executed.`),
        );
        console.log(
          picocolors.yellow(`  Configure "${task.executor}" in .flowtask/config.json executors.`),
        );
        await this.runManager.updateTaskStatus(run.runId, task.id, "failed");
        return false;
      } else {
        await this.eventStore.appendToRun(run.runId, {
          type: "executor_started",
          runId: run.runId,
          taskId: task.id,
          message: `Executor: ${executor.name}`,
        });

        executorResult = await executor.execute({
          projectRoot: this.rootPath,
          runId: run.runId,
          task,
          contextPackPath,
          contextPackContent: contextPack.markdown,
          signal: abortController.signal,
        });

        await this.eventStore.appendToRun(run.runId, {
          type: executorResult.status === "done" ? "executor_completed" : "executor_failed",
          runId: run.runId,
          taskId: task.id,
          details: { exitCode: executorResult.exitCode },
        });
      }

      await this.logManager.writeTaskLog(
        run.runId,
        task.id,
        `Executor finished with status: ${executorResult.status}, exit code: ${executorResult.exitCode}`,
      );

      if (executorResult.output) {
        await this.logManager.writeTaskLog(
          run.runId,
          task.id,
          `Output:\n${executorResult.output.slice(0, 2000)}`,
        );
      }
      if (executorResult.error) {
        await this.logManager.writeTaskLog(run.runId, task.id, `Error:\n${executorResult.error}`);
      }

      await this.eventStore.appendToRun(run.runId, {
        type: "validation_started",
        runId: run.runId,
        taskId: task.id,
      });

      validationResult = await this.validationEngine.validateTask({
        projectRoot: this.rootPath,
        task,
        executorResult,
      });

      await this.eventStore.appendToRun(run.runId, {
        type: validationResult.status === "passed" ? "validation_passed" : "validation_failed",
        runId: run.runId,
        taskId: task.id,
        details: { checkCount: validationResult.checks.length },
      });

      const failedChecks = validationResult.checks.filter((c) => c.status === "failed");
      for (const check of failedChecks) {
        console.log(picocolors.red(`  Validation failed: ${check.message}`));
        await this.logManager.writeTaskLog(
          run.runId,
          task.id,
          `Validation failed: ${check.message}`,
        );
      }

      if (validationResult.status === "passed") {
        console.log(picocolors.green(`  Status: done (all validations passed)`));
        break;
      }

      const errMsg = executorResult.error ?? "";
      const fatalError =
        errMsg.includes("ENOENT") ||
        errMsg.includes("not found") ||
        errMsg.includes("No such file");
      if (fatalError) {
        const defaultExecutor = this.config.defaultExecutor ?? "shell";
        console.log(
          picocolors.yellow(
            `  Executor "${task.executor}" not available, falling back to "${defaultExecutor}"`,
          ),
        );
        task.executor = defaultExecutor;
        retryCount = 0;
        continue;
      }

      retryCount++;
      if (retryCount <= maxRetries) {
        console.log(picocolors.yellow(`  Retrying (${retryCount}/${maxRetries})...`));
        await this.logManager.writeTaskLog(run.runId, task.id, `Retry ${retryCount}/${maxRetries}`);
      }
    } while (retryCount <= maxRetries);

    this.processManager.clear(this.rootPath, run.runId);

    if (validationResult && validationResult.status === "passed") {
      await this.runManager.updateTaskStatus(run.runId, task.id, "done");
      await this.eventStore.appendToRun(run.runId, {
        type: "task_completed",
        runId: run.runId,
        taskId: task.id,
        message: `Task completed: ${task.title}`,
      });
      await this.logManager.writeTaskLog(run.runId, task.id, "Task completed successfully");
      return true;
    }

    await this.runManager.updateTaskStatus(run.runId, task.id, "failed");
    await this.eventStore.appendToRun(run.runId, {
      type: "task_failed",
      runId: run.runId,
      taskId: task.id,
      message: `Task failed: ${task.title}`,
    });

    console.log(picocolors.red(`\n  Task failed: ${task.title}`));
    if (validationResult) {
      const failed = validationResult.checks.filter((c) => c.status === "failed");
      for (const check of failed) {
        console.log(picocolors.red(`    ${check.message}`));
      }
    }

    console.log(picocolors.yellow(`\n  Next steps:`));
    console.log(picocolors.yellow(`  - flowtask retry ${task.id}`));
    console.log(picocolors.yellow(`  - flowtask logs --task ${task.id}`));
    console.log(picocolors.yellow(`  - flowtask inspect ${run.runId}`));

    return false;
  }

  async flushLogs(): Promise<void> {
    await this.logManager.flush();
  }

  async runQualityGate(
    runId: string,
    qualityEnabled: boolean,
    commands: string[],
  ): Promise<QualityGateResult | null> {
    if (!qualityEnabled || commands.length === 0) {
      const now_ts = now();
      const result: QualityGateResult = {
        status: "skipped",
        commands: [],
        startedAt: now_ts,
        finishedAt: now_ts,
      };
      await atomicWriteJsonFile(
        path.join(getOutputsDir(this.rootPath, runId), "quality-results.json"),
        result,
      );
      return result;
    }

    console.log(picocolors.cyan("\n  Running quality gate..."));
    const gate = new QualityGate(this.config);
    const result = await gate.run(this.rootPath, runId, commands);

    await this.eventStore.appendToRun(runId, {
      type: result.status === "passed" ? "quality_completed" : "quality_failed",
      runId,
      details: { commandCount: commands.length, allPassed: result.status === "passed" },
    });

    if (result.status === "passed") {
      console.log(picocolors.green("  Quality gate: passed"));
    } else {
      console.log(picocolors.red("  Quality gate: failed"));
      for (const cmd of result.commands) {
        if (cmd.status !== "passed") {
          console.log(picocolors.red(`    ✗ ${cmd.command}`));
        }
      }
    }

    return result;
  }
}
