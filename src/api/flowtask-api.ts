import type { Project } from "../schemas/project.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import type { Run, RunMode, RunStatus, RunIndex } from "../schemas/run.schema.js";
import type { Task, TaskStatus } from "../schemas/task.schema.js";
import type { Step, StepStatus } from "../schemas/step.schema.js";
import type {
  WorkflowFile,
  WorkflowDiff,
  WorkflowValidationResult,
  WorkflowTask,
} from "../schemas/workflow.schema.js";
import type { ArtifactRecord } from "../schemas/artifact.schema.js";
import type { CheckpointRecord } from "../schemas/checkpoint.schema.js";
import type { TaskResultRecord } from "../schemas/task-result.schema.js";
import type { FlowTaskEvent } from "../schemas/event.schema.js";
import type { ProjectState, RunState } from "../schemas/state.schema.js";
import type { DbStatus } from "../core/database-manager.js";
import type { ReplanStrategy, ReplanResult } from "../core/workflow-replanner.js";
import type {
  ApplyOptions,
  ApplyResult,
  ExportOptions,
  RemoveTaskOptions,
} from "../core/workflow-manager.js";
import type { PlannerMode } from "../planner/planner-registry.js";
import type { QualityGateResult } from "../schemas/quality.schema.js";
import { ProjectManager } from "../core/project-manager.js";
import { RunManager } from "../core/run-manager.js";
import { StateManager } from "../core/state-manager.js";
import { EventStore } from "../core/event-store.js";
import { LogManager } from "../core/log-manager.js";
import { StepManager } from "../core/step-manager.js";
import { DatabaseManager } from "../core/database-manager.js";
import { CheckpointService } from "../core/checkpoint-service.js";
import { ArtifactManager } from "../core/artifact-manager.js";
import { WorkflowManager } from "../core/workflow-manager.js";
import { WorkflowReplanner } from "../core/workflow-replanner.js";
import { RunLifecycle } from "../core/run-lifecycle.js";
import path from "node:path";
import { dbPath } from "../utils/paths.js";

export interface ApiOptions {
  rootPath?: string;
}

export interface RunResult {
  run: Run;
  success: boolean;
}

export class FlowTaskAPI {
  private rootPath: string;
  private db: DatabaseManager | null = null;
  private projectManager: ProjectManager;
  private runManager: RunManager;
  private stateManager: StateManager;
  private eventStore: EventStore;
  private logManager: LogManager;
  private stepManager: StepManager;
  private checkpointService: CheckpointService | null = null;
  private artifactManager: ArtifactManager;
  private _runLifecycle: RunLifecycle | null = null;
  private runLifecyclePromise: Promise<RunLifecycle> | null = null;

  constructor(options: ApiOptions = {}) {
    this.rootPath = options.rootPath ?? process.cwd();
    this.projectManager = new ProjectManager();
    this.runManager = new RunManager(this.rootPath);
    this.stateManager = new StateManager(this.rootPath);
    this.eventStore = new EventStore(this.rootPath);
    this.logManager = new LogManager(this.rootPath);
    this.stepManager = new StepManager(this.rootPath);
    this.artifactManager = new ArtifactManager();
  }

  getRootPath(): string {
    return this.rootPath;
  }

  setRootPath(rootPath: string): void {
    this.rootPath = rootPath;
    this.runManager = new RunManager(rootPath);
    this.stateManager = new StateManager(rootPath);
    this.eventStore = new EventStore(rootPath);
    this.logManager = new LogManager(rootPath);
    this.stepManager = new StepManager(rootPath);
    this._runLifecycle = null;
    this.runLifecyclePromise = null;
  }

  // ── Database ────────────────────────────────────────

  async initDatabase(): Promise<DatabaseManager> {
    const d = await DatabaseManager.create(dbPath(this.rootPath));
    this.db = d;
    this.runManager.setDatabase(d);
    this.stateManager.setDatabase(d);
    this.eventStore.setDatabase(d);
    this.artifactManager.setDatabase(d);
    this.checkpointService = new CheckpointService(d, this.rootPath);
    return d;
  }

  getDatabase(): DatabaseManager | null {
    return this.db;
  }

  async getDbStatus(): Promise<DbStatus | null> {
    if (!this.db) return null;
    return this.db.status();
  }

  async backupDatabase(destPath: string): Promise<boolean> {
    if (!this.db) return false;
    return this.db.backup(destPath);
  }

  async vacuumDatabase(): Promise<void> {
    if (!this.db) return;
    this.db.vacuum();
  }

