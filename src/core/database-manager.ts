import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Run } from "../schemas/run.schema.js";
import type { Task } from "../schemas/task.schema.js";
import type { Step } from "../schemas/step.schema.js";
import type { ArtifactRecord } from "../schemas/artifact.schema.js";
import type { CheckpointRecord } from "../schemas/checkpoint.schema.js";
import type { TaskResultRecord } from "../schemas/task-result.schema.js";
import type { FlowTaskEvent } from "../schemas/event.schema.js";
import { ensureDir } from "../utils/fs.js";
import { now } from "../utils/time.js";

const SCHEMA_VERSION = 2;

const SCHEMA_VERSION_TABLE = `CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);`;

const MIGRATIONS: string[] = [
  "",
  `CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'auto',
    planner_mode TEXT NOT NULL DEFAULT 'auto',
    task_count INTEGER NOT NULL DEFAULT 0,
    completed_task_count INTEGER NOT NULL DEFAULT 0,
    failed_task_count INTEGER NOT NULL DEFAULT 0,
    total_duration_ms INTEGER,
    prompt_path TEXT,
    plan_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_runs_project_id ON runs(project_id);
  CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
  CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
  CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    executor TEXT NOT NULL DEFAULT 'shell',
    depends_on TEXT NOT NULL DEFAULT '[]',
    acceptance_criteria TEXT NOT NULL DEFAULT '[]',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_run_id ON tasks(run_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE TABLE IF NOT EXISTS steps (
    step_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'command',
    command TEXT,
    depends_on TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    requires_approval INTEGER NOT NULL DEFAULT 0,
    exit_code INTEGER,
    output_summary TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_steps_task_id ON steps(task_id);
  CREATE INDEX IF NOT EXISTS idx_steps_run_id ON steps(run_id);
  CREATE INDEX IF NOT EXISTS idx_steps_status ON steps(status);
  CREATE TABLE IF NOT EXISTS task_results (
    result_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    exit_code INTEGER,
    output_path TEXT,
    summary TEXT,
    error_message TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_task_results_task_id ON task_results(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_results_run_id ON task_results(run_id);
  CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(task_id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT,
    hash_sha256 TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_task_id ON artifacts(task_id);
  CREATE TABLE IF NOT EXISTS checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    task_id TEXT,
    step_id TEXT,
    state_type TEXT NOT NULL,
    state_data TEXT NOT NULL DEFAULT '{}',
    is_snapshot INTEGER NOT NULL DEFAULT 0,
    snapshot_path TEXT,
    snapshot_size INTEGER,
    snapshot_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_checkpoints_run_id ON checkpoints(run_id);
  CREATE INDEX IF NOT EXISTS idx_checkpoints_created_at ON checkpoints(created_at);
  CREATE TABLE IF NOT EXISTS events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    type TEXT NOT NULL,
    run_id TEXT REFERENCES runs(run_id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(task_id) ON DELETE SET NULL,
    step_id TEXT REFERENCES steps(step_id) ON DELETE SET NULL,
    message TEXT,
    details TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_time ON events(time);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);`,
  `ALTER TABLE steps ADD COLUMN expected_result TEXT;`,
];

export interface DbStatus {
  version: number;
  tableCount: number;
  runCount: number;
  taskCount: number;
  stepCount: number;
  checkpointCount: number;
  artifactCount: number;
  eventCount: number;
  dbSizeBytes: number;
}

export class DatabaseManager {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  static async create(dbPath: string): Promise<DatabaseManager> {
    await ensureDir(path.dirname(dbPath));
    const manager = new DatabaseManager(dbPath);
    manager.migrate();
    return manager;
  }

  migrate(): void {
    this.db.exec(SCHEMA_VERSION_TABLE);

    const currentVersion = this.getVersion();

    for (let i = currentVersion + 1; i <= SCHEMA_VERSION; i++) {
      const migration = MIGRATIONS[i];
      if (!migration || migration.trim().length === 0) continue;

      this.db.exec(migration);

      this.db
        .prepare("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
        .run(i, now());
    }
  }

  status(): DbStatus {
    const version = this.getVersion();
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    const countTable = (table: string): number => {
      const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
      return row.cnt;
    };

    const stats = {
      version,
      tableCount: tables.length,
      runCount: this.tableExists("runs") ? countTable("runs") : 0,
      taskCount: this.tableExists("tasks") ? countTable("tasks") : 0,
      stepCount: this.tableExists("steps") ? countTable("steps") : 0,
      checkpointCount: this.tableExists("checkpoints") ? countTable("checkpoints") : 0,
      artifactCount: this.tableExists("artifacts") ? countTable("artifacts") : 0,
      eventCount: this.tableExists("events") ? countTable("events") : 0,
      dbSizeBytes: 0,
    };

    try {
      const stat = fs.statSync(this.dbPath);
      stats.dbSizeBytes = stat.size;
    } catch {
      // ignore
    }

    return stats;
  }

  // ── Runs ──────────────────────────────────────────

  insertRun(run: Run, failedTaskCount = 0): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runs
         (run_id, project_id, title, status, mode, planner_mode,
          task_count, completed_task_count, failed_task_count,
          total_duration_ms, prompt_path, plan_path,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.projectId,
        run.title,
        run.status,
        run.mode ?? "auto",
        "auto",
        run.taskCount,
        run.completedTaskCount,
        failedTaskCount,
        null,
        run.promptPath ?? null,
        run.planPath ?? null,
        run.createdAt,
        run.updatedAt,
      );
  }

