import type { Run } from "../schemas/run.schema.js";
import type { Task } from "../schemas/task.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import type { LoadedRule } from "../schemas/rule.schema.js";
import type { ValidationResult } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import type { Planner } from "../planner/planner.js";
import type { PlannerMode } from "../planner/planner-registry.js";
import type { EventType } from "../schemas/event.schema.js";
import { createRunEvent } from "../utils/event-factory.js";
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
import { ApprovalManager } from "../safety/approval-manager.js";
import { ProcessManager } from "./process-manager.js";
import { StepManager } from "./step-manager.js";
import { QualityGate } from "../quality/quality-gate.js";
import type { QualityGateResult } from "../schemas/quality.schema.js";
import { writeTextFile, ensureDir, atomicWriteJsonFile } from "../utils/fs.js";
import { getContextDir, getOutputsDir, dbPath } from "../utils/paths.js";
import { ProjectScanner } from "../context/project-scanner.js";
import { now } from "../utils/time.js";
import { commandExists } from "../utils/command-exists.js";
import path from "node:path";
import picocolors from "picocolors";
import { getEventBus } from "../ui/event-bus.js";
import type { UiEvent } from "../ui/event-bus.js";
import { DatabaseManager } from "./database-manager.js";
import { HookManager } from "./hook-manager.js";
import type { HookContext } from "./hook-manager.js";

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
  private approvalManager: ApprovalManager;
  private processManager: ProcessManager;
  private hookManager: HookManager;
  private databaseManager: DatabaseManager | null = null;

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
    this.approvalManager = new ApprovalManager({
      enabled: config.approval?.enabled,
      autoApprove: config.approval?.autoApprove,
    });
    this.processManager = new ProcessManager();
    this.hookManager = new HookManager(rootPath, config.hooks);
  }

  async initDatabase(): Promise<DatabaseManager> {
    const db = await DatabaseManager.create(dbPath(this.rootPath));
    this.databaseManager = db;
    this.runManager.setDatabase(db);
    this.stateManager.setDatabase(db);
    this.eventStore.setDatabase(db);
    return db;
  }

  getDatabase(): DatabaseManager | null {
    return this.databaseManager;
  }

  async executeRun(
    prompt: string,
    options?: {
      mode?: Run["mode"];
      template?: string;
      debug?: boolean;
      plannerMode?: PlannerMode;
      quality?: boolean;
      defaultExecutor?: string;
      approvalMode?: string;
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

    const beforeRunCtx: HookContext = { runId: run.runId };
    const beforeRunHooks = await this.hookManager.runBeforeRun(beforeRunCtx);
    for (const hook of beforeRunHooks) {
      if (hook.success) {
        await this.logManager.writeRuntime(run.runId, `Hook succeeded: ${hook.command}`);
      } else {
        await this.logManager.writeRuntime(
          run.runId,
          `Hook failed: ${hook.command}\n${hook.stderr}`,
        );
      }
    }

    console.log(picocolors.cyan("\n  Planning..."));
    if (usePlanner && (options?.plannerMode === "ai" || options?.plannerMode === "auto")) {
      const plannerType = this.config.planner?.type ?? "internal-ai";
      const isExternal = plannerType === "external-ai";
      const startedEvent: EventType = isExternal
        ? "ai_planner_started"
        : "internal_ai_planner_started";
      const passedEvent: EventType = isExternal
        ? "ai_planner_validation_passed"
        : "internal_ai_planner_validation_passed";
      const failedEvent: EventType = isExternal
        ? "ai_planner_validation_failed"
        : "internal_ai_planner_validation_failed";
      const repairFailedEvent: EventType = isExternal
        ? "ai_planner_repair_failed"
        : "internal_ai_planner_repair_failed";
      const fallbackEvent: EventType = isExternal
        ? "ai_planner_fallback_to_simple"
        : "internal_ai_planner_fallback_to_simple";

      await this.eventStore.appendToRun(
        run.runId,
        createRunEvent(startedEvent, { runId: run.runId }),
      );
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

      console.log(picocolors.dim("  Scanning project for relevant files..."));
      let projectFilesContext: string | undefined;
      try {
        const scanner = new ProjectScanner();
        const result = await scanner.scan(this.rootPath, prompt);
        if (result.context) {
          projectFilesContext = result.context;
          console.log(picocolors.dim(`    Found ${result.matchedFiles.length} relevant file(s)`));
          await this.logManager.writeRuntime(
            run.runId,
            `Project scan matched files: ${result.matchedFiles.map((f) => f.relativePath).join(", ")}`,
          );
        } else {
          console.log(picocolors.dim("    No relevant files found"));
        }
      } catch (scanErr) {
        console.log(
          picocolors.dim(
            `    Project scan skipped: ${scanErr instanceof Error ? scanErr.message : String(scanErr)}`,
          ),
        );
      }

      try {
        planResult = await usePlanner.createPlan({
          projectRoot: this.rootPath,
          prompt,
          rulesContext,
          template: options?.template,
          projectFilesContext,
          availableExecutors,
          runId: run.runId,
        });
        await this.eventStore.appendToRun(
          run.runId,
          createRunEvent(passedEvent, {
            runId: run.runId,
            message: `Planner created ${planResult.tasks.length} tasks`,
          }),
        );
        if (debug) console.log(picocolors.yellow(`[debug] Planner used`));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await this.eventStore.appendToRun(
          run.runId,
          createRunEvent(errorMessage.includes("after repair") ? repairFailedEvent : failedEvent, {
            runId: run.runId,
            details: { error: errorMessage },
          }),
        );

        if (options?.plannerMode === "ai") {
          console.log(picocolors.red(`\n  Planner failed: ${errorMessage}`));
          console.log(
            picocolors.yellow(
              "  Run with --planner simple to skip AI planning, or check the raw output in .flowtask/runs/<runId>/outputs/",
            ),
          );
          throw err;
        }

        await this.eventStore.appendToRun(
          run.runId,
          createRunEvent(fallbackEvent, { runId: run.runId, details: { error: errorMessage } }),
        );

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

    if (options?.approvalMode) {
      const mode = options.approvalMode;
      if (mode === "auto") {
        this.config = { ...this.config, approval: { ...this.config.approval!, autoApprove: true } };
        this.approvalManager.setConfig({ autoApprove: true });
      } else if (mode === "skip") {
        this.config = { ...this.config, approval: { ...this.config.approval!, enabled: false } };
        this.approvalManager.setConfig({ enabled: false });
      }
      // "manual" is the default — no config change needed
    }

    const executorOverride = options?.defaultExecutor;
    const defaultExecutor = executorOverride ?? this.config.defaultExecutor ?? "shell";
    const tasksWithRunId = planResult.tasks.map((t) => {
      let executor = t.executor;
      if (executorOverride) {
        executor = executorOverride;
      } else if (!this.executorRegistry.has(t.executor)) {
        executor = defaultExecutor;
        console.log(
          picocolors.yellow(
            `  Task "${t.title}" uses unknown executor "${t.executor}", falling back to "${defaultExecutor}"`,
          ),
        );
      } else if (
        t.executor === "shell" &&
        (!t.validation?.commands || t.validation.commands.length === 0) &&
        defaultExecutor !== "shell"
      ) {
        executor = defaultExecutor;
        console.log(
          picocolors.dim(
            `  Task "${t.title}" has shell executor with no commands, using "${defaultExecutor}" instead`,
          ),
        );
      }
      return { ...t, executor, runId: run.runId };
    });

    // Check command executors exist; fall back to default if not
    for (const task of tasksWithRunId) {
      if (executorOverride) {
        task.executor = executorOverride;
        continue;
      }
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
          await this.eventStore.appendToRun(
            run.runId,
            createRunEvent(event.type as EventType, {
              runId: event.runId ?? run.runId,
              taskId: "taskId" in event ? event.taskId : undefined,
              details: { ...event },
            }),
          );
        } catch {
          // persistence is non-critical
        }
      }
    });

    await this.gitService.takeBeforeSnapshot(this.rootPath, run.runId);

    try {
      const { success: runSuccess, paused } = await this.executeTasks(
        run,
        prompt,
        rulesContext,
        updatedRun,
        tasksWithRunId,
      );

      if (paused) {
        const pausedRun = await this.runManager.updateRunStatus(run.runId, "paused");
        await this.eventStore.appendToRun(run.runId, {
          type: "run_paused",
          runId: run.runId,
          message: "Run paused for task approval",
        });
        await this.stateManager.saveProjectState({
          projectId: this.projectId,
          status: "has_running_run",
          activeRunId: run.runId,
          lastRunId: run.runId,
          updatedAt: now(),
        });
        await this.logManager.writeRuntime(run.runId, "Run paused for task approval");
        console.log(picocolors.yellow("\nRun paused. Approve or deny tasks to continue."));
        console.log(picocolors.dim("To resume: flowtask resume"));
        return { run: pausedRun, success: true };
      }

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

      const afterRunCtx: HookContext = { runId: run.runId, success: finalSuccess };
      const afterRunHooks = await this.hookManager.runAfterRun(afterRunCtx);
      for (const hook of afterRunHooks) {
        if (hook.success) {
          await this.logManager.writeRuntime(run.runId, `Hook succeeded: ${hook.command}`);
        } else {
          await this.logManager.writeRuntime(
            run.runId,
            `Hook failed: ${hook.command}\n${hook.stderr}`,
          );
        }
      }

      if (!finalSuccess) {
        const failCtx: HookContext = {
          runId: run.runId,
          error: "Run failed or quality check failed",
        };
        await this.hookManager.runOnFailure(failCtx);
      }

      const finalRun = finalSuccess
        ? await this.runManager.updateRunStatus(run.runId, "completed")
        : await this.runManager.updateRunStatus(run.runId, "failed");

      const finalTasks = await this.runManager.loadTasks(run.runId);
      const events = await this.eventStore.readRunEvents(finalRun.runId);
      const report = await new ReportGenerator().generate(
        finalRun,
        finalTasks,
        this.rootPath,
        events,
      );
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

  async continueRun(
    runId: string,
    _quality?: boolean,
  ): Promise<{ success: boolean; paused: boolean }> {
    // Kill any orphaned processes for this run before continuing
    await this.processManager.stop(this.rootPath, runId);

    const tasks = await this.runManager.loadTasks(runId);
    const pending = tasks.filter(
      (t) =>
        t.status === "pending" || t.status === "interrupted" || t.status === "waiting_approval",
    );

    if (pending.length === 0) {
      return { success: true, paused: false };
    }

    const run = await this.runManager.loadRun(runId);
    if (!run) return { success: false, paused: false };

    const prompt = await this.runManager.loadPrompt(runId);
    const rulesContext = await this.runManager.loadRulesContext(runId);

    const eventBus = getEventBus();
    const eventBusUnsubscribe = eventBus.subscribe(async (event: UiEvent) => {
      if ("runId" in event && event.runId !== runId) return;
      if (
        event.type === "executor_started" ||
        event.type === "executor_output" ||
        event.type === "executor_exited" ||
        event.type === "executor_failed"
      ) {
        try {
          await this.eventStore.appendToRun(
            runId,
            createRunEvent(event.type as EventType, {
              runId: event.runId ?? runId,
              taskId: "taskId" in event ? event.taskId : undefined,
              details: { ...event },
            }),
          );
        } catch {
          // persistence is non-critical
        }

        if (event.type === "executor_output" && "text" in event && event.text) {
          const text = event.text as string;
          for (const line of text.split("\n").filter(Boolean)) {
            console.log(`    ${picocolors.dim(line)}`);
          }
        }
      }
    });

    try {
      const { success: runSuccess, paused } = await this.executeTasks(
        run,
        prompt,
        rulesContext,
        run,
        tasks,
      );

      if (paused) {
        console.log(picocolors.yellow("\nRun paused for task approval."));
        console.log(
          picocolors.dim("Use: flowtask tasks-approve <taskId> or flowtask tasks-deny <taskId>"),
        );
      } else if (runSuccess) {
        console.log(picocolors.green("\n✓ Run completed"));
      } else {
        console.log(picocolors.red("\n✗ Run failed"));
      }

      return { success: runSuccess, paused };
    } finally {
      eventBusUnsubscribe();
    }
  }

  async executeSingleTask(runId: string, taskId: string): Promise<boolean> {
    // Kill any orphaned processes for this run before executing
    await this.processManager.stop(this.rootPath, runId);

    const tasks = await this.runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return false;

    const run = await this.runManager.loadRun(runId);
    if (!run) return false;

    const prompt = await this.runManager.loadPrompt(runId);
    const rulesContext = await this.runManager.loadRulesContext(runId);

    const eventBus = getEventBus();
    const eventBusUnsubscribe = eventBus.subscribe(async (event: UiEvent) => {
      if ("runId" in event && event.runId !== runId) return;
      if (
        event.type === "executor_started" ||
        event.type === "executor_output" ||
        event.type === "executor_exited" ||
        event.type === "executor_failed"
      ) {
        try {
          await this.eventStore.appendToRun(
            runId,
            createRunEvent(event.type as EventType, {
              runId: event.runId ?? runId,
              taskId: "taskId" in event ? event.taskId : undefined,
              details: { ...event },
            }),
          );
        } catch {
          // persistence is non-critical
        }

        if (event.type === "executor_output" && "text" in event && event.text) {
          const text = event.text as string;
          for (const line of text.split("\n").filter(Boolean)) {
            console.log(`    ${picocolors.dim(line)}`);
          }
        }
      }
    });

    try {
      const result = await this.executeTask(run, prompt, rulesContext, task, tasks);
      return result;
    } finally {
      eventBusUnsubscribe();
    }
  }

  private async executeTasks(
    run: Run,
    prompt: string,
    rulesContext: string,
    _updatedRun: Run,
    tasks: Task[],
  ): Promise<{ success: boolean; paused: boolean }> {
    let runSuccess = true;
    const isManual = run.mode === "manual";
    const autoApprove = this.config.approval?.autoApprove ?? false;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      if (
        task.status !== "pending" &&
        task.status !== "interrupted" &&
        task.status !== "waiting_approval"
      )
        continue;

      const depsMet = task.dependsOn.every((depId) => {
        const depTask = tasks.find((t) => t.id === depId);
        return depTask && (depTask.status === "done" || depTask.status === "skipped");
      });

      if (!depsMet) {
        console.log(
          picocolors.yellow(
            `  [${i + 1}/${tasks.length}] ${task.title} — waiting for dependencies`,
          ),
        );
        continue;
      }

      if (isManual && !autoApprove) {
        // In interactive TTY mode, prompt the user inline
        if (process.stdin.isTTY) {
          const approved = await this.approvalManager.requestApproval({
            taskId: task.id,
            command: "",
            reason: `Task: ${task.title}`,
            stepTitle: task.title,
          });

          if (!approved) {
            await this.runManager.updateTaskStatus(run.runId, task.id, "skipped");
            await this.logManager.writeTaskLog(run.runId, task.id, "Task skipped by user");
            console.log(picocolors.yellow(`  Task skipped: ${task.title}`));
            continue;
          }
        } else {
          // Non-TTY: pause and wait for external approval
          await this.runManager.updateTaskStatus(run.runId, task.id, "waiting_approval");
          console.log(
            picocolors.cyan(`\n  [${i + 1}/${tasks.length}] ${task.title} — awaiting approval`),
          );
          console.log(picocolors.dim(`    Use: flowtask tasks-approve ${task.id}`));
          console.log(picocolors.dim(`    Use: flowtask tasks-deny ${task.id}`));
          console.log(picocolors.dim(`    Or set mode to auto to bypass approval`));
          return { success: true, paused: true };
        }
      }

      const beforeTaskCtx: HookContext = {
        runId: run.runId,
        taskId: task.id,
        taskTitle: task.title,
      };
      const beforeTaskHooks = await this.hookManager.runBeforeTask(beforeTaskCtx);
      for (const hook of beforeTaskHooks) {
        if (!hook.success) {
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            `Hook failed: ${hook.command}\n${hook.stderr}`,
          );
        }
      }

      const success = await this.executeTask(run, prompt, rulesContext, task, tasks);

      task.status = success ? "done" : "failed";

      const afterTaskCtx: HookContext = {
        runId: run.runId,
        taskId: task.id,
        taskTitle: task.title,
        success,
      };
      const afterTaskHooks = await this.hookManager.runAfterTask(afterTaskCtx);
      for (const hook of afterTaskHooks) {
        if (!hook.success) {
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            `Hook failed: ${hook.command}\n${hook.stderr}`,
          );
        }
      }

      if (!success) {
        const action = await this.approvalManager.requestStepFailureResolution({
          taskId: task.id,
          taskTitle: task.title,
        });

        if (action === "retry") {
          task.retryCount = 0;
          task.status = "pending";
          await this.runManager.updateTaskStatus(run.runId, task.id, "pending");
          await this.runManager.saveTasks(run.runId, tasks);
          await this.logManager.writeTaskLog(run.runId, task.id, "User chose to retry the task");
          console.log(picocolors.cyan(`  User chose to retry: ${task.title}`));
          i--;
          continue;
        }

        if (action === "skip") {
          await this.runManager.updateTaskStatus(run.runId, task.id, "skipped");
          await this.eventStore.appendToRun(run.runId, {
            type: "task_skipped",
            runId: run.runId,
            taskId: task.id,
            message: `Task skipped by user: ${task.title}`,
          });
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            "Task skipped by user after failure",
          );
          console.log(picocolors.yellow(`  Task skipped: ${task.title}`));
          continue;
        }

        runSuccess = false;
        break;
      }
    }

    return { success: runSuccess, paused: false };
  }

  private async resolveStepApprovals(run: Run, task: Task): Promise<boolean> {
    const stepManager = new StepManager(this.rootPath);
    const steps = await stepManager.loadSteps(run.runId, task.id);
    if (steps.length === 0) return true;

    const pendingApproval = steps.filter(
      (s) => s.status === "pending_approval" && s.requiresApproval,
    );
    if (pendingApproval.length === 0) return true;

    const autoApprove = this.config.approval?.autoApprove ?? false;
    const approvalEnabled = this.config.approval?.enabled ?? true;

    if (!approvalEnabled || autoApprove) {
      for (const step of pendingApproval) {
        await stepManager.approveStep(run.runId, task.id, step.id);
        await this.logManager.writeTaskLog(run.runId, task.id, `Step ${step.id} auto-approved`);
      }
      return true;
    }

    if (!process.stdin.isTTY) {
      for (const step of pendingApproval) {
        await stepManager.denyStep(run.runId, task.id, step.id);
        await this.logManager.writeTaskLog(
          run.runId,
          task.id,
          `Step ${step.id} denied (non-TTY, approval needed)`,
        );
      }
      return false;
    }

    for (const step of pendingApproval) {
      const approved = await this.approvalManager.requestApproval({
        taskId: task.id,
        stepId: step.id,
        stepTitle: step.title,
        command: step.command ?? "",
        reason: step.approvalReason ?? "This step requires approval",
      });

      if (approved) {
        await stepManager.approveStep(run.runId, task.id, step.id);
        await this.logManager.writeTaskLog(run.runId, task.id, `Step ${step.id} approved`);
      } else {
        await stepManager.denyStep(run.runId, task.id, step.id);
        await this.logManager.writeTaskLog(run.runId, task.id, `Step ${step.id} denied`);
      }
    }

    const updatedSteps = await stepManager.loadSteps(run.runId, task.id);
    const allDenied = pendingApproval.every((s) => {
      const current = updatedSteps.find((st) => st.id === s.id);
      return current?.status === "denied";
    });

    return !allDenied;
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

    const stepApproved = await this.resolveStepApprovals(run, task);
    if (!stepApproved) {
      await this.runManager.updateTaskStatus(run.runId, task.id, "skipped");
      await this.eventStore.appendToRun(run.runId, {
        type: "task_skipped",
        runId: run.runId,
        taskId: task.id,
        message: `Task skipped: all steps denied approval`,
      });
      await this.logManager.writeTaskLog(run.runId, task.id, "Task skipped: all steps denied");
      console.log(picocolors.yellow(`  Task skipped: all steps denied approval`));
      return false;
    }

    let executorResult: ExecutorResult;
    let validationResult: ValidationResult | null = null;
    let retryCount = 0;
    let additionalRetryCount = 0;
    const maxRetries = task.maxRetries;
    const MAX_ADDITIONAL_RETRIES = 3;

    try {
      do {
        if (task.validation?.commands) {
          for (const cmd of task.validation.commands) {
            const safetyResult = this.safetyChecker.check(cmd);
            if (safetyResult.riskLevel === "blocked") {
              await this.eventStore.appendToRun(run.runId, {
                type: "command_blocked",
                runId: run.runId,
                taskId: task.id,
                message: `Command blocked: ${safetyResult.reason}`,
              });
              await this.runManager.updateTaskStatus(run.runId, task.id, "failed");
              await this.logManager.writeTaskLog(
                run.runId,
                task.id,
                `Command blocked: ${safetyResult.reason}`,
              );
              console.log(picocolors.red(`  Command blocked: ${safetyResult.reason}`));
              return false;
            }
            if (safetyResult.riskLevel === "risky") {
              await this.logManager.writeTaskLog(
                run.runId,
                task.id,
                `Command flagged as risky: ${safetyResult.reason}`,
              );
              console.log(picocolors.yellow(`  Command flagged as risky: ${safetyResult.reason}`));
            }
          }
        }

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

          console.log(picocolors.dim(`    Running (${executor.name})...`));

          executorResult = await executor.execute({
            projectRoot: this.rootPath,
            runId: run.runId,
            task,
            contextPackPath,
            contextPackContent: contextPack.markdown,
            signal: abortController.signal,
          });

          await this.eventStore.appendToRun(run.runId, {
            type:
              executorResult.status === "done"
                ? "executor_completed"
                : executorResult.status === "skipped"
                  ? "executor_completed"
                  : "executor_failed",
            runId: run.runId,
            taskId: task.id,
            details: { exitCode: executorResult.exitCode },
          });
        }

        if (executorResult.status === "skipped") {
          await this.runManager.updateTaskStatus(run.runId, task.id, "skipped");
          await this.eventStore.appendToRun(run.runId, {
            type: "task_skipped",
            runId: run.runId,
            taskId: task.id,
            message: `Task skipped: ${task.title}`,
          });
          console.log(picocolors.yellow(`  Task skipped: ${task.title}`));
          return false;
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

        const hasOutcomeCheck = validationResult.checks.some(
          (c) => c.type === "outcome_comparison",
        );
        const adaptiveLabel = hasOutcomeCheck ? "Adaptive validation" : "Validation";

        await this.eventStore.appendToRun(run.runId, {
          type: validationResult.status === "passed" ? "validation_passed" : "validation_failed",
          runId: run.runId,
          taskId: task.id,
          details: {
            checkCount: validationResult.checks.length,
            adaptiveValidation: hasOutcomeCheck,
          },
        });

        const failedChecks = validationResult.checks.filter((c) => c.status === "failed");
        const warningChecks = validationResult.checks.filter((c) => c.status === "warning");
        for (const check of failedChecks) {
          console.log(picocolors.red(`  ${adaptiveLabel}: ${check.message}`));
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            `Validation failed: ${check.message}`,
          );
        }
        for (const check of warningChecks) {
          const level = check.type === "outcome_comparison" ? picocolors.yellow : picocolors.dim;
          console.log(level(`  ${check.message}`));
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            `Validation warning: ${check.message}`,
          );
        }

        if (validationResult.status === "passed") {
          const message = hasOutcomeCheck
            ? "Status: done (adaptive validation — outcome achieved)"
            : "Status: done (all validations passed)";
          console.log(picocolors.green(`  ${message}`));
          break;
        }

        if (validationResult.status === "warning" && failedChecks.length === 0) {
          const message = hasOutcomeCheck
            ? "Status: done (outcome achieved with minor warnings)"
            : "Status: done (validations passed with warnings)";
          console.log(picocolors.yellow(`  ${message}`));
          break;
        }

        if (hasOutcomeCheck) {
          const outcomeFailed = validationResult.checks.find(
            (c) => c.type === "outcome_comparison" && c.status === "failed",
          );
          if (outcomeFailed) {
            console.log(picocolors.red(`  Outcome not achieved: ${outcomeFailed.message}`));
            await this.logManager.writeTaskLog(
              run.runId,
              task.id,
              `Adaptive validation: expected outcome not achieved: ${task.expectedResult}`,
            );
          }
        }

        const isSpawnError = executorResult.exitCode === undefined;
        const errMsg = executorResult.error ?? "";
        const isBinaryMissing =
          isSpawnError &&
          (errMsg.includes("ENOENT") ||
            errMsg.includes("not found") ||
            errMsg.includes("No such file"));
        if (isBinaryMissing) {
          const defaultExecutor = this.config.defaultExecutor ?? "shell";
          if (defaultExecutor === task.executor) {
            console.log(
              picocolors.red(
                `  Executor "${task.executor}" not found and default executor is the same. Giving up.`,
              ),
            );
            await this.runManager.updateTaskStatus(run.runId, task.id, "failed");
            await this.eventStore.appendToRun(run.runId, {
              type: "task_failed",
              runId: run.runId,
              taskId: task.id,
              message: `Task failed: ${task.title}`,
            });
            return false;
          }
          console.log(
            picocolors.yellow(
              `  Executor "${task.executor}" not found, falling back to "${defaultExecutor}"`,
            ),
          );
          task.executor = defaultExecutor;
          retryCount = 0;
          continue;
        }

        retryCount++;

        if (retryCount >= 1) {
          const retryCtx: HookContext = {
            runId: run.runId,
            taskId: task.id,
            taskTitle: task.title,
            retryCount: retryCount - 1,
            maxRetries,
          };
          const afterRetryHooks = await this.hookManager.runAfterRetry(retryCtx);
          for (const hook of afterRetryHooks) {
            await this.logManager.writeTaskLog(
              run.runId,
              task.id,
              `Hook (afterRetry): ${hook.command} -> ${hook.success ? "ok" : "fail"}`,
            );
          }
        }

        if (retryCount <= maxRetries) {
          console.log(picocolors.yellow(`  Retrying (${retryCount}/${maxRetries})...`));
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            `Retry ${retryCount}/${maxRetries}`,
          );

          const beforeRetryCtx: HookContext = {
            runId: run.runId,
            taskId: task.id,
            taskTitle: task.title,
            retryCount,
            maxRetries,
          };
          const beforeRetryHooks = await this.hookManager.runBeforeRetry(beforeRetryCtx);
          for (const hook of beforeRetryHooks) {
            await this.logManager.writeTaskLog(
              run.runId,
              task.id,
              `Hook (beforeRetry): ${hook.command} -> ${hook.success ? "ok" : "fail"}`,
            );
          }
        } else {
          // Retry limit reached — ask user if they want to continue
          const retryApproved = await this.approvalManager.requestRetryApproval({
            taskId: task.id,
            taskTitle: task.title,
            retryCount,
            maxRetries,
          });

          if (retryApproved) {
            additionalRetryCount++;
            if (additionalRetryCount > MAX_ADDITIONAL_RETRIES) {
              console.log(
                picocolors.red(
                  `  Max additional retries (${MAX_ADDITIONAL_RETRIES}) reached. Giving up.`,
                ),
              );
              await this.logManager.writeTaskLog(
                run.runId,
                task.id,
                `Max additional retries (${MAX_ADDITIONAL_RETRIES}) reached. Giving up.`,
              );
              break;
            }
            console.log(
              picocolors.cyan(`  User approved additional retry (${retryCount}/${maxRetries})...`),
            );
            await this.logManager.writeTaskLog(
              run.runId,
              task.id,
              `User approved retry beyond limit: ${retryCount}/${maxRetries}`,
            );
            retryCount = 0; // reset retry counter

            const beforeRetryCtx: HookContext = {
              runId: run.runId,
              taskId: task.id,
              taskTitle: task.title,
              retryCount,
              maxRetries,
            };
            const beforeRetryHooks = await this.hookManager.runBeforeRetry(beforeRetryCtx);
            for (const hook of beforeRetryHooks) {
              await this.logManager.writeTaskLog(
                run.runId,
                task.id,
                `Hook (beforeRetry): ${hook.command} -> ${hook.success ? "ok" : "fail"}`,
              );
            }
          }
        }
      } while (retryCount <= maxRetries);
    } finally {
      this.processManager.clear(this.rootPath, run.runId);
    }

    if (
      validationResult &&
      (validationResult.status === "passed" || validationResult.status === "warning")
    ) {
      const hasOutcomeCheck = validationResult.checks.some((c) => c.type === "outcome_comparison");
      const completedMsg = hasOutcomeCheck
        ? "Task completed: expected outcome achieved"
        : "Task completed successfully";
      await this.runManager.updateTaskStatus(run.runId, task.id, "done");
      await this.eventStore.appendToRun(run.runId, {
        type: "task_completed",
        runId: run.runId,
        taskId: task.id,
        message: completedMsg,
      });
      await this.logManager.writeTaskLog(run.runId, task.id, completedMsg);
      return true;
    }

    await this.runManager.updateTaskStatus(run.runId, task.id, "failed");
    await this.eventStore.appendToRun(run.runId, {
      type: "task_failed",
      runId: run.runId,
      taskId: task.id,
      message: `Task failed: ${task.title}`,
    });

    const adaptivePrefix = validationResult?.checks.some((c) => c.type === "outcome_comparison")
      ? "Adaptive validation failed"
      : "Task failed";
    console.log(picocolors.red(`\n  ${adaptivePrefix}: ${task.title}`));
    if (validationResult) {
      const failed = validationResult.checks.filter((c) => c.status === "failed");
      for (const check of failed) {
        console.log(picocolors.red(`    ${check.type}: ${check.message}`));
      }
      const outcomeCheck = validationResult.checks.find((c) => c.type === "outcome_comparison");
      if (outcomeCheck && outcomeCheck.details?.resultType) {
        console.log(
          picocolors.yellow(`    (detected task type: ${outcomeCheck.details.resultType})`),
        );
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