  async integrityCheck(): Promise<{ valid: boolean; error?: string }> {
    if (!this.db) return { valid: false, error: "Database not initialized" };
    return this.db.integrityCheck();
  }

  // ── Project ─────────────────────────────────────────

  async initProject(name?: string, mode?: string): Promise<Project> {
    return this.projectManager.init(
      this.rootPath,
      name,
      mode as Parameters<ProjectManager["init"]>[2],
    );
  }

  async loadProject(): Promise<Project | null> {
    return this.projectManager.load(this.rootPath);
  }

  async loadProjectState(): Promise<ProjectState | null> {
    return this.stateManager.loadProjectState();
  }

  async saveProjectState(state: ProjectState): Promise<void> {
    return this.stateManager.saveProjectState(state);
  }

  async loadConfig(): Promise<FlowTaskConfig> {
    return this.projectManager.loadConfig(this.rootPath);
  }

  async isInitialized(): Promise<boolean> {
    return this.projectManager.isInitialized(this.rootPath);
  }

  // ── Run ─────────────────────────────────────────────

  async createRun(projectId: string, title: string, mode?: RunMode): Promise<Run> {
    return this.runManager.createRun(projectId, title, mode);
  }

  async loadRun(runId: string): Promise<Run | null> {
    return this.runManager.loadRun(runId);
  }

  async saveRun(run: Run): Promise<void> {
    return this.runManager.saveRun(run);
  }

  async listRuns(projectId?: string): Promise<RunIndex["runs"]> {
    const config = await this.loadProject();
    return this.runManager.listRuns(projectId ?? config?.projectId);
  }

  async updateRunStatus(runId: string, status: RunStatus): Promise<Run> {
    return this.runManager.updateRunStatus(runId, status);
  }

  async deleteRun(runId: string): Promise<void> {
    if (this.db) {
      this.db.deleteRun(runId);
    }
  }

  async inspectRun(runId: string): Promise<{
    run: Run | null;
    tasks: Task[];
    steps: Record<string, Step[]>;
    events: FlowTaskEvent[];
    artifacts: ArtifactRecord[];
    runState: RunState | null;
    checkpoints: CheckpointRecord[];
  }> {
    const run = await this.runManager.loadRun(runId);
    const tasks = await this.runManager.loadTasks(runId);
    const allSteps: Record<string, Step[]> = {};
    for (const task of tasks) {
      allSteps[task.id] = await this.stepManager.loadSteps(runId, task.id);
    }
    const events = await this.eventStore.readRunEvents(runId);
    const artifacts = this.db ? this.db.getArtifactsByRun(runId) : [];
    const runState = await this.stateManager.loadRunState(runId);
    const checkpoints = this.checkpointService ? this.checkpointService.getCheckpoints(runId) : [];
    return { run, tasks, steps: allSteps, events, artifacts, runState, checkpoints };
  }

  async cancelRun(runId: string): Promise<Run> {
    const updated = await this.runManager.updateRunStatus(runId, "cancelled");
    await this.eventStore.appendToRun(runId, {
      type: "run_cancelled",
      runId,
      message: "Run cancelled by user",
    });
    const state = await this.stateManager.loadProjectState();
    if (state) {
      await this.stateManager.saveProjectState({
        ...state,
        status: "idle",
        activeRunId: undefined,
      });
    }
    return updated;
  }

  async cleanRuns(options?: { olderThan?: string; status?: string; dryRun?: boolean }): Promise<{
    deleted: number;
    dryRun: boolean;
    runs: { runId: string; title: string; status: string; createdAt: string }[];
  }> {
    const allRuns = await this.runManager.listRuns();
    const now = new Date();
    const toDelete: typeof allRuns = [];

    for (const r of allRuns) {
      if (options?.status && r.status !== options.status) continue;
      if (options?.olderThan) {
        const match = options.olderThan.match(/^(\d+)([dh])$/);
        if (match) {
          const num = parseInt(match[1]!, 10);
          const unit = match[2]!;
          const age = unit === "d" ? num * 86400000 : num * 3600000;
          const created = new Date(r.createdAt).getTime();
          if (now.getTime() - created < age) continue;
        }
      }
      toDelete.push(r);
    }

    if (!options?.dryRun) {
      for (const r of toDelete) {
        this.db?.deleteRun(r.runId);
      }
    }

    return { deleted: toDelete.length, dryRun: options?.dryRun ?? false, runs: toDelete };
  }

  // ── Task ────────────────────────────────────────────

  async loadTasks(runId: string): Promise<Task[]> {
    return this.runManager.loadTasks(runId);
  }

