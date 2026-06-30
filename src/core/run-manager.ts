import path from "node:path";
import {
  type Run,
  type RunIndex,
  type RunIndexEntry,
  type RunFilterOptions,
  type TimelineEvent,
  type TimelineEventType,
  type CostUsage,
  type TokenUsage,
  type RunApproval,
  type RunError,
  type RunFileChange,
  type RunExport,
  type RunComparison,
  RunSchema,
  RunIndexSchema,
  isRunTerminal,
} from "../schemas/run.schema.js";
import { type Task, type TaskIndex, TaskSchema, TaskIndexSchema } from "../schemas/task.schema.js";
import {
  fileExists,
  readJsonFile,
  readTextFile,
  atomicWriteJsonFile,
  ensureDir,
  writeTextFile,
  readDir,
} from "../utils/fs.js";
import {
  getRunDir,
  runJsonPath,
  promptMdPath,
  rulesContextPath,
  planMdPath,
  tasksJsonPath,
  runIndexPath,
  taskIndexPath,
  getLogsDir,
  getContextDir,
  getArtifactsDir,
  getOutputsDir,
  getSnapshotsDir,
  finalReportPath,
  eventsJsonlPath,
  stepsJsonPath,
  getFileChangesDir,
  getFileSnapshotsDir,
} from "../utils/paths.js";
import { now, elapsedMs } from "../utils/time.js";
import { generateRunId } from "../utils/ids.js";
import type { DatabaseManager } from "./database-manager.js";

export class RunManager {
  private rootPath: string;
  private db: DatabaseManager | null = null;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  getDatabase(): DatabaseManager | null {
    return this.db;
  }

