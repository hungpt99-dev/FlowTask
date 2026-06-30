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
import type { GateDecision } from "../safety/approval-manager.js";
import { ApprovalGateChecker } from "../safety/approval-gate.js";
import type { ActionType } from "../safety/approval-gate.js";
import { RiskManager } from "./risk-manager.js";
import { ProcessManager } from "./process-manager.js";
import { InteractiveController } from "../executor/interactive-controller.js";
import { StepManager } from "./step-manager.js";
import { QualityGate } from "../quality/quality-gate.js";
import { classifyError, buildErrorContext, type ErrorContext } from "../utils/error-context.js";
import type { UserDecisionOption } from "../utils/error-context.js";
import type { QualityGateResult } from "../schemas/quality.schema.js";
import { writeTextFile, ensureDir, atomicWriteJsonFile } from "../utils/fs.js";
import { getContextDir, getOutputsDir, dbPath, setActiveRunsDir } from "../utils/paths.js";
import { ProjectScanner } from "../context/project-scanner.js";
import { now } from "../utils/time.js";
import { commandExists } from "../utils/command-exists.js";
import { ProviderRegistry } from "../ai/provider-registry.js";
import path from "node:path";
import picocolors from "picocolors";
import Enquirer from "enquirer";
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
  private riskManager: RiskManager;
  private approvalManager: ApprovalManager;
  private approvalGateChecker: ApprovalGateChecker;
  private processManager: ProcessManager;
  private hookManager: HookManager;
  private databaseManager: DatabaseManager | null = null;

  private skipValidation = false;

  // Gate state tracking per runId
  private pendingGateApprovals: Map<
    string,
    Array<{
      taskId: string;
      actionType: ActionType;
      decision: GateDecision | null;
    }>
  > = new Map();

  constructor(
    rootPath: string,
    projectId: string,
    config: FlowTaskConfig,
    planner?: Planner,
    options?: { skipValidation?: boolean },
  ) {
    this.rootPath = rootPath;
    this.projectId = projectId;
    this.config = config;
    this.skipValidation = options?.skipValidation ?? config.validation?.skipValidation ?? false;
    this.runManager = new RunManager(rootPath);
    setActiveRunsDir(config.runsDir);
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
    this.riskManager = new RiskManager(config.risk);
    this.approvalManager = new ApprovalManager({
      enabled: config.approval?.enabled,
      autoApprove: config.approval?.autoApprove,
    });
    this.approvalGateChecker = new ApprovalGateChecker({
      requireFor: config.approval?.gates?.requireFor as ActionType[] | undefined,
      autoApproveFor: config.approval?.gates?.autoApproveFor as ActionType[] | undefined,
      riskThreshold: config.approval?.gates?.riskThreshold ?? "medium",
      requirePlanApproval: config.approval?.gates?.requirePlanApproval ?? true,
      requireStepApproval: config.approval?.gates?.requireStepApproval ?? true,
      maxCostThreshold: config.approval?.gates?.maxCostThreshold ?? 0.5,
      notifyOnGateBlock: config.approval?.gates?.notifyOnGateBlock ?? true,
    });
    this.processManager = new ProcessManager();
    this.processManager.setMaxConcurrentHeavy(config.process?.maxConcurrentHeavy ?? 1);
    this.processManager.setLogManager(this.logManager);
    this.executorRegistry.setProcessManager(this.processManager);
    this.hookManager = new HookManager(rootPath, config.hooks);
  }

  setSkipValidation(skip: boolean): void {
    this.skipValidation = skip;
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
      skipValidation?: boolean;
    },
  ): Promise<{ run: Run; success: boolean }> {
    const mode = options?.mode ?? "auto";
    const debug = options?.debug ?? false;
    if (options?.skipValidation !== undefined) {
      this.skipValidation = options.skipValidation;
    }

    const run = await this.runManager.createRun(this.projectId, prompt, mode);
    await this.eventStore.appendToRun(run.runId, {
      type: "run_created",
      runId: run.runId,
      message: `Run created: ${run.title}`,
    });
    await this.eventStore.appendTimeline(
      run.runId,
      "workflow_created",
      `Run created: ${run.title}`,
    );
    await this.eventStore.appendAudit(
      run.runId,
      "workflow.create",
      `Run created: ${run.title}`,
      { mode },
      "system",
      run.runId,
      "info",
    );
    this.eventStore.markRunActive(run.runId);

    await this.logManager.writeRuntime(run.runId, `Run started: ${run.title}`);
    const providerRegistry = new ProviderRegistry(this.config);
    const allProviders = providerRegistry.listProviders();

    await this.logManager.writeStartup(run.runId, {
      nodeVersion: process.version,
      projectMode: this.config.projectMode,
      configStatus: "loaded",
      planner: this.config.planner?.provider
        ? `${this.config.planner.type ?? "internal-ai"} (${this.config.planner.provider})`
        : undefined,
      executorCount: Object.keys(this.config.executors ?? {}).length,
      validationProfile: this.config.validation?.profile ?? "safe",
      aiProviderCount: allProviders.length,
    });
    console.log(picocolors.cyan(`\nFlowTask Run: ${run.title}`));
    console.log(picocolors.dim(`Run ID: ${run.runId}`));
    console.log(picocolors.dim(`Mode: ${mode}\n`));

    if (debug) {
      console.log(picocolors.yellow(`[debug] Project: ${this.projectId}`));
      console.log(picocolors.yellow(`[debug] Root: ${this.rootPath}`));
    }

    let updatedRun = await this.runManager.updateRunStatus(run.runId, "planning");
    await this.runManager.savePrompt(run.runId, prompt);
    await this.eventStore.appendTimeline(run.runId, "workflow_planning", "Planning workflow");

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
        await this.logManager.writeRuntime(run.runId, `Hook succeeded: ${hook.entry}`);
      } else {
        await this.logManager.writeRuntime(run.runId, `Hook failed: ${hook.entry}\n${hook.stderr}`);
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
      const scanCtx: HookContext = { runId: run.runId };
      await this.hookManager.runBeforeScan(scanCtx);
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
      await this.hookManager.runAfterScan(scanCtx);

      const planCtx: HookContext = { runId: run.runId };
      await this.hookManager.runBeforePlan(planCtx);
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
    await this.hookManager.runAfterPlan({ runId: run.runId, planType: options?.plannerMode });

    // Log AI provider connectivity info (non-blocking)
    this.logAiConnectivity(run.runId);

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
    await this.eventStore.appendTimeline(
      run.runId,
      "workflow_running",
      `Running ${tasksWithRunId.length} tasks`,
    );
    await this.eventStore.appendAudit(
      run.runId,
      "workflow.start",
      `Run started`,
      { taskCount: tasksWithRunId.length },
      "system",
      run.runId,
      "info",
    );

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
            createRunEvent(event.type, {
              runId: event.runId ?? run.runId,
              taskId: "taskId" in event ? event.taskId : undefined,
              details: { ...event },
            }),
          );
        } catch {
          // persistence is non-critical
        }
        return;
      }

      if (
        event.type === "prompt_detected" ||
        event.type === "prompt_input_provided" ||
        event.type === "prompt_cancelled" ||
        event.type === "prompt_timeout" ||
        event.type === "interactive_waiting" ||
        event.type === "interactive_resumed" ||
        event.type === "process_waiting_input"
      ) {
        try {
          await this.eventStore.appendToRun(
            run.runId,
            createRunEvent("prompt_input_provided" as never, {
              runId: event.runId ?? run.runId,
              taskId: "taskId" in event ? event.taskId : undefined,
              details: { ...event },
            }),
          );

          const timelineType =
            event.type === "prompt_detected"
              ? "approval_requested"
              : event.type === "prompt_input_provided"
                ? "approval_accepted"
                : event.type === "prompt_cancelled"
                  ? "approval_rejected"
                  : "state_transition";

          if (timelineType !== "state_transition") {
            await this.eventStore.appendTimeline(
              run.runId,
              timelineType as "approval_requested" | "approval_accepted" | "approval_rejected",
              event.type === "prompt_detected"
                ? `Prompt detected: ${"promptText" in event ? event.promptText : ""}`
                : event.type === "prompt_input_provided"
                  ? `User input provided to process`
                  : event.type === "prompt_cancelled"
                    ? `Prompt cancelled: ${"reason" in event ? event.reason : ""}`
                    : `Interactive event: ${event.type}`,
              undefined,
              run.runId,
              "taskId" in event ? event.taskId : undefined,
              event.type === "prompt_detected" ? "waiting_approval" : "running",
            );
          }
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
        await this.eventStore.appendTimeline(
          run.runId,
          "workflow_paused",
          "Run paused for task approval",
        );
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
          await this.logManager.writeRuntime(run.runId, `Hook succeeded: ${hook.entry}`);
        } else {
          await this.logManager.writeRuntime(
            run.runId,
            `Hook failed: ${hook.entry}\n${hook.stderr}`,
          );
        }
      }

      if (finalSuccess) {
        await this.hookManager.runOnRunComplete({ runId: run.runId, success: true });
      } else {
        const failCtx: HookContext = {
          runId: run.runId,
          error: "Run failed or quality check failed",
        };
        await this.hookManager.runOnFailure(failCtx);
        await this.hookManager.runOnRunFail({ runId: run.runId, error: "Run failed" });
      }

      const finalRun = finalSuccess
        ? await this.runManager.updateRunStatus(run.runId, "completed")
        : await this.runManager.updateRunStatus(run.runId, "failed");

      const finalTasks = await this.runManager.loadTasks(run.runId);
      const events = await this.eventStore.readRunEvents(finalRun.runId);
      const timeline = await this.runManager.getRunTimeline(run.runId);
      const runErrors = await this.runManager.getRunErrors(run.runId);
      const approvals = await this.runManager.getRunApprovals(run.runId);

      // Load additional data for comprehensive report
      let steps: import("../schemas/step.schema.js").Step[] = [];
      let artifacts: import("../schemas/artifact.schema.js").ArtifactRecord[] = [];
      let fileChanges: import("./file-tracker.js").FileChange[] = [];
      const validations: import("../schemas/validation.schema.js").ValidationResult[] = [];
      let workflowState: import("../schemas/workflow-lifecycle.schema.js").WorkflowState | null =
        null;

      try {
        const stepManager = new (await import("./step-manager.js")).StepManager(this.rootPath);
        const allStepsByTask = await stepManager.loadAllSteps(run.runId);
        steps = Object.values(allStepsByTask).flat();
      } catch {
        /* non-critical */
      }

      try {
        if (this.databaseManager) {
          const artifactManager = new (await import("./artifact-manager.js")).ArtifactManager();
          artifactManager.setDatabase(this.databaseManager);
          artifacts = artifactManager.getArtifactsByRun(this.rootPath, run.runId);
        }
      } catch {
        /* non-critical */
      }

      try {
        const fileTracker = new (await import("./file-tracker.js")).FileTracker();
        fileChanges = await fileTracker.getChangesByRun(this.rootPath, run.runId);
      } catch {
        /* non-critical */
      }

      // validations are embedded in task execution flow; for report we use already-captured data

      try {
        const wm = new (await import("./workflow-manager.js")).WorkflowManager(
          this.rootPath,
          this.runManager,
          this.eventStore,
        );
        workflowState = await wm.loadWorkflowState(run.runId);
      } catch {
        /* non-critical */
      }

      const report = await new ReportGenerator().generate(
        finalRun,
        finalTasks,
        this.rootPath,
        events,
        steps,
        artifacts,
        fileChanges,
        validations,
        timeline,
        approvals,
        runErrors,
        workflowState,
      );
      const reportMarkdown = new ReportGenerator().generateMarkdown(report);
      await this.runManager.saveFinalReport(run.runId, reportMarkdown);

      await this.eventStore.appendToRun(run.runId, {
        type: runSuccess ? "run_completed" : "run_failed",
        runId: run.runId,
        message: `Run ${runSuccess ? "completed" : "failed"}`,
      });
      if (runSuccess) {
        await this.eventStore.appendTimeline(
          run.runId,
          "workflow_completed",
          "Workflow completed successfully",
        );
        await this.eventStore.appendAudit(
          run.runId,
          "workflow.complete",
          "Workflow completed",
          { success: true },
          "system",
          run.runId,
          "info",
        );
      } else {
        await this.eventStore.appendTimeline(run.runId, "workflow_failed", "Workflow failed");
        await this.eventStore.appendAudit(
          run.runId,
          "workflow.fail",
          "Workflow failed",
          { success: false },
          "system",
          run.runId,
          "error",
        );
      }
      this.eventStore.markRunInactive(run.runId);

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
    // Only kill orphaned processes if there's no active interactive session
    const hasInteractive = InteractiveController.isSessionAliveByRunId(runId);
    if (!hasInteractive) {
      await this.processManager.stop(this.rootPath, runId);
    }

    const tasks = await this.runManager.loadTasks(runId);
    const pending = tasks.filter(
      (t) =>
        t.status === "pending" ||
        t.status === "interrupted" ||
        t.status === "waiting_approval" ||
        t.status === "waiting_input",
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
            createRunEvent(event.type, {
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

  async executeSingleTask(
    runId: string,
    taskId: string,
  ): Promise<boolean | "waiting" | "waiting_input" | "waiting_approval"> {
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
            createRunEvent(event.type, {
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
        task.status !== "waiting_approval" &&
        task.status !== "waiting_input"
      ) {
        await this.logManager.writeRuntime(
          run.runId,
          `[debug] Loop: skipping task ${task.id} (status=${task.status})`,
          "debug",
        );
        continue;
      }

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
        await this.logManager.writeRuntime(
          run.runId,
          `[debug] Task ${task.id} waiting for dependencies: ${task.dependsOn.join(", ")}`,
          "debug",
        );
        continue;
      }

      if (isManual && !autoApprove) {
        // In interactive TTY mode, prompt the user inline
        if (process.stdin.isTTY) {
          await this.logManager.writeRuntime(
            run.runId,
            `[debug] Interactive approval prompt shown for task ${task.id}`,
            "debug",
          );
          await this.hookManager.runOnApprovalRequired({
            runId: run.runId,
            taskId: task.id,
            taskTitle: task.title,
          });
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
          await this.logManager.writeRuntime(
            run.runId,
            `[debug] Non-TTY fallback: marking task ${task.id} as waiting_approval for external approval`,
            "debug",
          );
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

      if (task.status === "waiting_input" || task.status === "waiting_approval") {
        // Check if there's an active interactive session that can be continued
        const sessionAlive = InteractiveController.isSessionAliveByRunId(run.runId);
        if (sessionAlive) {
          console.log(
            picocolors.cyan(
              `\n  [${i + 1}/${tasks.length}] ${task.title} — continuing interactive session`,
            ),
          );
          await this.runManager.updateTaskStatus(run.runId, task.id, "running");
          await this.eventStore.appendTimeline(
            run.runId,
            "approval_accepted",
            `Interactive session resumed for: ${task.title}`,
            undefined,
            run.runId,
            task.id,
            "running",
          );
          const sessionResult = await this.executeTask(
            run,
            prompt,
            rulesContext,
            { ...task, status: "running" },
            tasks,
          );
          if (sessionResult === true) {
            continue;
          }
          if (sessionResult === "waiting_input" || sessionResult === "waiting_approval") {
            return { success: true, paused: true };
          }
          if (sessionResult === false) {
            runSuccess = false;
            break;
          }
          continue;
        }

        // TTY waiting_input: prompt inline instead of pausing
        if (task.status === "waiting_input" && process.stdin.isTTY) {
          console.log(
            picocolors.cyan(`\n  [${i + 1}/${tasks.length}] ${task.title} — awaiting input`),
          );
          await this.logManager.writeRuntime(
            run.runId,
            `[debug] Interactive input prompt shown for task ${task.id} in executeTasks`,
            "debug",
          );
          const enquirer = new Enquirer();
          let answer = "";
          try {
            const response = await enquirer.prompt({
              type: "input",
              name: "response",
              message: "Enter input:",
            });
            answer = String((response as Record<string, unknown>).response ?? "");
          } catch {
            await this.logManager.writeRuntime(
              run.runId,
              `[debug] Interactive input prompt cancelled for task ${task.id}; falling back to external input`,
              "debug",
            );
            console.log(picocolors.dim(`    Use: flowtask input ${run.runId} <text>`));
            return { success: true, paused: true };
          }

          // Store the input in task metadata so executeTask can pass it to the executor
          task.metadata = { ...(task.metadata ?? {}), _pendingInput: answer };
          await this.runManager.updateTaskStatus(run.runId, task.id, "pending");
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            "User input provided via TTY prompt",
          );
          await this.logManager.writeRuntime(
            run.runId,
            `[debug] User input collected via TTY prompt for task ${task.id} in executeTasks`,
            "debug",
          );
          // Re-run this task with the stored input
          task.status = "pending";
          i--;
          continue;
        }

        await this.logManager.writeRuntime(
          run.runId,
          `[debug] Non-TTY fallback: task ${task.id} in state ${task.status}, pausing for external resolution`,
          "debug",
        );

        console.log(
          picocolors.cyan(
            `\n  [${i + 1}/${tasks.length}] ${task.title} — ${task.status === "waiting_input" ? "awaiting input" : "awaiting approval"}`,
          ),
        );

        await this.eventStore.appendTimeline(
          run.runId,
          "approval_requested",
          `Task ${task.status === "waiting_input" ? "needs input" : "needs approval"}: ${task.title}`,
          undefined,
          run.runId,
          task.id,
          task.status,
        );

        if (task.status === "waiting_approval") {
          console.log(picocolors.dim(`    Use: flowtask tasks-approve ${task.id}`));
          console.log(picocolors.dim(`    Use: flowtask tasks-deny ${task.id}`));
        } else {
          console.log(picocolors.dim(`    Use: flowtask input ${run.runId} <text>`));
          console.log(picocolors.dim(`    Use: flowtask approve ${run.runId}`));
          console.log(picocolors.dim(`    Use: flowtask reject ${run.runId}`));
        }
        console.log(picocolors.dim(`    Use: flowtask kill ${run.runId}`));
        return { success: true, paused: true };
      }

      // Check approval gate for plan execution
      if (!this.approvalManager.shouldAutoApprove()) {
        const actionType = this.approvalGateChecker.classifyStepType(
          task.title,
          task.validation?.commands?.join(" "),
        );
        const gateDecision = await this.checkApprovalGate(
          run,
          task,
          actionType,
          `Task: ${task.title} (${task.executor})`,
          { command: task.validation?.commands?.join(" ") },
        );

        if (gateDecision === "rejected") {
          await this.runManager.updateTaskStatus(run.runId, task.id, "skipped");
          await this.eventStore.appendToRun(run.runId, {
            type: "task_skipped",
            runId: run.runId,
            taskId: task.id,
            message: `Task skipped by user (gate rejected): ${task.title}`,
          });
          await this.eventStore.appendTimeline(
            run.runId,
            "step_skipped",
            `Task skipped: gate rejected for ${task.title}`,
            undefined,
            run.runId,
            task.id,
            "skipped",
          );
          await this.eventStore.appendAudit(
            run.runId,
            "step.skip",
            `Task skipped: approval gate rejected for ${task.title}`,
            { actionType, gate: "rejected" },
            "user",
            task.id,
            "warn",
            run.runId,
            task.id,
          );
          await this.logManager.writeTaskLog(run.runId, task.id, `Task skipped: gate rejected`);
          console.log(picocolors.yellow(`  Task skipped (gate rejected): ${task.title}`));
          continue;
        }

        if (gateDecision === "waiting") {
          console.log(
            picocolors.cyan(
              `\n  [${i + 1}/${tasks.length}] ${task.title} — awaiting gate approval`,
            ),
          );
          console.log(picocolors.dim(`    Use: flowtask approve ${run.runId}`));
          console.log(picocolors.dim(`    Use: flowtask reject ${run.runId}`));
          console.log(picocolors.dim(`    Use: flowtask override ${run.runId}`));
          console.log(picocolors.dim(`    Or set --approval-mode auto to bypass`));
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
            `Hook failed: ${hook.entry}\n${hook.stderr}`,
          );
        }
      }

      const result = await this.executeTask(run, prompt, rulesContext, task, tasks);

      if (result === "waiting" || result === "waiting_input" || result === "waiting_approval") {
        await this.logManager.writeRuntime(
          run.runId,
          `[debug] Task ${task.id} returned "${result}"; pausing run`,
          "debug",
        );
        return { success: true, paused: true };
      }

      const success = result === true;
      task.status = success ? "done" : "failed";
      await this.logManager.writeRuntime(
        run.runId,
        `[debug] Task ${task.id} transitioned to "${task.status}" — auto-continuing to next task`,
        "debug",
      );

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
            `Hook failed: ${hook.entry}\n${hook.stderr}`,
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
          await this.eventStore.appendTimeline(
            run.runId,
            "step_skipped",
            `Task skipped by user: ${task.title}`,
            undefined,
            run.runId,
            task.id,
            "skipped",
          );
          await this.eventStore.appendAudit(
            run.runId,
            "step.skip",
            `Task skipped by user: ${task.title}`,
            { reason: "user_action" },
            "user",
            task.id,
            "warn",
            run.runId,
            task.id,
          );
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

  private getPendingGates(runId: string): Array<{
    taskId: string;
    actionType: ActionType;
    decision: GateDecision | null;
  }> {
    return this.pendingGateApprovals.get(runId) ?? [];
  }

  async resolvePendingGate(
    runId: string,
    taskId: string,
    decision: GateDecision,
  ): Promise<boolean> {
    const gates = this.pendingGateApprovals.get(runId);
    if (!gates) return false;
    const idx = gates.findIndex((g) => g.taskId === taskId);
    if (idx < 0) return false;
    gates[idx] = { ...gates[idx]!, decision };
    this.pendingGateApprovals.set(runId, gates);
    const auditAction =
      decision === "approved"
        ? ("approval.grant" as const)
        : decision === "override"
          ? ("user.decision" as const)
          : ("approval.deny" as const);
    await this.eventStore.appendAudit(
      runId,
      auditAction,
      `${decision} gate for task ${taskId}`,
      { actionType: gates[idx]!.actionType, decision },
      "user",
      taskId,
      decision === "approved" || decision === "override" ? "info" : "warn",
      runId,
      taskId,
    );
    await this.eventStore.appendTimeline(
      runId,
      decision === "approved"
        ? "approval_accepted"
        : decision === "rejected"
          ? "approval_rejected"
          : "approval_accepted",
      `Gate ${decision} for task ${taskId}`,
      undefined,
      runId,
      taskId,
      decision === "approved" ? "approved" : decision === "rejected" ? "denied" : "running",
    );
    return true;
  }

  async hasPendingGateForTask(runId: string, taskId: string): Promise<boolean> {
    const gates = this.pendingGateApprovals.get(runId);
    if (!gates) return false;
    const gate = gates.find((g) => g.taskId === taskId);
    return gate !== undefined && gate.decision === null;
  }

  private clearPendingGates(runId: string): void {
    this.pendingGateApprovals.delete(runId);
  }

  private async checkApprovalGate(
    run: Run,
    task: Task,
    actionType: ActionType,
    details: string,
    context?: {
      command?: string;
      filePath?: string;
      estimatedCost?: number;
      failureCount?: number;
    },
  ): Promise<"approved" | "rejected" | "override" | "skip" | "waiting"> {
    const gateResult = this.approvalGateChecker.checkAction(actionType, {
      command: context?.command,
      filePath: context?.filePath,
      estimatedCost: context?.estimatedCost,
      failureCount: context?.failureCount,
    });

    if (!gateResult.requiresApproval) {
      return "approved";
    }

    if (this.approvalManager.shouldAutoApprove()) {
      const stepManager = new StepManager(this.rootPath);
      await this.eventStore.appendTimeline(
        run.runId,
        "approval_accepted",
        `Gate auto-approved: ${actionType}`,
        { autoApprove: true },
        run.runId,
        task.id,
        "approved",
      );
      return "approved";
    }

    if (this.approvalManager.shouldSkip()) {
      return "skip";
    }

    if (!process.stdin.isTTY) {
      // Store as pending for CLI resolution
      const gates = this.pendingGateApprovals.get(run.runId) ?? [];
      const existing = gates.find((g) => g.taskId === task.id);
      if (existing) {
        // Already pending — wait for resolution
        const deadline = Date.now() + 3600000; // 1 hour timeout
        while (Date.now() < deadline) {
          const current = this.pendingGateApprovals.get(run.runId);
          const g = current?.find((g) => g.taskId === task.id);
          if (g && g.decision !== null) {
            this.pendingGateApprovals.set(
              run.runId,
              (this.pendingGateApprovals.get(run.runId) ?? []).filter(
                (p) => !(p.taskId === task.id && p.actionType === actionType),
              ),
            );
            return g.decision;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        return "rejected";
      }

      gates.push({ taskId: task.id, actionType, decision: null });
      this.pendingGateApprovals.set(run.runId, gates);

      await this.eventStore.appendTimeline(
        run.runId,
        "approval_requested",
        `Gate blocked: ${actionType} for task ${task.title}`,
        { gateBlocked: true, actionType },
        run.runId,
        task.id,
        "waiting_approval",
      );

      return "waiting";
    }

    const stepManager = new StepManager(this.rootPath);
    await this.hookManager.runOnApprovalRequired({
      runId: run.runId,
      taskId: task.id,
      taskTitle: task.title,
      stepId: undefined,
      stepTitle: actionType,
    });

    const decision = await this.approvalManager.requestGateApproval({
      taskId: task.id,
      actionType,
      riskLevel: gateResult.riskLevel,
      reason: gateResult.reason,
      details,
      stepTitle: task.title,
    });

    if (decision === "approved" || decision === "override") {
      await this.eventStore.appendTimeline(
        run.runId,
        "approval_accepted",
        `Gate ${decision}: ${actionType}`,
        { decision },
        run.runId,
        task.id,
        "approved",
      );
      return decision;
    }

    await this.eventStore.appendTimeline(
      run.runId,
      "approval_rejected",
      `Gate rejected: ${actionType}`,
      undefined,
      run.runId,
      task.id,
      "denied",
    );
    return "rejected";
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
      await this.hookManager.runOnApprovalRequired({
        runId: run.runId,
        taskId: task.id,
        taskTitle: task.title,
        stepId: step.id,
        stepTitle: step.title,
      });
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

  private async recordError(
    runId: string,
    errorOrContext: Error | ErrorContext,
    context?: {
      taskId?: string;
      stepId?: string;
      userDecisionOptions?: UserDecisionOption[];
      additionalEvidence?: string;
      suggestedFix?: string;
    },
  ): Promise<void> {
    let errorContext: ErrorContext;

    if (errorOrContext instanceof Error) {
      const ctx = classifyError(errorOrContext, { taskId: context?.taskId, runId });
      errorContext = ctx;
    } else {
      errorContext = errorOrContext;
    }

    const evidence = context?.additionalEvidence ?? errorContext.evidence;
    const suggestedFix = context?.suggestedFix ?? errorContext.suggestedFix;

    await this.runManager.addRunError(runId, {
      stepId: context?.stepId,
      taskId: context?.taskId,
      message: errorContext.reason,
      retryCount: (await this.runManager.loadTasks(runId)).find((t) => t.id === context?.taskId)
        ?.retryCount,
      evidence,
      suggestedFix,
    });

    await this.eventStore.appendToRun(runId, {
      type: "error_occurred",
      runId,
      taskId: context?.taskId,
      message: errorContext.reason,
      details: {
        errorCategory: errorContext.errorCode,
        evidence,
        suggestedFix,
        retryable: errorContext.retryable,
        severity: errorContext.severity,
        userDecisionOptions: errorContext.userDecisionOptions?.map((o) => ({
          label: o.label,
          action: o.action,
        })),
        ...errorContext.details,
      },
    });

    await this.eventStore.appendTimeline(
      runId,
      "error_occurred",
      errorContext.reason,
      {
        taskId: context?.taskId,
        evidence: evidence?.slice(0, 200),
        suggestedFix: suggestedFix?.slice(0, 200),
        retryable: errorContext.retryable,
      },
      runId,
      context?.taskId,
      "failed",
    );

    await this.eventStore.appendAudit(
      runId,
      "error.occur",
      errorContext.reason,
      {
        errorCode: errorContext.errorCode,
        taskId: context?.taskId,
        evidence: evidence?.slice(0, 500),
        suggestedFix: suggestedFix?.slice(0, 500),
        retryable: errorContext.retryable,
        severity: errorContext.severity,
      },
      "system",
      context?.taskId,
      errorContext.severity === "error" ? "error" : "warn",
      runId,
      context?.taskId,
    );

    await this.logManager.writeTaskLog(
      runId,
      context?.taskId ?? "unknown",
      `[ERROR] ${errorContext.reason}${evidence ? `\n  Evidence: ${evidence}` : ""}${suggestedFix ? `\n  Suggested fix: ${suggestedFix}` : ""}${errorContext.retryable ? "\n  Retryable: yes" : ""}`,
    );
  }

  private async executeTask(
    run: Run,
    prompt: string,
    rulesContext: string,
    task: Task,
    allTasks: Task[],
  ): Promise<boolean | "waiting" | "waiting_input" | "waiting_approval"> {
    const taskIndex = allTasks.indexOf(task);
    const i = taskIndex >= 0 ? taskIndex : 0;
    const taskStartedAt = now();

    await this.runManager.updateTaskStatus(run.runId, task.id, "running");

    const currentCost = run.costUsage?.totalCost ?? 0;
    const costCheck = this.riskManager.checkCostLimit(currentCost);
    if (!costCheck.allowed) {
      const errorCtx = buildErrorContext("cost_limit", costCheck.message ?? "Cost limit exceeded", {
        source: "workflow",
        evidence: `Current cost: $${currentCost}`,
        details: { currentCost },
      });
      await this.recordError(run.runId, errorCtx, {
        taskId: task.id,
        suggestedFix:
          "Increase the budget or reduce AI usage. Configure max cost in risk settings.",
      });
      await this.runManager.updateTaskStatus(run.runId, task.id, "failed");
      await this.logManager.writeTaskLog(
        run.runId,
        task.id,
        costCheck.message ?? "Cost limit exceeded",
      );
      console.log(picocolors.red(`  ${costCheck.message}`));
      return false;
    }
    if (costCheck.requiresApproval) {
      console.log(picocolors.yellow(`  ${costCheck.message}`));
      await this.logManager.writeTaskLog(run.runId, task.id, costCheck.message ?? "");
    }

    const abortController = new AbortController();
    this.processManager.registerController(run.runId, abortController);

    await this.logManager.writeTaskLog(run.runId, task.id, `Task started: ${task.title}`);
    await this.eventStore.appendToRun(run.runId, {
      type: "task_started",
      runId: run.runId,
      taskId: task.id,
      message: `Task started: ${task.title}`,
    });
    await this.eventStore.appendTimeline(
      run.runId,
      "step_started",
      `Task started: ${task.title}`,
      { taskIndex: i + 1, totalTasks: allTasks.length },
      run.runId,
      task.id,
      "running",
    );
    await this.eventStore.appendAudit(
      run.runId,
      "step.start",
      `Task started: ${task.title}`,
      {},
      "system",
      task.id,
      "info",
      run.runId,
      task.id,
    );

    console.log(picocolors.cyan(`\n  [${i + 1}/${allTasks.length}] ${task.title}`));

    const completedTasks = allTasks.filter((t) => t.status === "done" || t.status === "failed");

    let contextPack = this.contextPackBuilder.build({
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
      await this.eventStore.appendTimeline(
        run.runId,
        "step_skipped",
        `Task skipped: steps denied`,
        undefined,
        run.runId,
        task.id,
        "skipped",
      );
      await this.eventStore.appendAudit(
        run.runId,
        "step.skip",
        `Task skipped: steps denied`,
        { reason: "approval_denied" },
        "user",
        task.id,
        "warn",
        run.runId,
        task.id,
      );
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
    let interactiveInput: string | undefined;
    let retryWithInput = false;

    const stepHookCtx: HookContext = { runId: run.runId, taskId: task.id, taskTitle: task.title };
    await this.hookManager.runBeforeStep(stepHookCtx);

    try {
      do {
        if (!retryWithInput) {
          interactiveInput = undefined;
        }
        retryWithInput = false;

        // Check for pending input stored in task metadata from the outer handler
        const pendingInput = task.metadata?._pendingInput as string | undefined;
        if (pendingInput !== undefined && interactiveInput === undefined) {
          interactiveInput = pendingInput;
          task.metadata = { ...(task.metadata ?? {}), _pendingInput: undefined };
        }

        if (task.validation?.commands) {
          for (const cmd of task.validation.commands) {
            const safetyResult = this.safetyChecker.check(cmd);
            if (safetyResult.riskLevel === "blocked") {
              const errorCtx = buildErrorContext(
                "permission_error",
                `Command blocked: ${safetyResult.reason}`,
                {
                  source: "safety",
                  evidence: `Command: ${cmd}`,
                  suggestedFix:
                    "Remove or modify the blocked command. Configure allowed commands in safety settings.",
                  details: { command: cmd, reason: safetyResult.reason },
                },
              );
              await this.recordError(run.runId, errorCtx, { taskId: task.id });
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

            const riskAssessment = this.riskManager.assessCommand(cmd);
            if (riskAssessment.blocked) {
              const errorCtx = buildErrorContext(
                "permission_error",
                `Command blocked by risk manager: ${riskAssessment.blockedReasons.join(", ")}`,
                {
                  source: "safety",
                  evidence: `Command: ${cmd}`,
                  suggestedFix:
                    "Review the risk assessment and configure risk settings to allow this command.",
                  details: { command: cmd, blockedReasons: riskAssessment.blockedReasons },
                },
              );
              await this.recordError(run.runId, errorCtx, { taskId: task.id });
              await this.eventStore.appendToRun(run.runId, {
                type: "command_blocked",
                runId: run.runId,
                taskId: task.id,
                message: `Command blocked by risk manager: ${riskAssessment.blockedReasons.join(", ")}`,
              });
              await this.runManager.updateTaskStatus(run.runId, task.id, "failed");
              await this.logManager.writeTaskLog(
                run.runId,
                task.id,
                `Command blocked by risk manager: ${riskAssessment.blockedReasons.join(", ")}`,
              );
              console.log(
                picocolors.red(`  ${this.riskManager.getEscalationMessage(riskAssessment)}`),
              );
              return false;
            }
            if (riskAssessment.warnings.length > 0) {
              for (const w of riskAssessment.warnings) {
                await this.logManager.writeTaskLog(run.runId, task.id, `Risk warning: ${w}`);
                console.log(picocolors.yellow(`  Risk warning: ${w}`));
              }
            }
            if (riskAssessment.infoMessages.length > 0) {
              for (const msg of riskAssessment.infoMessages) {
                await this.logManager.writeTaskLog(run.runId, task.id, `Risk info: ${msg}`);
              }
            }
          }
        }

        const executor = this.executorRegistry.get(task.executor);

        if (!executor) {
          const errorCtx = buildErrorContext(
            "missing_dependency",
            `Unknown executor: "${task.executor}". Task cannot be executed.`,
            {
              source: "executor",
              evidence: `Configured executors: ${this.executorRegistry.list().join(", ")}`,
              suggestedFix: `Configure "${task.executor}" in .flowtask/config.json executors section. Available: ${this.executorRegistry.list().join(", ")}`,
              details: {
                requestedExecutor: task.executor,
                availableExecutors: this.executorRegistry.list(),
              },
            },
          );
          await this.recordError(run.runId, errorCtx, { taskId: task.id });
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

          // Check for existing interactive session (resume case)
          const existingSession = InteractiveController.getSessionByRunId(run.runId);
          if (existingSession) {
            // Session exists — wait for it to complete (user may have already provided input)
            await this.runManager.updateTaskStatus(run.runId, task.id, "running");
            await this.logManager.writeTaskLog(
              run.runId,
              task.id,
              "Resuming interactive session, waiting for process...",
            );
            const exitResult = await InteractiveController.waitForProcessExitByRunId(run.runId);
            const session = InteractiveController.getSessionByRunId(run.runId);
            const stdout = session?.stdoutLines ?? [];
            const stderr = session?.stderrLines ?? [];
            if (session) {
              InteractiveController.removeSession(session.id);
            }

            executorResult = {
              status: exitResult.exitCode === 0 ? "done" : "failed",
              exitCode: exitResult.exitCode ?? undefined,
              output: stdout.join("\n"),
              error: stderr.join("\n") || undefined,
              startedAt: taskStartedAt,
              finishedAt: now(),
            };

            await this.eventStore.appendToRun(run.runId, {
              type: "executor_completed",
              runId: run.runId,
              taskId: task.id,
              details: { exitCode: exitResult.exitCode },
            });

            await this.logManager.writeTaskLog(
              run.runId,
              task.id,
              `Interactive session completed with exit code ${exitResult.exitCode}`,
            );
          } else {
            const executorConfig = this.executorRegistry.getConfig(task.executor);
            const spawnCommand =
              executorConfig?.command ?? task.validation?.commands?.join(" && ") ?? "";
            const releaseSpawn = await this.processManager.acquireSpawnSlot(spawnCommand);
            try {
              executorResult = await executor.execute({
                projectRoot: this.rootPath,
                runId: run.runId,
                task,
                contextPackPath,
                contextPackContent: contextPack.markdown,
                signal: abortController.signal,
                interactiveInput,
              });
            } finally {
              releaseSpawn();
            }

            await this.eventStore.appendToRun(run.runId, {
              type:
                executorResult.status === "done"
                  ? "executor_completed"
                  : executorResult.status === "skipped"
                    ? "executor_completed"
                    : executorResult.status === "waiting_input" ||
                        executorResult.status === "waiting_approval"
                      ? "executor_completed"
                      : "executor_failed",
              runId: run.runId,
              taskId: task.id,
              details: { exitCode: executorResult.exitCode },
            });
          }
        }

        if (
          executorResult.status === "waiting_input" ||
          executorResult.status === "waiting_approval"
        ) {
          const waitStatus =
            executorResult.status === "waiting_input" ? "waiting_input" : "waiting_approval";
          await this.runManager.updateTaskStatus(run.runId, task.id, waitStatus);
          await this.logManager.writeRuntime(
            run.runId,
            `[debug] Task ${task.id} entered "${waitStatus}" state` +
              (executorResult.detectedPrompt
                ? ` (prompt: "${executorResult.detectedPrompt}")`
                : ""),
            "debug",
          );
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            `Task waiting for ${executorResult.status === "waiting_input" ? "input" : "approval"}` +
              (executorResult.detectedPrompt ? `: ${executorResult.detectedPrompt}` : ""),
          );
          await this.eventStore.appendToRun(run.runId, {
            type: "approval_requested",
            runId: run.runId,
            taskId: task.id,
            message: `Task needs ${executorResult.status === "waiting_input" ? "input" : "approval"}: ${executorResult.detectedPrompt ?? task.title}`,
          });
          await this.eventStore.appendTimeline(
            run.runId,
            "approval_requested",
            `Task needs ${executorResult.status === "waiting_input" ? "input" : "approval"}: ${task.title}`,
            { waitStatus },
            task.id,
            undefined,
            waitStatus,
          );

          if (executorResult.status === "waiting_input" && process.stdin.isTTY) {
            const sessionAlive = InteractiveController.isSessionAliveByRunId(run.runId);
            const promptText = executorResult.detectedPrompt ?? "Enter input:";
            console.log(picocolors.cyan(`\n  ${promptText}`));

            await this.logManager.writeRuntime(
              run.runId,
              `[debug] Interactive input prompt in executeTask for task ${task.id}: "${promptText}"`,
              "debug",
            );

            const enquirer = new Enquirer();
            let answer = "";
            try {
              const response = await enquirer.prompt({
                type: "input",
                name: "response",
                message: promptText,
              });
              answer = String((response as Record<string, unknown>).response ?? "");
            } catch {
              await this.logManager.writeRuntime(
                run.runId,
                `[debug] Interactive input prompt cancelled in executeTask for task ${task.id}; returning ${waitStatus}`,
                "debug",
              );
              console.log(picocolors.dim(`    Use: flowtask input ${run.runId} <text>`));
              return waitStatus;
            }

            await this.logManager.writeTaskLog(
              run.runId,
              task.id,
              "User input provided via TTY prompt",
            );

            if (sessionAlive) {
              InteractiveController.sendInputByRunId(run.runId, answer);

              const exitResult = await InteractiveController.waitForProcessExitByRunId(run.runId);
              const session = InteractiveController.getSessionByRunId(run.runId);
              const stdout = session?.stdoutLines ?? [];
              const stderr = session?.stderrLines ?? [];
              if (session) InteractiveController.removeSession(session.id);

              executorResult = {
                status: exitResult.exitCode === 0 ? "done" : "failed",
                exitCode: exitResult.exitCode ?? undefined,
                output: stdout.join("\n"),
                error: stderr.join("\n") || undefined,
                startedAt: taskStartedAt,
                finishedAt: now(),
              };

              await this.eventStore.appendToRun(run.runId, {
                type: "executor_completed",
                runId: run.runId,
                taskId: task.id,
                details: { exitCode: exitResult.exitCode },
              });

              await this.logManager.writeTaskLog(
                run.runId,
                task.id,
                `Interactive session completed with exit code ${exitResult.exitCode}`,
              );

              console.log(picocolors.green(`  Input sent. Waiting for process...`));
            } else {
              interactiveInput = answer;
              retryWithInput = true;
              await this.runManager.updateTaskStatus(run.runId, task.id, "pending");
              await this.logManager.writeRuntime(
                run.runId,
                `[debug] Retrying task ${task.id} with user input (no active session)`,
                "debug",
              );
              continue;
            }
          } else {
            await this.logManager.writeRuntime(
              run.runId,
              `[debug] Non-TTY in executeTask: task ${task.id} returning "${waitStatus}" for external resolution`,
              "debug",
            );
            if (executorResult.status === "waiting_input") {
              console.log(picocolors.cyan(`\n  Task waiting for input: ${task.title}`));
              console.log(picocolors.dim(`    Use: flowtask input ${run.runId} <text>`));
            } else {
              console.log(picocolors.cyan(`\n  Task awaiting approval: ${task.title}`));
              console.log(picocolors.dim(`    Use: flowtask tasks-approve ${task.id}`));
              console.log(picocolors.dim(`    Use: flowtask tasks-deny ${task.id}`));
            }
            console.log(picocolors.dim(`    Use: flowtask watch ${run.runId}`));
            console.log(picocolors.dim(`    Use: flowtask kill ${run.runId}`));

            return waitStatus;
          }
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

        const validateCtx: HookContext = {
          runId: run.runId,
          taskId: task.id,
          taskTitle: task.title,
        };
        await this.hookManager.runBeforeValidate(validateCtx);

        const shouldSkipValidation = this.skipValidation || task.skipValidation === true;

        if (shouldSkipValidation) {
          const skipReason =
            task.skipValidation === true
              ? "Skipped by task config"
              : this.config.validation?.skipValidation
                ? "Skipped by project config"
                : "Skipped by CLI flag";

          validationResult = {
            taskId: task.id,
            status: "skipped",
            checks: [
              {
                type: "process",
                status: "skipped",
                message: `Validation skipped: ${skipReason}`,
              },
            ],
            createdAt: now(),
          };

          console.log(
            picocolors.yellow(`  Validation skipped for task: ${task.title} (${skipReason})`),
          );
          await this.logManager.writeTaskLog(
            run.runId,
            task.id,
            `Validation skipped: ${skipReason}`,
          );
        } else {
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
        }

        await this.hookManager.runAfterValidate({
          ...validateCtx,
          validationStatus: validationResult.status,
        });

        const hasOutcomeCheck = validationResult.checks.some(
          (c) => c.type === "outcome_comparison",
        );
        const adaptiveLabel = hasOutcomeCheck ? "Adaptive validation" : "Validation";

        const eventType =
          validationResult.status === "passed"
            ? "validation_passed"
            : validationResult.status === "skipped"
              ? "validation_skipped"
              : "validation_failed";
        await this.eventStore.appendToRun(run.runId, {
          type: eventType,
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

        if (validationResult.status === "skipped") {
          console.log(picocolors.yellow("  Status: done (validation skipped)"));
          break;
        }

        if (validationResult.status === "passed") {
          const message = hasOutcomeCheck
            ? "Status: done (adaptive validation — outcome achieved)"
            : "Status: done (all validations passed)";
          console.log(picocolors.green(`  ${message}`));
          break;
        }

        if (validationResult.status === "needs_review") {
          console.log(
            picocolors.cyan(
              "  AI review indicates human review is needed — continuing to retry if configured",
            ),
          );
        }

        if (validationResult.status === "needs_retry") {
          console.log(picocolors.yellow("  AI review suggests retrying task"));
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
          const errorCtx = buildErrorContext(
            "missing_dependency",
            `Executor command not found: ${errMsg}`,
            {
              source: "executor",
              evidence: errMsg,
              suggestedFix: `Install the required command or configure a different executor. Current: ${task.executor}`,
              details: { executor: task.executor, error: errMsg },
            },
          );
          if (defaultExecutor === task.executor) {
            await this.recordError(run.runId, errorCtx, {
              taskId: task.id,
              suggestedFix: `Install "${task.executor}" or configure a different default executor in .flowtask/config.json`,
            });
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
          await this.recordError(run.runId, errorCtx, {
            taskId: task.id,
            suggestedFix: `Falling back to default executor "${defaultExecutor}". Install "${task.executor}" to use it.`,
          });
          console.log(
            picocolors.yellow(
              `  Executor "${task.executor}" not found, falling back to "${defaultExecutor}"`,
            ),
          );
          task.executor = defaultExecutor;
          retryCount = 0;
          continue;
        }

        // Append validation feedback to context pack for retry
        const suggestion = this.extractValidationSuggestion(validationResult);
        if (suggestion) {
          contextPack = {
            markdown: contextPack.markdown + `\n\n## AI Validation Feedback\n\n${suggestion}\n`,
          };
          await writeTextFile(contextPackPath, contextPack.markdown);
        }

        retryCount++;

        const elapsedMs = Date.now() - new Date(taskStartedAt).getTime();
        const execTimeCheck = this.riskManager.checkExecutionTimeLimit(elapsedMs);
        if (!execTimeCheck.allowed) {
          console.log(picocolors.red(`  ${execTimeCheck.message}`));
          await this.logManager.writeTaskLog(run.runId, task.id, execTimeCheck.message ?? "");
          break;
        }

        const retryLimitCheck = this.riskManager.checkRetryLimit(retryCount);
        if (!retryLimitCheck.allowed) {
          console.log(picocolors.yellow(`  ${retryLimitCheck.message}`));
          await this.logManager.writeTaskLog(run.runId, task.id, retryLimitCheck.message ?? "");
        }

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
              `Hook (afterRetry): ${hook.entry} -> ${hook.success ? "ok" : "fail"}`,
            );
          }
        }

        if (retryCount <= maxRetries && retryLimitCheck.allowed) {
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
          await this.hookManager.runOnStepRetry(beforeRetryCtx);
          const beforeRetryHooks = await this.hookManager.runBeforeRetry(beforeRetryCtx);
          for (const hook of beforeRetryHooks) {
            await this.logManager.writeTaskLog(
              run.runId,
              task.id,
              `Hook (beforeRetry): ${hook.entry} -> ${hook.success ? "ok" : "fail"}`,
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
            await this.hookManager.runOnStepRetry(beforeRetryCtx);
            const beforeRetryHooks = await this.hookManager.runBeforeRetry(beforeRetryCtx);
            for (const hook of beforeRetryHooks) {
              await this.logManager.writeTaskLog(
                run.runId,
                task.id,
                `Hook (beforeRetry): ${hook.entry} -> ${hook.success ? "ok" : "fail"}`,
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
      (validationResult.status === "passed" ||
        validationResult.status === "warning" ||
        validationResult.status === "skipped")
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
      await this.eventStore.appendTimeline(
        run.runId,
        "step_completed",
        completedMsg,
        undefined,
        run.runId,
        task.id,
        "completed",
      );
      await this.eventStore.appendAudit(
        run.runId,
        "step.complete",
        completedMsg,
        { success: true },
        "system",
        task.id,
        "info",
        run.runId,
        task.id,
      );
      await this.logManager.writeTaskLog(run.runId, task.id, completedMsg);
      await this.hookManager.runAfterStep({ ...stepHookCtx, success: true });
      return true;
    }

    await this.hookManager.runOnStepFail({ ...stepHookCtx, error: "Task failed after retries" });
    await this.hookManager.runAfterStep({ ...stepHookCtx, success: false });

    const failureEvidence = validationResult
      ? [
          ...validationResult.checks
            .filter((c) => c.status === "failed")
            .map((c) => `[${c.type}] ${c.message}`),
          ...(validationResult.failureReason
            ? [
                typeof validationResult.failureReason === "string"
                  ? validationResult.failureReason
                  : validationResult.failureReason.reason,
              ]
            : []),
        ].join("; ")
      : (executorResult?.error ?? "Unknown failure");

    const failureReason =
      validationResult?.checks.find((c) => c.status === "failed")?.message ??
      executorResult?.error ??
      "Task failed after retries";

    const errorCtx = buildErrorContext("step_failure", failureReason, {
      source: "workflow",
      evidence: `Retry count: ${retryCount}/${maxRetries}. Validation status: ${validationResult?.status ?? "none"}. ${failureEvidence}`,
      suggestedFix: "Review the task output and validation results. Retry or modify the task.",
      retryable: retryCount <= maxRetries,
      retrySuggestion:
        retryCount <= maxRetries
          ? `Retry the task: flowtask retry ${run.runId} --task ${task.id}`
          : "Max retries reached. Reset retry count or modify the task to fix the issue.",
      userDecisionOptions: [
        { label: "Retry", action: "retry", description: "Retry the failed task" },
        { label: "Skip", action: "skip", description: "Skip this task and continue" },
        { label: "Cancel", action: "cancel", description: "Cancel the entire workflow" },
      ],
      details: {
        retryCount,
        maxRetries,
        validationStatus: validationResult?.status,
        executorStatus: executorResult?.status,
        exitCode: executorResult?.exitCode,
      },
    });
    await this.recordError(run.runId, errorCtx, { taskId: task.id });

    await this.runManager.updateTaskStatus(run.runId, task.id, "failed");
    await this.eventStore.appendToRun(run.runId, {
      type: "task_failed",
      runId: run.runId,
      taskId: task.id,
      message: `Task failed: ${task.title}`,
    });
    await this.eventStore.appendTimeline(
      run.runId,
      "step_failed",
      `Task failed: ${task.title}`,
      { retryCount, evidence: failureEvidence.slice(0, 200) },
      run.runId,
      task.id,
      "failed",
    );
    await this.eventStore.appendAudit(
      run.runId,
      "step.fail",
      `Task failed: ${task.title}`,
      { retryCount: task.retryCount, evidence: failureEvidence.slice(0, 500) },
      "system",
      task.id,
      "error",
      run.runId,
      task.id,
    );

    const adaptivePrefix = validationResult?.checks.some((c) => c.type === "outcome_comparison")
      ? "Adaptive validation failed"
      : "Task failed";
    console.log(picocolors.red(`\n  ${adaptivePrefix}: ${task.title}`));
    if (validationResult) {
      const failed = validationResult.checks.filter((c) => c.status === "failed");
      for (const check of failed) {
        console.log(picocolors.red(`    ${check.type}: ${check.message}`));
      }
      const retrySuggestion = validationResult.retrySuggestion;
      if (retrySuggestion) {
        console.log(picocolors.yellow(`  Suggestion: ${retrySuggestion}`));
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

  private extractValidationSuggestion(validationResult: ValidationResult): string | undefined {
    const aiReviewChecks = validationResult.checks.filter(
      (c) =>
        c.type === "ai_review" &&
        (c.status === "failed" || c.status === "needs_retry" || c.status === "needs_review"),
    );
    if (aiReviewChecks.length > 0) {
      const suggestions = aiReviewChecks
        .map((c) => {
          const verdict = c.details?.verdict;
          return verdict && typeof verdict === "object" && "suggestion" in verdict
            ? (verdict as { suggestion: string }).suggestion
            : undefined;
        })
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      if (suggestions.length > 0) return suggestions.join("\n");
    }

    const failedChecks = validationResult.checks.filter((c) => c.status === "failed");
    if (failedChecks.length > 0) {
      const messages = failedChecks
        .map((c) => c.message)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      if (messages.length > 0) return messages.join("\n");
    }

    return undefined;
  }

  async flushLogs(): Promise<void> {
    await this.logManager.flush();
  }

  private async logAiConnectivity(runId: string): Promise<void> {
    try {
      const registry = new ProviderRegistry(this.config);
      const providers = registry.listProviders();
      const results: Array<{ provider: string; ok: boolean; message: string; latencyMs?: number }> =
        [];

      const keyOnly = providers.filter((p) => p.needsApiKey);
      const noKey = providers.filter((p) => !p.needsApiKey);

      for (const p of noKey) {
        results.push({ provider: p.name, ok: true, message: "No API key needed" });
      }

      const checkResults = await Promise.all(
        keyOnly.map(async (p) => {
          if (!p.apiKeyAvailable) {
            return {
              provider: p.name,
              ok: false,
              message: `${p.apiKeyEnv ?? `${p.name.toUpperCase()}_API_KEY`} not set`,
            };
          }
          try {
            const provider = registry.getProvider(p.name);
            if (provider.healthCheck) {
              const health = await provider.healthCheck({ timeoutMs: 3000 });
              return {
                provider: p.name,
                ok: health.ok,
                message: health.message,
                latencyMs: health.latencyMs,
              };
            }
            return { provider: p.name, ok: true, message: "No health check available" };
          } catch (err) {
            return {
              provider: p.name,
              ok: false,
              message: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      results.push(...checkResults);
      await this.logManager.writeAiConnectivity(runId, results);
    } catch (err) {
      await this.logManager.writeRuntime(
        runId,
        `AI connectivity check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
