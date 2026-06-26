import type { Run } from "../schemas/run.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import type { LoadedRule } from "../schemas/rule.schema.js";
import type { ValidationResult } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import { RunManager } from "./run-manager.js";
import { StateManager } from "./state-manager.js";
import { EventStore } from "./event-store.js";
import { LogManager } from "./log-manager.js";
import { ReportGenerator } from "./report-generator.js";
import { RuleLoader } from "../rules/rule-loader.js";
import { SimplePlanner } from "../planner/simple-planner.js";
import { ContextPackBuilder } from "../context/context-pack-builder.js";
import { ValidationEngine } from "../validation/validation-engine.js";
import { ExecutorRegistry } from "../executor/executor-registry.js";
import { GitService } from "../git/git-service.js";
import { SafetyChecker } from "../safety/safety-checker.js";
import path from "node:path";
import { writeTextFile, ensureDir } from "../utils/fs.js";
import { getContextDir } from "../utils/paths.js";
import { now } from "../utils/time.js";
import picocolors from "picocolors";

export class RunLifecycle {
  private rootPath: string;
  private projectId: string;
  private config: FlowTaskConfig;
  private runManager: RunManager;
  private stateManager: StateManager;
  private eventStore: EventStore;
  private logManager: LogManager;
  private ruleLoader: RuleLoader;
  private planner: SimplePlanner;
  private contextPackBuilder: ContextPackBuilder;
  private validationEngine: ValidationEngine;
  private executorRegistry: ExecutorRegistry;
  private gitService: GitService;
  private safetyChecker: SafetyChecker;
  private reportGenerator: ReportGenerator;

  constructor(rootPath: string, projectId: string, config: FlowTaskConfig) {
    this.rootPath = rootPath;
    this.projectId = projectId;
    this.config = config;
    this.runManager = new RunManager(rootPath);
    this.stateManager = new StateManager(rootPath);
    this.eventStore = new EventStore(rootPath);
    this.logManager = new LogManager(rootPath);
    this.ruleLoader = new RuleLoader();
    this.planner = new SimplePlanner();
    this.contextPackBuilder = new ContextPackBuilder();
    this.validationEngine = new ValidationEngine();
    this.executorRegistry = new ExecutorRegistry();
    this.gitService = new GitService();
    this.safetyChecker = new SafetyChecker();
    this.reportGenerator = new ReportGenerator();
  }

  async executeRun(
    prompt: string,
    options?: { mode?: Run["mode"]; template?: string; debug?: boolean },
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

    const rules: LoadedRule[] = await this.ruleLoader.loadRules(this.rootPath, this.config.rules);
    const rulesContext = this.ruleLoader.mergeRules(rules);
    await this.runManager.saveRulesContext(run.runId, rulesContext);
    await this.eventStore.appendToRun(run.runId, {
      type: "rules_loaded",
      runId: run.runId,
      details: { count: rules.length },
    });

    if (debug) {
      console.log(picocolors.yellow(`[debug] Rules loaded: ${rules.length}`));
    }

    const planResult = await this.planner.createPlan({
      projectRoot: this.rootPath,
      prompt,
      rulesContext,
      template: options?.template,
    });

    await this.runManager.savePlan(run.runId, planResult.planMarkdown);

    const tasksWithRunId = planResult.tasks.map((t) => ({
      ...t,
      runId: run.runId,
    }));

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

    await this.gitService.takeBeforeSnapshot(this.rootPath, run.runId);

    const tasks = await this.runManager.loadTasks(run.runId);

    let runSuccess = true;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;

      if (task.status !== "pending") continue;

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

      console.log(picocolors.cyan(`\n  [${i + 1}/${tasks.length}] ${task.title}`));

      await this.runManager.updateTaskStatus(run.runId, task.id, "running");
      await this.logManager.writeTaskLog(run.runId, task.id, `Task started: ${task.title}`);
      await this.eventStore.appendToRun(run.runId, {
        type: "task_started",
        runId: run.runId,
        taskId: task.id,
        message: `Task started: ${task.title}`,
      });

      const completedTasks = tasks.filter((t) => t.status === "done" || t.status === "failed");

      const contextPack = this.contextPackBuilder.build({
        prompt,
        rulesContext,
        run: updatedRun,
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
          console.log(picocolors.red(`Unknown executor: ${task.executor}, falling back to shell`));
          const shellExecutor = this.executorRegistry.get("shell")!;
          executorResult = await shellExecutor.execute({
            projectRoot: this.rootPath,
            runId: run.runId,
            task,
            contextPackPath,
            contextPackContent: contextPack.markdown,
          });
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

        retryCount++;
        if (retryCount <= maxRetries) {
          console.log(picocolors.yellow(`  Retrying (${retryCount}/${maxRetries})...`));
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            `Retry ${retryCount}/${maxRetries}`,
          );
        }
      } while (retryCount <= maxRetries);

      if (validationResult && validationResult.status === "passed") {
        const updated = await this.runManager.updateTaskStatus(run.runId, task.id, "done");
        tasks[i] = updated;

        await this.eventStore.appendToRun(run.runId, {
          type: "task_completed",
          runId: run.runId,
          taskId: task.id,
          message: `Task completed: ${task.title}`,
        });

        await this.logManager.writeTaskLog(run.runId, task.id, "Task completed successfully");
      } else {
        const updated = await this.runManager.updateTaskStatus(run.runId, task.id, "failed");
        tasks[i] = updated;

        runSuccess = false;

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

        break;
      }
    }

    await this.gitService.takeAfterSnapshot(this.rootPath, run.runId);

    const finalRun = runSuccess
      ? await this.runManager.updateRunStatus(run.runId, "completed")
      : await this.runManager.updateRunStatus(run.runId, "failed");

    const finalTasks = await this.runManager.loadTasks(run.runId);
    const report = this.reportGenerator.generate(finalRun, finalTasks);
    const reportMarkdown = this.reportGenerator.generateMarkdown(report);
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
  }
}