  updateRun(runId: string, updates: Partial<Run> & { failedTaskCount?: number }): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const col = snakeCase(key);
      fields.push(`${col} = ?`);
      values.push(value ?? null);
    }

    if (fields.length === 0) return;
    fields.push("updated_at = ?");
    values.push(now());
    values.push(runId);

    this.db.prepare(`UPDATE runs SET ${fields.join(", ")} WHERE run_id = ?`).run(...values);
  }

  getRun(runId: string): Run | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return rowToRun(row);
  }

  listRuns(projectId: string, limit = 50, offset = 0): Run[] {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(projectId, limit, offset) as Record<string, unknown>[];
    return rows.map(rowToRun);
  }

  deleteRun(runId: string): void {
    this.db.prepare("DELETE FROM runs WHERE run_id = ?").run(runId);
  }

  // ── Tasks ─────────────────────────────────────────

  insertTask(task: Task): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO tasks
         (task_id, run_id, title, description, status, executor,
          depends_on, acceptance_criteria, retry_count, max_retries,
          attempt_count, started_at, completed_at,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.runId,
        task.title,
        task.description ?? "",
        task.status,
        task.executor,
        JSON.stringify(task.dependsOn),
        JSON.stringify(task.acceptanceCriteria),
        task.retryCount,
        task.maxRetries,
        0,
        null,
        null,
        task.createdAt,
        task.updatedAt,
      );
  }

  updateTask(taskId: string, updates: Partial<Task>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const col = snakeCase(key);
      if (col === "depends_on") {
        fields.push(`${col} = ?`);
        values.push(JSON.stringify(value));
      } else if (col === "acceptance_criteria") {
        fields.push(`${col} = ?`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${col} = ?`);
        values.push(value ?? null);
      }
    }

    if (fields.length === 0) return;
    fields.push("updated_at = ?");
    values.push(now());
    values.push(taskId);

    this.db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE task_id = ?`).run(...values);
  }

  getTasksByRun(runId: string): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at")
      .all(runId) as Record<string, unknown>[];
    return rows.map(rowToTask);
  }

  getTask(taskId: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return rowToTask(row);
  }

  // ── Steps ─────────────────────────────────────────

  insertStep(step: Step): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO steps
         (step_id, task_id, run_id, title, description, type, command,
          depends_on, status, requires_approval, exit_code,
          output_summary, expected_result, "order", started_at, finished_at,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        step.id,
        step.taskId,
        step.runId,
        step.title,
        step.description ?? "",
        step.type,
        step.command ?? null,
        JSON.stringify([]),
        step.status,
        step.requiresApproval ? 1 : 0,
        step.exitCode ?? null,
        null,
        step.expectedResult ?? null,
        step.order,
        step.startedAt ?? null,
        step.finishedAt ?? null,
        step.createdAt,
        step.updatedAt,
      );
  }

  updateStep(stepId: string, updates: Partial<Step>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const col = snakeCase(key);
      if (col === "requires_approval") {
        fields.push(`${col} = ?`);
        values.push(value ? 1 : 0);
      } else {
        fields.push(`${col} = ?`);
        values.push(value ?? null);
      }
    }

    if (fields.length === 0) return;
    fields.push("updated_at = ?");
    values.push(now());
    values.push(stepId);

    this.db.prepare(`UPDATE steps SET ${fields.join(", ")} WHERE step_id = ?`).run(...values);
  }

  getStepsByTask(taskId: string): Step[] {
    const rows = this.db
      .prepare('SELECT * FROM steps WHERE task_id = ? ORDER BY "order"')
      .all(taskId) as Record<string, unknown>[];
    return rows.map(rowToStep);
  }

  getStepsByRun(runId: string): Step[] {
    const rows = this.db
      .prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY "order"')
      .all(runId) as Record<string, unknown>[];
    return rows.map(rowToStep);
  }

  // ── Artifacts ─────────────────────────────────────

  insertArtifact(artifact: ArtifactRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO artifacts
         (artifact_id, run_id, task_id, title, type, file_path,
          file_size, mime_type, hash_sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.artifactId,
        artifact.runId,
        artifact.taskId ?? null,
        artifact.title,
        artifact.type,
        artifact.filePath,
        artifact.fileSize,
        artifact.mimeType ?? null,
        artifact.hashSha256 ?? null,
        artifact.createdAt,
      );
  }

  getArtifactsByRun(runId: string): ArtifactRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at")
      .all(runId) as Record<string, unknown>[];
    return rows.map(rowToArtifact);
  }

  getArtifactsByTask(taskId: string): ArtifactRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at")
      .all(taskId) as Record<string, unknown>[];
    return rows.map(rowToArtifact);
  }

  // ── Checkpoints ───────────────────────────────────

  insertCheckpoint(checkpoint: CheckpointRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints
         (checkpoint_id, run_id, task_id, step_id, state_type,
          state_data, is_snapshot, snapshot_path, snapshot_size,
          snapshot_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        checkpoint.checkpointId,
        checkpoint.runId,
        checkpoint.taskId ?? null,
        checkpoint.stepId ?? null,
        checkpoint.stateType,
        checkpoint.stateData,
        checkpoint.isSnapshot ? 1 : 0,
        checkpoint.snapshotPath ?? null,
        checkpoint.snapshotSize ?? null,
        checkpoint.snapshotHash ?? null,
        checkpoint.createdAt,
      );
  }

  getLatestCheckpoint(runId: string): CheckpointRecord | null {
    const row = this.db
      .prepare("SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(runId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToCheckpoint(row);
  }

  getCheckpointsByRun(runId: string): CheckpointRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC")
      .all(runId) as Record<string, unknown>[];
    return rows.map(rowToCheckpoint);
  }

  cleanCheckpoints(runId: string, keepFirst = true, keepLast = true): void {
    const rows = this.getCheckpointsByRun(runId);
    if (rows.length <= 2) return;

    const forDeletion: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const isFirst = keepFirst && i === rows.length - 1;
      const isLast = keepLast && i === 0;
      if (!isFirst && !isLast) {
        const row = rows[i];
        if (row) {
          forDeletion.push(row.checkpointId);
        }
      }
    }

    if (forDeletion.length === 0) return;

    const stmt = this.db.prepare("DELETE FROM checkpoints WHERE checkpoint_id = ?");
    const deleteMany = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        stmt.run(id);
      }
    });
    deleteMany(forDeletion);
  }

  // ── Task Results ──────────────────────────────────

  insertTaskResult(result: TaskResultRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO task_results
         (result_id, task_id, run_id, attempt, status, exit_code,
          output_path, summary, error_message, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.resultId,
        result.taskId,
        result.runId,
        result.attempt,
        result.status,
        result.exitCode ?? null,
        result.outputPath ?? null,
        result.summary ?? null,
        result.errorMessage ?? null,
        result.durationMs ?? null,
        result.createdAt,
      );
  }

  getResultsByTask(taskId: string): TaskResultRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM task_results WHERE task_id = ? ORDER BY attempt DESC")
      .all(taskId) as Record<string, unknown>[];
    return rows.map(rowToTaskResult);
  }

  getResultsByRun(runId: string): TaskResultRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM task_results WHERE run_id = ? ORDER BY created_at DESC")
      .all(runId) as Record<string, unknown>[];
    return rows.map(rowToTaskResult);
  }

  // ── Events ────────────────────────────────────────

  insertEvent(event: FlowTaskEvent & { stepId?: string }): void {
    this.db
      .prepare(
        `INSERT INTO events (time, type, run_id, task_id, step_id, message, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.time,
        event.type,
        event.runId ?? null,
        event.taskId ?? null,
        event.stepId ?? null,
        event.message ?? null,
        event.details ? JSON.stringify(event.details) : null,
      );
  }

  queryEvents(runId?: string, type?: string, limit = 100): FlowTaskEvent[] {
    let sql = "SELECT * FROM events WHERE 1=1";
    const params: unknown[] = [];

    if (runId) {
      sql += " AND run_id = ?";
      params.push(runId);
    }
    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }

    sql += " ORDER BY time DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  // ── Maintenance ───────────────────────────────────

  vacuum(): void {
    this.db.exec("VACUUM");
  }

  async backup(destPath: string): Promise<boolean> {
    try {
      const dir = path.dirname(destPath);
      fs.mkdirSync(dir, { recursive: true });
      await this.db.backup(destPath);
      return true;
    } catch {
      return false;
    }
  }

  integrityCheck(): { valid: boolean; error?: string } {
    try {
      const row = this.db.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      };
      if (row.integrity_check !== "ok") {
        return { valid: false, error: row.integrity_check };
      }
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  close(): void {
    this.db.close();
  }

  // ── Private ───────────────────────────────────────

  private getVersion(): number {
    try {
      const row = this.db
        .prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
        .get() as { version: number } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  private tableExists(name: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(name);
    return !!row;
  }
}

// ── Row mapping helpers ─────────────────────────────

function snakeCase(key: string): string {
  return key.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function rowToRun(row: Record<string, unknown>): Run {
  return {
    runId: row.run_id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    status: row.status as Run["status"],
    mode: (row.mode as Run["mode"]) ?? "auto",
    taskCount: (row.task_count as number) ?? 0,
    completedTaskCount: (row.completed_task_count as number) ?? 0,
    promptPath: (row.prompt_path as string) ?? undefined,
    planPath: (row.plan_path as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToTask(row: Record<string, unknown>): Task {
  let dependsOn: string[] = [];
  try {
    dependsOn = JSON.parse(row.depends_on as string);
  } catch {
    dependsOn = [];
  }
  let acceptanceCriteria: string[] = [];
  try {
    acceptanceCriteria = JSON.parse(row.acceptance_criteria as string);
  } catch {
    acceptanceCriteria = [];
  }

  return {
    id: row.task_id as string,
    runId: row.run_id as string,
    title: row.title as string,
    description: (row.description as string) || undefined,
    status: row.status as Task["status"],
    executor: (row.executor as string) ?? "shell",
    dependsOn,
    acceptanceCriteria,
    retryCount: (row.retry_count as number) ?? 0,
    maxRetries: (row.max_retries as number) ?? 2,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToStep(row: Record<string, unknown>): Step {
  return {
    id: row.step_id as string,
    taskId: row.task_id as string,
    runId: row.run_id as string,
    title: row.title as string,
    description: (row.description as string) || undefined,
    type: (row.type as Step["type"]) ?? "command",
    command: (row.command as string) ?? undefined,
    status: (row.status as Step["status"]) ?? "pending",
    expectedResult: (row.expected_result as string) ?? undefined,
    requiresApproval: (row.requires_approval as number) === 1,
    exitCode: (row.exit_code as number) ?? undefined,
    order: (row.order as number) ?? 0,
    startedAt: (row.started_at as string) ?? undefined,
    finishedAt: (row.finished_at as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToArtifact(row: Record<string, unknown>): ArtifactRecord {
  return {
    artifactId: row.artifact_id as string,
    runId: row.run_id as string,
    taskId: (row.task_id as string) ?? undefined,
    title: row.title as string,
    type: row.type as string,
    filePath: row.file_path as string,
    fileSize: (row.file_size as number) ?? 0,
    mimeType: (row.mime_type as string) ?? undefined,
    hashSha256: (row.hash_sha256 as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

function rowToCheckpoint(row: Record<string, unknown>): CheckpointRecord {
  return {
    checkpointId: row.checkpoint_id as string,
    runId: row.run_id as string,
    taskId: (row.task_id as string) ?? undefined,
    stepId: (row.step_id as string) ?? undefined,
    stateType: row.state_type as CheckpointRecord["stateType"],
    stateData: row.state_data as string,
    isSnapshot: (row.is_snapshot as number) === 1,
    snapshotPath: (row.snapshot_path as string) ?? undefined,
    snapshotSize: (row.snapshot_size as number) ?? undefined,
    snapshotHash: (row.snapshot_hash as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

function rowToTaskResult(row: Record<string, unknown>): TaskResultRecord {
  return {
    resultId: row.result_id as string,
    taskId: row.task_id as string,
    runId: row.run_id as string,
    attempt: (row.attempt as number) ?? 0,
    status: row.status as TaskResultRecord["status"],
    exitCode: (row.exit_code as number) ?? undefined,
    outputPath: (row.output_path as string) ?? undefined,
    summary: (row.summary as string) ?? undefined,
    errorMessage: (row.error_message as string) ?? undefined,
    durationMs: (row.duration_ms as number) ?? undefined,
    createdAt: row.created_at as string,
  };
}

function rowToEvent(row: Record<string, unknown>): FlowTaskEvent {
  return {
    time: row.time as string,
    type: row.type as FlowTaskEvent["type"],
    runId: (row.run_id as string) ?? undefined,
    taskId: (row.task_id as string) ?? undefined,
    message: (row.message as string) ?? undefined,
    details: row.details
      ? (JSON.parse(row.details as string) as Record<string, unknown>)
      : undefined,
  };
}