  async createRun(
    projectId: string,
    title: string,
    mode: Run["mode"] = "auto",
    userGoal?: string,
  ): Promise<Run> {
    const timestamp = now();
    const sanitized = title.replace(/[/\\\0:]/g, "_").replace(/\.\./g, "");
    const truncatedTitle = sanitized.slice(0, 200);
    const runId = generateRunId(truncatedTitle);
    const run: Run = {
      runId,
      projectId,
      title: truncatedTitle,
      status: "created",
      mode,
      userGoal: userGoal ?? truncatedTitle,
      taskCount: 0,
      completedTaskCount: 0,
      artifactCount: 0,
      fileChangeCount: 0,
      errorCount: 0,
      retryCount: 0,
      approvalCount: 0,
      timeline: [
        {
          type: "workflow_created",
          timestamp,
          message: "Workflow created",
        },
      ],
      approvals: [],
      errors: [],
      fileChanges: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const runDir = getRunDir(this.rootPath, runId);
    await ensureDir(runDir);
    await ensureDir(getLogsDir(this.rootPath, runId));
    await ensureDir(getContextDir(this.rootPath, runId));
    await ensureDir(getArtifactsDir(this.rootPath, runId));
    await ensureDir(getOutputsDir(this.rootPath, runId));
    await ensureDir(getSnapshotsDir(this.rootPath, runId));
    await ensureDir(getFileChangesDir(this.rootPath, runId));
    await ensureDir(getFileSnapshotsDir(this.rootPath, runId));

    await atomicWriteJsonFile(runJsonPath(this.rootPath, runId), run);

    await this.updateRunIndex(projectId, run);

    if (this.db) {
      try {
        this.db.insertRun(run);
      } catch {
        // DB is secondary; file is source of truth
      }
    }

    return run;
  }

  async loadRun(runId: string): Promise<Run | null> {
    const rPath = runJsonPath(this.rootPath, runId);
    const exists = await fileExists(rPath);
    if (!exists) return null;
    try {
      const raw = await readJsonFile<Record<string, unknown>>(rPath);
      const result = RunSchema.safeParse(raw);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  async saveRun(run: Run): Promise<void> {
    const updated = { ...run, updatedAt: now() };
    await atomicWriteJsonFile(runJsonPath(this.rootPath, run.runId), updated);

    if (this.db) {
      try {
        this.db.insertRun(updated);
      } catch {
        // DB is secondary
      }
    }
  }

  async savePrompt(runId: string, prompt: string): Promise<void> {
    await writeTextFile(promptMdPath(this.rootPath, runId), prompt);
  }

  async saveRulesContext(runId: string, content: string): Promise<void> {
    await writeTextFile(rulesContextPath(this.rootPath, runId), content);
  }

  async savePlan(runId: string, markdown: string): Promise<void> {
    await writeTextFile(planMdPath(this.rootPath, runId), markdown);
    const run = await this.loadRun(runId);
    if (run) {
      run.planMd = markdown;
      await this.saveRun(run);
    }
  }

  async saveTasks(runId: string, tasks: Task[]): Promise<void> {
    await atomicWriteJsonFile(tasksJsonPath(this.rootPath, runId), {
      runId,
      tasks,
    });
    await this.updateTaskIndex(tasks);

    const run = await this.loadRun(runId);
    if (run) {
      const completed = tasks.filter((t) => t.status === "done").length;
      run.taskCount = tasks.length;
      run.completedTaskCount = completed;
      await this.saveRun(run);
    }

    if (this.db) {
      try {
        for (const task of tasks) {
          this.db.insertTask(task);
        }
      } catch {
        // DB is secondary
      }
    }
  }

  async loadTasks(runId: string): Promise<Task[]> {
    const tPath = tasksJsonPath(this.rootPath, runId);
    const exists = await fileExists(tPath);
    if (!exists) return [];
    try {
      const raw = await readJsonFile<Record<string, unknown>>(tPath);
      const data = raw as { tasks: unknown[] };
      if (!Array.isArray(data.tasks)) return [];
      const tasks: Task[] = [];
      for (const item of data.tasks) {
        const result = TaskSchema.safeParse(item);
        if (result.success) tasks.push(result.data);
      }
      return tasks;
    } catch {
      return [];
    }
  }

  async saveFinalReport(runId: string, reportContent: string): Promise<void> {
    await writeTextFile(finalReportPath(this.rootPath, runId), reportContent);
    const run = await this.loadRun(runId);
    if (run) {
      run.finalReportMd = reportContent;
      run.finalReportPath = finalReportPath(this.rootPath, runId);
      await this.saveRun(run);
    }
  }

  async listRuns(projectId?: string): Promise<RunIndexEntry[]> {
    if (this.db && projectId) {
      try {
        const runs = this.db.listRuns(projectId);
        return runs.map((r) => ({
          runId: r.runId,
          title: r.title,
          status: r.status as Run["status"],
          mode: r.mode as Run["mode"] | undefined,
          userGoal: r.userGoal,
          taskCount: r.taskCount ?? 0,
          completedTaskCount: r.completedTaskCount ?? 0,
          errorCount: r.errorCount ?? 0,
          retryCount: r.retryCount ?? 0,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          durationMs: r.durationMs,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
      } catch {
        // fall through to file-based
      }
    }

    const idxPath = runIndexPath(this.rootPath);
    const exists = await fileExists(idxPath);
    if (!exists) return [];
    try {
      const raw = await readJsonFile<Record<string, unknown>>(idxPath);
      const result = RunIndexSchema.safeParse(raw);
      return result.success ? result.data.runs : [];
    } catch {
      return [];
    }
  }

  async getRunDir(runId: string): Promise<string> {
    return getRunDir(this.rootPath, runId);
  }

  private async updateRunIndex(projectId: string, run: Run): Promise<void> {
    const idxPath = runIndexPath(this.rootPath);
    let index: RunIndex = { projectId, runs: [] };
    if (await fileExists(idxPath)) {
      try {
        const raw = await readJsonFile<Record<string, unknown>>(idxPath);
        const result = RunIndexSchema.safeParse(raw);
        if (result.success) index = result.data;
      } catch {
        // start fresh
      }
    }
    const existingIdx = index.runs.findIndex((r) => r.runId === run.runId);
    const entry: RunIndexEntry = {
      runId: run.runId,
      title: run.title,
      status: run.status,
      mode: run.mode,
      userGoal: run.userGoal,
      taskCount: run.taskCount,
      completedTaskCount: run.completedTaskCount,
      errorCount: run.errorCount,
      retryCount: run.retryCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      createdAt: run.createdAt,
      updatedAt: now(),
    };
    if (existingIdx >= 0) {
      index.runs[existingIdx] = entry;
    } else {
      index.runs.push(entry);
    }
    await atomicWriteJsonFile(idxPath, index);
  }

  private async updateTaskIndex(tasks: Task[]): Promise<void> {
    const idxPath = taskIndexPath(this.rootPath);
    let index: TaskIndex = { projectId: "", tasks: [] };
    if (await fileExists(idxPath)) {
      try {
        const raw = await readJsonFile<Record<string, unknown>>(idxPath);
        const result = TaskIndexSchema.safeParse(raw);
        if (result.success) index = result.data;
      } catch {
        // start fresh
      }
    }
    for (const task of tasks) {
      const existingIdx = index.tasks.findIndex((t) => t.taskId === task.id);
      const entry = {
        taskId: task.id,
        runId: task.runId,
        title: task.title,
        status: task.status,
      };
      if (existingIdx >= 0) {
        index.tasks[existingIdx] = entry;
      } else {
        index.tasks.push(entry);
      }
    }
    await atomicWriteJsonFile(idxPath, index);
  }

  getNextTask(tasks: Task[]): Task | null {
    const pending = tasks.filter(
      (t) =>
        t.status === "pending" &&
        t.dependsOn.every((dep) => {
          const depTask = tasks.find((dt) => dt.id === dep);
          return depTask?.status === "done" || depTask?.status === "skipped";
        }),
    );
    return pending[0] ?? null;
  }

  async updateRunStatus(runId: string, status: Run["status"]): Promise<Run> {
    const run = await this.loadRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const updated = { ...run, status, updatedAt: now() };

    if (status === "running" && !updated.startedAt) {
      updated.startedAt = now();
    }
    if (isRunTerminal(status) && !updated.finishedAt) {
      updated.finishedAt = now();
      if (updated.startedAt) {
        updated.durationMs = elapsedMs(updated.startedAt, updated.finishedAt);
      }
    }

    await this.saveRun(updated);
    await this.updateRunIndex(run.projectId, updated);
    return updated;
  }

  async updateTaskStatus(
    runId: string,
    taskId: string,
    status: Task["status"],
    retryCount?: number,
  ): Promise<Task> {
    const tasks = await this.loadTasks(runId);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) throw new Error(`Task not found: ${taskId}`);
    const existing = tasks[idx]!;
    const updated: Task = {
      ...existing,
      status,
      ...(retryCount !== undefined ? { retryCount } : {}),
      updatedAt: now(),
    };
    tasks[idx] = updated;
    await this.saveTasks(runId, tasks);
    return updated;
  }

  async updateTask(
    runId: string,
    taskId: string,
    updates: Partial<
      Pick<
        Task,
        | "title"
        | "description"
        | "executor"
        | "acceptanceCriteria"
        | "validation"
        | "retryCount"
        | "status"
      >
    >,
  ): Promise<Task> {
    const tasks = await this.loadTasks(runId);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) throw new Error(`Task not found: ${taskId}`);
    const existing = tasks[idx]!;
    const updated = { ...existing, ...updates, updatedAt: now() };
    tasks[idx] = updated;
    await this.saveTasks(runId, tasks);
    return updated;
  }

  async loadTaskOutput(runId: string, taskId: string): Promise<string> {
    const logDir = getLogsDir(this.rootPath, runId);
    const logPath = path.join(logDir, `${taskId}.log`);
    try {
      return await readTextFile(logPath);
    } catch {
      return "";
    }
  }

  async loadPrompt(runId: string): Promise<string> {
    try {
      return await readTextFile(promptMdPath(this.rootPath, runId));
    } catch {
      return runId;
    }
  }

  async loadRulesContext(runId: string): Promise<string> {
    try {
      return await readTextFile(rulesContextPath(this.rootPath, runId));
    } catch {
      return "";
    }
  }

  // ── Run History / Search / Filter ─────────────────────

  async searchRuns(query: string): Promise<RunIndexEntry[]> {
    const all = await this.listRuns();
    const q = query.toLowerCase();
    return all.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.userGoal?.toLowerCase().includes(q) ?? false),
    );
  }

  async filterRuns(filters: RunFilterOptions): Promise<RunIndexEntry[]> {
    let all = await this.listRuns();

    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      all = all.filter((r) => statuses.includes(r.status));
    }

    if (filters.mode) {
      const modes = Array.isArray(filters.mode) ? filters.mode : [filters.mode];
      all = all.filter((r) => r.mode && modes.includes(r.mode));
    }

    if (filters.createdAfter) {
      const after = new Date(filters.createdAfter).getTime();
      all = all.filter((r) => new Date(r.createdAt).getTime() >= after);
    }

    if (filters.createdBefore) {
      const before = new Date(filters.createdBefore).getTime();
      all = all.filter((r) => new Date(r.createdAt).getTime() <= before);
    }

    if (filters.updatedAfter) {
      const after = new Date(filters.updatedAfter).getTime();
      all = all.filter((r) => new Date(r.updatedAt).getTime() >= after);
    }

    if (filters.updatedBefore) {
      const before = new Date(filters.updatedBefore).getTime();
      all = all.filter((r) => new Date(r.updatedAt).getTime() <= before);
    }

    if (filters.hasErrors) {
      all = all.filter((r) => (r.errorCount ?? 0) > 0);
    }

    if (filters.hasUnfinished) {
      all = all.filter((r) => !isRunTerminal(r.status) && r.status !== "created");
    }

    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      all = all.filter(
        (r) =>
          r.title.toLowerCase().includes(q) || (r.userGoal?.toLowerCase().includes(q) ?? false),
      );
    }

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return all.slice(offset, offset + limit);
  }