  async saveTasks(runId: string, tasks: Task[]): Promise<void> {
    return this.runManager.saveTasks(runId, tasks);
  }

  async getTask(runId: string, taskId: string): Promise<Task | undefined> {
    const tasks = await this.runManager.loadTasks(runId);
    return tasks.find((t) => t.id === taskId);
  }

  async updateTaskStatus(runId: string, taskId: string, status: TaskStatus): Promise<Task> {
    return this.runManager.updateTaskStatus(runId, taskId, status);
  }

  async updateTask(
    runId: string,
    taskId: string,
    updates: Partial<
      Pick<Task, "title" | "description" | "executor" | "acceptanceCriteria" | "validation">
    >,
  ): Promise<Task> {
    return this.runManager.updateTask(runId, taskId, updates);
  }

  async approveTask(runId: string, taskId: string): Promise<Task> {
    return this.runManager.updateTaskStatus(runId, taskId, "pending");
  }

  async denyTask(runId: string, taskId: string): Promise<Task> {
    return this.runManager.updateTaskStatus(runId, taskId, "skipped");
  }

  async getNextTask(tasks: Task[]): Promise<Task | null> {
    return this.runManager.getNextTask(tasks);
  }

  async loadTaskOutput(runId: string, taskId: string): Promise<string> {
    return this.runManager.loadTaskOutput(runId, taskId);
  }

  async getTaskResults(taskId: string): Promise<TaskResultRecord[]> {
    if (!this.db) return [];
    return this.db.getResultsByTask(taskId);
  }

  async getTaskResultsByRun(runId: string): Promise<TaskResultRecord[]> {
    if (!this.db) return [];
    return this.db.getResultsByRun(runId);
  }

  // ── Step ────────────────────────────────────────────

  async loadSteps(runId: string, taskId: string): Promise<Step[]> {
    return this.stepManager.loadSteps(runId, taskId);
  }

  async getStep(runId: string, taskId: string, stepId: string): Promise<Step | undefined> {
    return this.stepManager.getStep(runId, taskId, stepId);
  }

  async updateStep(
    runId: string,
    taskId: string,
    stepId: string,
    updates: Partial<Step>,
  ): Promise<Step> {
    return this.stepManager.updateStep(runId, taskId, stepId, updates);
  }

  async updateStepStatus(
    runId: string,
    taskId: string,
    stepId: string,
    status: StepStatus,
  ): Promise<Step> {
    return this.stepManager.updateStepStatus(runId, taskId, stepId, status);
  }

