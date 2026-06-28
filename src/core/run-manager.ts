import path from "node:path";
import { type Run, type RunIndex, RunSchema, RunIndexSchema } from "../schemas/run.schema.js";
import { type Task, type TaskIndex, TaskSchema, TaskIndexSchema } from "../schemas/task.schema.js";
import {
  fileExists,
  readJsonFile,
  readTextFile,
  atomicWriteJsonFile,
  ensureDir,
  writeTextFile,
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
} from "../utils/paths.js";
import { now } from "../utils/time.js";
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

  async createRun(projectId: string, title: string, mode: Run["mode"] = "auto"): Promise<Run> {
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
      taskCount: 0,
      completedTaskCount: 0,
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
  }

  async saveTasks(runId: string, tasks: Task[]): Promise<void> {
    await atomicWriteJsonFile(tasksJsonPath(this.rootPath, runId), {
      runId,
      tasks,
    });
    await this.updateTaskIndex(tasks);

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
  }

  async listRuns(projectId?: string): Promise<RunIndex["runs"]> {
    if (this.db && projectId) {
      try {
        const runs = this.db.listRuns(projectId);
        return runs.map((r) => ({
          runId: r.runId,
          title: r.title,
          status: r.status,
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
    const entry = {
      runId: run.runId,
      title: run.title,
      status: run.status,
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
          return depTask?.status === "done";
        }),
    );
    return pending[0] ?? null;
  }

  async updateRunStatus(runId: string, status: Run["status"]): Promise<Run> {
    const run = await this.loadRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const updated = { ...run, status, updatedAt: now() };
    await this.saveRun(updated);
    await this.updateRunIndex(run.projectId, updated);
    return updated;
  }

  async updateTaskStatus(runId: string, taskId: string, status: Task["status"]): Promise<Task> {
    const tasks = await this.loadTasks(runId);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) throw new Error(`Task not found: ${taskId}`);
    const existing = tasks[idx]!;
    const updated = { ...existing, status, updatedAt: now() };
    tasks[idx] = updated;
    await this.saveTasks(runId, tasks);
    return updated;
  }

  async updateTask(
    runId: string,
    taskId: string,
    updates: Partial<
      Pick<Task, "title" | "description" | "executor" | "acceptanceCriteria" | "validation">
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
}