  async getRunSummary(runId: string): Promise<Run | null> {
    return this.loadRun(runId);
  }

  async getRunTimeline(runId: string): Promise<TimelineEvent[]> {
    const run = await this.loadRun(runId);
    return run?.timeline ?? [];
  }

  async appendTimelineEvent(
    runId: string,
    type: TimelineEventType,
    message?: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    const event: TimelineEvent = {
      type,
      timestamp: now(),
      message,
      details,
    };
    run.timeline = [...(run.timeline ?? []), event];
    await this.saveRun(run);
  }

  async updateCostUsage(runId: string, costUsage: CostUsage): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    run.costUsage = costUsage;
    await this.saveRun(run);
  }

  async updateTokenUsage(runId: string, tokenUsage: TokenUsage): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    run.tokenUsage = tokenUsage;
    await this.saveRun(run);
  }

  async addRunError(runId: string, error: Omit<RunError, "timestamp">): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    const entry: RunError = {
      stepId: error.stepId,
      taskId: error.taskId,
      message: error.message,
      timestamp: now(),
      retryCount: error.retryCount,
      evidence: error.evidence,
      suggestedFix: error.suggestedFix,
    };
    run.errors = [...(run.errors ?? []), entry];
    run.errorCount = (run.errorCount ?? 0) + 1;
    await this.saveRun(run);
  }

  async addRunApproval(
    runId: string,
    approval: Omit<RunApproval, "id" | "requestedAt"> & { id?: string },
  ): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    const entry: RunApproval = {
      ...approval,
      id: approval.id ?? `approval_${Date.now()}`,
      requestedAt: now(),
    };
    run.approvals = [...(run.approvals ?? []), entry];
    run.approvalCount = (run.approvalCount ?? 0) + 1;
    await this.saveRun(run);
  }

  async resolveRunApproval(
    runId: string,
    approvalId: string,
    status: "approved" | "rejected",
    reason?: string,
  ): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    const idx = (run.approvals ?? []).findIndex((a) => a.id === approvalId);
    if (idx < 0) return;
    const updated = [...(run.approvals ?? [])];
    updated[idx] = {
      ...updated[idx]!,
      status,
      resolvedAt: now(),
      reason: reason ?? updated[idx]!.reason,
    };
    run.approvals = updated;
    await this.saveRun(run);
  }

  async addRunFileChange(runId: string, change: RunFileChange): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    const normalized = { expected: true as boolean | undefined, ...change };
    run.fileChanges = [...(run.fileChanges ?? []), normalized];
    run.fileChangeCount = (run.fileChangeCount ?? 0) + 1;
    await this.saveRun(run);
  }

  async incrementRunRetryCount(runId: string): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    run.retryCount = (run.retryCount ?? 0) + 1;
    await this.saveRun(run);
  }

  async incrementRunArtifactCount(runId: string): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    run.artifactCount = (run.artifactCount ?? 0) + 1;
    await this.saveRun(run);
  }

  async setUserGoal(runId: string, userGoal: string): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    run.userGoal = userGoal;
    await this.saveRun(run);
  }

  // ── Duplicate Run ─────────────────────────────────────

  async duplicateRun(
    runId: string,
    newTitle?: string,
    options?: { includeTasks?: boolean; includeArtifacts?: boolean },
  ): Promise<Run> {
    const source = await this.loadRun(runId);
    if (!source) throw new Error(`Source run not found: ${runId}`);

    const projectId = source.projectId;
    const title = newTitle ?? `${source.title} (copy)`;
    const timestamp = now();

    const sanitized = title.replace(/[/\\\0:]/g, "_").replace(/\.\./g, "");
    const newRunId = generateRunId(sanitized);

    const newRun: Run = {
      runId: newRunId,
      projectId,
      title: sanitized.slice(0, 200),
      status: "created",
      mode: source.mode,
      userGoal: source.userGoal,
      taskCount: 0,
      completedTaskCount: 0,
      artifactCount: 0,
      fileChangeCount: 0,
      errorCount: 0,
      retryCount: 0,
      approvalCount: 0,
      timeline: [
        {
          type: "workflow_created",
          timestamp,
          message: `Duplicated from run ${runId}`,
        },
      ],
      approvals: [],
      errors: [],
      fileChanges: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const runDir = getRunDir(this.rootPath, newRunId);
    await ensureDir(runDir);
    await ensureDir(getLogsDir(this.rootPath, newRunId));
    await ensureDir(getContextDir(this.rootPath, newRunId));
    await ensureDir(getArtifactsDir(this.rootPath, newRunId));
    await ensureDir(getOutputsDir(this.rootPath, newRunId));
    await ensureDir(getSnapshotsDir(this.rootPath, newRunId));
    await ensureDir(getFileChangesDir(this.rootPath, newRunId));
    await ensureDir(getFileSnapshotsDir(this.rootPath, newRunId));

    await atomicWriteJsonFile(runJsonPath(this.rootPath, newRunId), newRun);
    await this.updateRunIndex(projectId, newRun);

    if (this.db) {
      try {
        this.db.insertRun(newRun);
      } catch {
        // DB is secondary
      }
    }

    if (options?.includeTasks !== false) {
      const sourceTasks = await this.loadTasks(runId);
      if (sourceTasks.length > 0) {
        const newTasks: Task[] = sourceTasks.map((t) => ({
          ...t,
          id: t.id,
          runId: newRunId,
          status: "pending" as const,
          retryCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        }));
        await this.saveTasks(newRunId, newTasks);
      }
    }

    return newRun;
  }

  // ── Compare Runs ──────────────────────────────────────

  async compareRuns(runId1: string, runId2: string): Promise<RunComparison> {
    const run1 = await this.loadRun(runId1);
    const run2 = await this.loadRun(runId2);

    if (!run1) throw new Error(`Run not found: ${runId1}`);
    if (!run2) throw new Error(`Run not found: ${runId2}`);

    const timeBetween =
      run1.createdAt && run2.createdAt
        ? Math.abs(new Date(run2.createdAt).getTime() - new Date(run1.createdAt).getTime())
        : undefined;

    return {
      run1: {
        runId: run1.runId,
        title: run1.title,
        status: run1.status,
        taskCount: run1.taskCount,
        completedTaskCount: run1.completedTaskCount,
        errorCount: run1.errorCount ?? 0,
        createdAt: run1.createdAt,
      },
      run2: {
        runId: run2.runId,
        title: run2.title,
        status: run2.status,
        taskCount: run2.taskCount,
        completedTaskCount: run2.completedTaskCount,
        errorCount: run2.errorCount ?? 0,
        createdAt: run2.createdAt,
      },
      sameProject: run1.projectId === run2.projectId,
      statusMatch: run1.status === run2.status,
      taskCountDiff: run2.taskCount - run1.taskCount,
      completedDiff: run2.completedTaskCount - run1.completedTaskCount,
      errorDiff: (run2.errorCount ?? 0) - (run1.errorCount ?? 0),
      timeBetween,
    };
  }

  async compareRunsDetailed(
    runId1: string,
    runId2: string,
  ): Promise<{
    comparison: RunComparison;
    tasks1: Task[];
    tasks2: Task[];
    taskDiff: {
      onlyIn1: Task[];
      onlyIn2: Task[];
      both: { id: string; status1: string; status2: string; changed: boolean }[];
    };
  }> {
    const comparison = await this.compareRuns(runId1, runId2);
    const tasks1 = await this.loadTasks(runId1);
    const tasks2 = await this.loadTasks(runId2);

    const map1 = new Map(tasks1.map((t) => [t.id, t]));
    const map2 = new Map(tasks2.map((t) => [t.id, t]));

    const onlyIn1: Task[] = [];
    const onlyIn2: Task[] = [];
    const both: { id: string; status1: string; status2: string; changed: boolean }[] = [];

    for (const t of tasks1) {
      if (map2.has(t.id)) {
        const t2 = map2.get(t.id)!;
        both.push({
          id: t.id,
          status1: t.status,
          status2: t2.status,
          changed: t.status !== t2.status,
        });
      } else {
        onlyIn1.push(t);
      }
    }

    for (const t of tasks2) {
      if (!map1.has(t.id)) {
        onlyIn2.push(t);
      }
    }

    return { comparison, tasks1, tasks2, taskDiff: { onlyIn1, onlyIn2, both } };
  }

  // ── Export Run ────────────────────────────────────────

  async exportRun(
    runId: string,
    format: "json" | "yaml" = "json",
  ): Promise<{ data: RunExport; content: string }> {
    const run = await this.loadRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    const tasks = await this.loadTasks(runId);

    let steps: Record<string, unknown[]> | undefined;
    try {
      const sPath = stepsJsonPath(this.rootPath, runId);
      if (await fileExists(sPath)) {
        const raw = await readJsonFile<Record<string, unknown[]>>(sPath);
        steps = raw?.stepsByTask as unknown as Record<string, unknown[]> | undefined;
      }
    } catch {
      // steps may not exist
    }

    let artifacts: unknown[] | undefined;
    if (this.db) {
      try {
        const artifactRecords = this.db.getArtifactsByRun(runId);
        artifacts = artifactRecords;
      } catch {
        // artifacts may not exist
      }
    }

    let events: unknown[] | undefined;
    try {
      const ePath = eventsJsonlPath(this.rootPath, runId);
      if (await fileExists(ePath)) {
        const raw = await readTextFile(ePath);
        events = raw
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }
    } catch {
      // events may not exist
    }

    const exportData: RunExport = {
      run,
      tasks,
      steps,
      artifacts,
      events,
      exportedAt: now(),
      exportVersion: "1.0",
    };

    let content: string;
    if (format === "yaml") {
      const yamlModule = await import("js-yaml");
      content = yamlModule.dump(exportData, { indent: 2, lineWidth: 120, noRefs: true });
    } else {
      content = JSON.stringify(exportData, null, 2);
    }

    return { data: exportData, content };
  }

  async exportRunToFile(
    runId: string,
    outputPath: string,
    format?: "json" | "yaml",
  ): Promise<string> {
    const ext =
      format ?? (outputPath.endsWith(".yaml") || outputPath.endsWith(".yml") ? "yaml" : "json");
    const { content } = await this.exportRun(runId, ext);
    await writeTextFile(outputPath, content);
    return outputPath;
  }

  // ── Resume / History Helpers ──────────────────────────

  async getRunCostUsage(runId: string): Promise<CostUsage | null> {
    const run = await this.loadRun(runId);
    return run?.costUsage ?? null;
  }

  async getRunTokenUsage(runId: string): Promise<TokenUsage | null> {
    const run = await this.loadRun(runId);
    return run?.tokenUsage ?? null;
  }

  async getRunErrors(runId: string): Promise<RunError[]> {
    const run = await this.loadRun(runId);
    return run?.errors ?? [];
  }

  async getRunApprovals(runId: string): Promise<RunApproval[]> {
    const run = await this.loadRun(runId);
    return run?.approvals ?? [];
  }

  async getRunFileChanges(runId: string): Promise<RunFileChange[]> {
    const run = await this.loadRun(runId);
    return run?.fileChanges ?? [];
  }

  async getRunFinalReport(runId: string): Promise<string | null> {
    const run = await this.loadRun(runId);
    if (run?.finalReportPath) {
      try {
        return await readTextFile(run.finalReportPath);
      } catch {
        return run.finalReportMd ?? null;
      }
    }
    return run?.finalReportMd ?? null;
  }

  async deleteRunData(runId: string): Promise<void> {
    const runDir = getRunDir(this.rootPath, runId);
    try {
      const { removeDir } = await import("../utils/fs.js");
      await removeDir(runDir);
    } catch {
      // ignore
    }

    const idxPath = runIndexPath(this.rootPath);
    if (await fileExists(idxPath)) {
      try {
        const raw = await readJsonFile<Record<string, unknown>>(idxPath);
        const result = RunIndexSchema.safeParse(raw);
        if (result.success) {
          const updated: RunIndex = {
            ...result.data,
            runs: result.data.runs.filter((r) => r.runId !== runId),
          };
          await atomicWriteJsonFile(idxPath, updated);
        }
      } catch {
        // ignore
      }
    }

    if (this.db) {
      try {
        this.db.deleteRun(runId);
      } catch {
        // DB is secondary
      }
    }
  }

  async getRunLogContent(
    runId: string,
    type: "runtime" | "validation" = "runtime",
  ): Promise<string> {
    const logDir = getLogsDir(this.rootPath, runId);
    const logName = type === "validation" ? "validation.log" : "runtime.log";
    try {
      return await readTextFile(path.join(logDir, logName));
    } catch {
      return "";
    }
  }

  async listRunLogFiles(runId: string): Promise<string[]> {
    const logDir = getLogsDir(this.rootPath, runId);
    try {
      const files = await readDir(logDir);
      return files.filter((f) => f.endsWith(".log") || f.endsWith(".jsonl"));
    } catch {
      return [];
    }
  }

  async updateRunMetadata(runId: string, metadata: Record<string, unknown>): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    run.metadata = { ...(run.metadata ?? {}), ...metadata };
    await this.saveRun(run);
  }

  // ── Performance: Cleanup / Retention ──────────────────

  async cleanupOldRuns(options: {
    olderThanDays?: number;
    keepLast?: number;
    preserveFailed?: boolean;
    preserveLastSuccessful?: boolean;
  }): Promise<{ deleted: number; freedBytes: number }> {
    const runs = await this.listRuns();
    const now_ts = Date.now();
    let deleted = 0;
    let freedBytes = 0;

    const sorted = [...runs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const keep = options.keepLast ?? 0;
    const preserveFailed = options.preserveFailed ?? false;
    const preserveLastSuccessful = options.preserveLastSuccessful ?? false;
    const olderThanMs = options.olderThanDays ? options.olderThanDays * 86400 * 1000 : 0;

    let lastSuccessfulPreserved = false;

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]!;

      if (i < keep) continue;

      if (olderThanMs > 0) {
        const age = now_ts - new Date(entry.createdAt).getTime();
        if (age < olderThanMs) continue;
      }

      if (preserveFailed && entry.status === "failed") continue;

      if (preserveLastSuccessful && !lastSuccessfulPreserved && entry.status === "succeeded") {
        lastSuccessfulPreserved = true;
        continue;
      }

      const runDir = getRunDir(this.rootPath, entry.runId);
      try {
        const { removeDir } = await import("../utils/fs.js");
        freedBytes += await this.estimateDirSize(runDir);
        await removeDir(runDir);
        deleted++;
      } catch {
        // ignore
      }
    }

    if (deleted > 0) {
      const idxPath = runIndexPath(this.rootPath);
      if (await fileExists(idxPath)) {
        try {
          const raw = await readJsonFile<Record<string, unknown>>(idxPath);
          const result = RunIndexSchema.safeParse(raw);
          if (result.success) {
            const remainingIds = new Set(sorted.slice(0, keep).map((r) => r.runId));
            const updated: RunIndex = {
              ...result.data,
              runs: result.data.runs.filter((r) => remainingIds.has(r.runId)),
            };
            await atomicWriteJsonFile(idxPath, updated);
          }
        } catch {
          // ignore
        }
      }
    }

    return { deleted, freedBytes };
  }

  private async estimateDirSize(dirPath: string): Promise<number> {
    let total = 0;
    try {
      const entries = await readDir(dirPath);
      for (const entry of entries) {
        const full = path.join(dirPath, entry);
        try {
          const stat = await import("node:fs/promises").then((m) => m.stat(full));
          if (stat.isDirectory()) {
            total += await this.estimateDirSize(full);
          } else {
            total += stat.size;
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
    return total;
  }

  // ── Performance: Lazy-load task outputs ───────────────

  async getTaskOutputSize(runId: string, taskId: string): Promise<number> {
    const logPath = path.join(getLogsDir(this.rootPath, runId), `${taskId}.log`);
    try {
      const stat = await import("node:fs/promises").then((m) => m.stat(logPath));
      return stat.size;
    } catch {
      return 0;
    }
  }

  async readTaskLogLines(
    runId: string,
    taskId: string,
    offset = 0,
    limit = 100,
  ): Promise<string[]> {
    const logPath = path.join(getLogsDir(this.rootPath, runId), `${taskId}.log`);
    try {
      const content = await readTextFile(logPath);
      const lines = content.split("\n");
      return lines.slice(offset, offset + limit);
    } catch {
      return [];
    }
  }

  // ── Process Spawn Metrics / Logging ────────────────────

  async logProcessSpawnMetrics(
    runId: string,
    metrics: {
      totalSpawns: number;
      totalReuses: number;
      poolSize: number;
      activePoolSize: number;
      activeViteProcesses: number;
      viteSpawnCount: number;
    },
  ): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run) return;
    run.metadata = {
      ...(run.metadata ?? {}),
      processSpawnMetrics: metrics,
      processSpawnMetricsUpdatedAt: now(),
    };
    await this.saveRun(run);
  }

  // ── Performance: Storage management ───────────────────

  async getRunStorageStats(runId: string): Promise<{
    totalBytes: number;
    logBytes: number;
    snapshotBytes: number;
    artifactBytes: number;
  }> {
    const runDir = getRunDir(this.rootPath, runId);
    const logDir = getLogsDir(this.rootPath, runId);
    const snapDir = getSnapshotsDir(this.rootPath, runId);
    const artDir = getArtifactsDir(this.rootPath, runId);

    const totalBytes = await this.estimateDirSize(runDir);
    const logBytes = await this.estimateDirSize(logDir);
    const snapshotBytes = await this.estimateDirSize(snapDir);
    const artifactBytes = await this.estimateDirSize(artDir);

    return { totalBytes, logBytes, snapshotBytes, artifactBytes };
  }
}