  async approveStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.stepManager.approveStep(runId, taskId, stepId);
  }

  async denyStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.stepManager.denyStep(runId, taskId, stepId);
  }

  async approveAllSteps(runId: string, taskId?: string): Promise<Step[]> {
    if (taskId) {
      return this.stepManager.approveAllPending(runId, taskId);
    }
    return this.stepManager.approveAllPendingForRun(runId);
  }

  async loadAllSteps(runId: string): Promise<Record<string, Step[]>> {
    return this.stepManager.loadAllSteps(runId);
  }

  // ── Workflow ────────────────────────────────────────

  async exportWorkflow(
    runId: string,
    options?: ExportOptions,
  ): Promise<{
    workflow: WorkflowFile;
    yaml: string;
    json: string;
  }> {
    const wm = new WorkflowManager(this.rootPath, this.runManager, this.eventStore);
    return wm.exportWorkflow(runId, options);
  }

  async workflowDiff(runId: string, file: string): Promise<WorkflowDiff> {
    const wm = new WorkflowManager(this.rootPath, this.runManager, this.eventStore);
    const workflow = await wm.loadWorkflowFromFile(file);
    return wm.buildDiff(runId, workflow);
  }

  async workflowApply(runId: string, file: string, options?: ApplyOptions): Promise<ApplyResult> {
    const wm = new WorkflowManager(this.rootPath, this.runManager, this.eventStore);
    const workflow = await wm.loadWorkflowFromFile(file);
    return wm.applyWorkflow(runId, workflow, options);
  }

  async workflowAddTask(
    runId: string,
    taskDef: Partial<WorkflowTask>,
    after?: string,
  ): Promise<Task> {
    const wm = new WorkflowManager(this.rootPath, this.runManager, this.eventStore);
    return wm.addTask(runId, taskDef, after ? { after } : undefined);
  }

  async workflowRemoveTask(
    runId: string,
    taskId: string,
    options?: RemoveTaskOptions,
  ): Promise<void> {
    const wm = new WorkflowManager(this.rootPath, this.runManager, this.eventStore);
    return wm.removeTask(runId, taskId, options);
  }

  async workflowReorder(runId: string, orderedIds: string[]): Promise<void> {
    const wm = new WorkflowManager(this.rootPath, this.runManager, this.eventStore);
    return wm.reorderTasks(runId, orderedIds);
  }

  async workflowValidate(workflow: WorkflowFile): Promise<WorkflowValidationResult> {
    const wm = new WorkflowManager(this.rootPath, this.runManager, this.eventStore);
    return wm.validateWorkflow(workflow);
  }

  async workflowReplan(
    runId: string,
    options?: { strategy?: ReplanStrategy; provider?: string; model?: string },
  ): Promise<ReplanResult> {
    const config = await this.loadConfig();
    const wm = new WorkflowManager(this.rootPath, this.runManager, this.eventStore);
    const replanner = new WorkflowReplanner(
      this.rootPath,
      config,
      this.runManager,
      this.eventStore,
      wm,
    );
    return replanner.replan(runId, options);
  }

  // ── Artifact ────────────────────────────────────────

  async saveArtifact(
    runId: string,
    taskId: string,
    fileName: string,
    content: string,
  ): Promise<import("../core/artifact-manager.js").Artifact> {
    return this.artifactManager.saveArtifact(this.rootPath, runId, taskId, fileName, content);
  }

  async loadArtifact(artifactPath: string): Promise<string | null> {
    return this.artifactManager.loadArtifact(artifactPath);
  }

  async listArtifactsByRun(runId: string): Promise<ArtifactRecord[]> {
    return this.artifactManager.getArtifactsByRun(this.rootPath, runId);
  }

  async listArtifactsByTask(taskId: string): Promise<ArtifactRecord[]> {
    return this.artifactManager.getArtifactsByTask(this.rootPath, taskId);
  }

  // ── Checkpoint ──────────────────────────────────────

  async getLatestCheckpoint(
    runId: string,
  ): Promise<import("../core/checkpoint-service.js").CheckpointResult | null> {
    if (!this.checkpointService) return null;
    return this.checkpointService.loadLatestCheckpoint(runId);
  }

  async listCheckpoints(runId: string): Promise<CheckpointRecord[]> {
    if (!this.checkpointService) return [];
    return this.checkpointService.getCheckpoints(runId);
  }

  async cleanCheckpoints(runId: string, keepCount?: number): Promise<void> {
    if (!this.checkpointService) return;
    this.checkpointService.cleanOldCheckpoints(runId, keepCount);
  }

  // ── Events ─────────────────────────────────────────

  async readRunEvents(runId: string): Promise<FlowTaskEvent[]> {
    return this.eventStore.readRunEvents(runId);
  }

  queryEvents(runId?: string, type?: string, limit?: number): FlowTaskEvent[] {
    return this.eventStore.queryEvents(runId, type, limit);
  }

  async appendEvent(runId: string, event: Omit<FlowTaskEvent, "time">): Promise<void> {
    return this.eventStore.appendToRun(runId, event);
  }

  // ── Logs ────────────────────────────────────────────

  async readRuntimeLog(runId: string): Promise<string> {
    return this.logManager.readRuntime(runId);
  }

  async readValidationLog(runId: string): Promise<string> {
    return this.logManager.readValidation(runId);
  }

  async readTaskLog(runId: string, taskId: string): Promise<string> {
    return this.logManager.readTaskLog(runId, taskId);
  }

  async listLogFiles(runId: string): Promise<string[]> {
    return this.logManager.listLogFiles(runId);
  }

  // ── Config ──────────────────────────────────────────

  async getConfig(): Promise<FlowTaskConfig> {
    return this.projectManager.loadConfig(this.rootPath);
  }

  async getConfigValue(key: string): Promise<unknown> {
    const { configJsonPath } = await import("../utils/paths.js");
    const { fileExists, readJsonFile } = await import("../utils/fs.js");
    const cPath = configJsonPath(this.rootPath);
    if (!(await fileExists(cPath))) return undefined;
    const raw = await readJsonFile<Record<string, unknown>>(cPath);
    const parts = key.split(".");
    let val: unknown = raw;
    for (const part of parts) {
      if (val && typeof val === "object") {
        val = (val as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return val;
  }

  async setConfigValue(key: string, value: unknown): Promise<void> {
    const { atomicWriteJsonFile, readJsonFile, fileExists } = await import("../utils/fs.js");
    const { configJsonPath } = await import("../utils/paths.js");
    const cPath = configJsonPath(this.rootPath);
    let config: Record<string, unknown> = {};
    if (await fileExists(cPath)) {
      config = await readJsonFile<Record<string, unknown>>(cPath);
    }
    const parts = key.split(".");
    let current = config;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current) || typeof current[part] !== "object") {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]!] = value;
    await atomicWriteJsonFile(cPath, config);
  }

  async listConfigKeys(): Promise<string[]> {
    const config = await this.getConfig();
    const keys: string[] = [];
    function collect(obj: Record<string, unknown>, prefix: string): void {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          collect(value as Record<string, unknown>, fullKey);
        } else {
          keys.push(fullKey);
        }
      }
    }
    collect(config as unknown as Record<string, unknown>, "");
    return keys.sort();
  }

  // ── Run Lifecycle ───────────────────────────────────

  private async getRunLifecycle(): Promise<RunLifecycle> {
    if (this._runLifecycle) return this._runLifecycle;
    if (this.runLifecyclePromise) return this.runLifecyclePromise;
    this.runLifecyclePromise = (async () => {
      const config = await this.loadConfig();
      const project = await this.loadProject();
      const lifecycle = new RunLifecycle(this.rootPath, project?.projectId ?? "unknown", config);
      if (this.db) {
        lifecycle.initDatabase();
      }
      this._runLifecycle = lifecycle;
      return lifecycle;
    })();
    return this.runLifecyclePromise;
  }

  private async withRunLifecycle<T>(fn: (lifecycle: RunLifecycle) => Promise<T>): Promise<T> {
    const lifecycle = await this.getRunLifecycle();
    return fn(lifecycle);
  }

  async executeRun(
    prompt: string,
    options?: {
      mode?: RunMode;
      template?: string;
      debug?: boolean;
      plannerMode?: PlannerMode;
      quality?: boolean;
      defaultExecutor?: string;
      approvalMode?: string;
    },
  ): Promise<RunResult> {
    return this.withRunLifecycle((lifecycle) => lifecycle.executeRun(prompt, options));
  }

  async resumeRun(
    runId: string,
    quality?: boolean,
  ): Promise<{ success: boolean; paused: boolean }> {
    return this.withRunLifecycle((lifecycle) => lifecycle.continueRun(runId, quality));
  }

  async retryTask(runId: string, taskId: string): Promise<boolean> {
    return this.withRunLifecycle((lifecycle) => lifecycle.executeSingleTask(runId, taskId));
  }

  async runQualityGate(
    runId: string,
    qualityEnabled: boolean,
    commands: string[],
  ): Promise<QualityGateResult | null> {
    return this.withRunLifecycle((lifecycle) =>
      lifecycle.runQualityGate(runId, qualityEnabled, commands),
    );
  }

  async flushLogs(): Promise<void> {
    if (this._runLifecycle) {
      await this._runLifecycle.flushLogs();
    }
  }

  // ── State ───────────────────────────────────────────

  async loadRunState(runId: string): Promise<RunState | null> {
    return this.stateManager.loadRunState(runId);
  }

  async saveRunState(runId: string, state: RunState): Promise<void> {
    return this.stateManager.saveRunState(runId, state);
  }

  // ── Scan / TaskContext ─────────────────────────────

  async getTaskContext(
    prompt: string,
    cacheDir?: string,
  ): Promise<{
    context: import("../context/task-context-builder.js").TaskContext;
    summary: string;
  }> {
    const { TaskContextBuilder } = await import("../context/task-context-builder.js");
    const cache = cacheDir ?? path.join(this.rootPath, ".flowtask", "cache");
    const builder = new TaskContextBuilder({ cacheDir: cache, useCache: true });

    try {
      const ctx = await builder.build(this.rootPath, prompt);
      const summary = builder.formatSummary(ctx);
      return { context: ctx, summary };
    } catch (err) {
      throw new Error(
        `Failed to build TaskContext: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Info ────────────────────────────────────────────

  async getProjectStatus(): Promise<{
    initialized: boolean;
    project: Project | null;
    state: ProjectState | null;
    config: FlowTaskConfig | null;
    dbStatus: DbStatus | null;
  }> {
    const initialized = await this.isInitialized();
    const project = initialized ? await this.loadProject() : null;
    const state = initialized ? await this.loadProjectState() : null;
    let config: FlowTaskConfig | null = null;
    if (initialized) {
      try {
        config = await this.loadConfig();
      } catch {
        config = null;
      }
    }
    const dbStatus = this.db ? this.db.status() : null;
    return { initialized, project, state, config, dbStatus };
  }
}

export type FlowTaskApiInstance = FlowTaskAPI;
