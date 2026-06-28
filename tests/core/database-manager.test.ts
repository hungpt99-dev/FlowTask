import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { DatabaseManager } from "../../src/core/database-manager.js";
import type { Run } from "../../src/schemas/run.schema.js";
import type { Task } from "../../src/schemas/task.schema.js";
import type { Step } from "../../src/schemas/step.schema.js";
import type { ArtifactRecord } from "../../src/schemas/artifact.schema.js";
import type { CheckpointRecord } from "../../src/schemas/checkpoint.schema.js";
import type { TaskResultRecord } from "../../src/schemas/task-result.schema.js";

function makeTestDir(): string {
  const dir = path.join(os.tmpdir(), `flowtask-db-test-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTimestamp(): string {
  return new Date().toISOString();
}

describe("DatabaseManager", () => {
  let testDir: string;
  let db: DatabaseManager;

  beforeEach(async () => {
    testDir = makeTestDir();
    db = await DatabaseManager.create(path.join(testDir, "flowtask.db"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("initialization", () => {
    it("creates database and runs migrations", () => {
      const status = db.status();
      expect(status.version).toBeGreaterThanOrEqual(1);
      expect(status.tableCount).toBeGreaterThanOrEqual(7);
    });

    it("integrity check passes", () => {
      const result = db.integrityCheck();
      expect(result.valid).toBe(true);
    });
  });

  describe("run operations", () => {
    it("inserts and retrieves a run", () => {
      const now = makeTimestamp();
      const run: Run = {
        runId: "run_test_001",
        projectId: "test-project",
        title: "Test Run",
        status: "created",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      db.insertRun(run);
      const retrieved = db.getRun("run_test_001");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.runId).toBe("run_test_001");
      expect(retrieved!.title).toBe("Test Run");
      expect(retrieved!.status).toBe("created");
    });

    it("updates a run", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_test_002",
        projectId: "test-project",
        title: "Test Run",
        status: "created",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      db.updateRun("run_test_002", { status: "running" });
      const retrieved = db.getRun("run_test_002");
      expect(retrieved!.status).toBe("running");
    });

    it("lists runs ordered by creation date", () => {
      db.insertRun({
        runId: "run_002",
        projectId: "test-project",
        title: "Second Run",
        status: "completed",
        mode: "auto",
        taskCount: 2,
        completedTaskCount: 2,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
      db.insertRun({
        runId: "run_001",
        projectId: "test-project",
        title: "First Run",
        status: "failed",
        mode: "auto",
        taskCount: 1,
        completedTaskCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const runs = db.listRuns("test-project");
      expect(runs).toHaveLength(2);
      expect(runs[0]!.runId).toBe("run_002");
      expect(runs[1]!.runId).toBe("run_001");
    });

    it("deletes a run", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_delete",
        projectId: "test-project",
        title: "Delete Me",
        status: "created",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      db.deleteRun("run_delete");
      expect(db.getRun("run_delete")).toBeNull();
    });
  });

  describe("task operations", () => {
    it("inserts and retrieves tasks for a run", () => {
      const now = makeTimestamp();
      const run: Run = {
        runId: "run_tasks",
        projectId: "test-project",
        title: "Task Test",
        status: "running",
        mode: "auto",
        taskCount: 2,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      db.insertRun(run);

      const task1: Task = {
        id: "task_001",
        runId: "run_tasks",
        title: "First Task",
        status: "done",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      };
      const task2: Task = {
        id: "task_002",
        runId: "run_tasks",
        title: "Second Task",
        status: "pending",
        executor: "opencode",
        dependsOn: ["task_001"],
        acceptanceCriteria: ["Must complete"],
        retryCount: 0,
        maxRetries: 3,
        createdAt: now,
        updatedAt: now,
      };

      db.insertTask(task1);
      db.insertTask(task2);

      const tasks = db.getTasksByRun("run_tasks");
      expect(tasks).toHaveLength(2);
      expect(tasks[0]!.title).toBe("First Task");
      expect(tasks[1]!.dependsOn).toEqual(["task_001"]);
      expect(tasks[1]!.acceptanceCriteria).toEqual(["Must complete"]);
    });

    it("returns empty array for nonexistent run", () => {
      const tasks = db.getTasksByRun("nonexistent");
      expect(tasks).toEqual([]);
    });
  });

  describe("step operations", () => {
    it("inserts and retrieves steps", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_steps",
        projectId: "test-project",
        title: "Step Test",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      db.insertTask({
        id: "task_steps",
        runId: "run_steps",
        title: "Task for steps",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      const step1: Step = {
        id: "step_001",
        taskId: "task_steps",
        runId: "run_steps",
        title: "Analyze code",
        type: "read",
        status: "done",
        requiresApproval: false,
        order: 0,
        createdAt: now,
        updatedAt: now,
      };
      const step2: Step = {
        id: "step_002",
        taskId: "task_steps",
        runId: "run_steps",
        title: "Install dependency",
        type: "shell",
        command: "pnpm add dep",
        status: "pending_approval",
        requiresApproval: true,
        approvalReason: "Adding new dependency",
        order: 1,
        createdAt: now,
        updatedAt: now,
      };

      db.insertStep(step1);
      db.insertStep(step2);

      const steps = db.getStepsByTask("task_steps");
      expect(steps).toHaveLength(2);
      expect(steps[0]!.title).toBe("Analyze code");
      expect(steps[1]!.requiresApproval).toBe(true);
    });
  });

  describe("artifact operations", () => {
    it("inserts and retrieves artifacts", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_artifact",
        projectId: "test-project",
        title: "Artifact Test",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      db.insertTask({
        id: "task_artifact",
        runId: "run_artifact",
        title: "Artifact Task",
        status: "done",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      const artifact: ArtifactRecord = {
        artifactId: "artifact_001",
        runId: "run_artifact",
        taskId: "task_artifact",
        title: "design.md",
        type: "markdown",
        filePath: "artifacts/task_artifact/design.md",
        fileSize: 1024,
        mimeType: "text/markdown",
        hashSha256: "abc123",
        createdAt: now,
      };

      db.insertArtifact(artifact);
      const artifacts = db.getArtifactsByRun("run_artifact");
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]!.title).toBe("design.md");
      expect(artifacts[0]!.fileSize).toBe(1024);
    });
  });

  describe("checkpoint operations", () => {
    it("inserts and retrieves checkpoints", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_check",
        projectId: "test-project",
        title: "Checkpoint Test",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      const cp1: CheckpointRecord = {
        checkpointId: "chk_001",
        runId: "run_check",
        taskId: "task_001",
        stateType: "task_state",
        stateData: JSON.stringify({ status: "running" }),
        isSnapshot: false,
        createdAt: now,
      };
      const cp2: CheckpointRecord = {
        checkpointId: "chk_002",
        runId: "run_check",
        stateType: "run_state",
        stateData: JSON.stringify({ status: "completed" }),
        isSnapshot: false,
        createdAt: new Date(Date.now() + 1000).toISOString(),
      };

      db.insertCheckpoint(cp1);
      db.insertCheckpoint(cp2);

      const latest = db.getLatestCheckpoint("run_check");
      expect(latest).not.toBeNull();
      expect(latest!.checkpointId).toBe("chk_002");
    });
  });

  describe("task result operations", () => {
    it("inserts and retrieves task results", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_result",
        projectId: "test-project",
        title: "Result Test",
        status: "completed",
        mode: "auto",
        taskCount: 1,
        completedTaskCount: 1,
        createdAt: now,
        updatedAt: now,
      });

      db.insertTask({
        id: "task_result",
        runId: "run_result",
        title: "Result Task",
        status: "done",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      const result: TaskResultRecord = {
        resultId: "result_001",
        taskId: "task_result",
        runId: "run_result",
        attempt: 0,
        status: "passed",
        exitCode: 0,
        summary: "All checks passed",
        durationMs: 1500,
        createdAt: now,
      };

      db.insertTaskResult(result);
      const results = db.getResultsByTask("task_result");
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("passed");
      expect(results[0]!.durationMs).toBe(1500);
    });
  });

  describe("event operations", () => {
    it("inserts and queries events", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_event",
        projectId: "test-project",
        title: "Event Test",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      db.insertTask({
        id: "task_evt",
        runId: "run_event",
        title: "Event Task",
        status: "done",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      const later = new Date(Date.now() + 100).toISOString();
      db.insertEvent({
        time: now,
        type: "run_started",
        runId: "run_event",
        message: "Run started",
      });
      db.insertEvent({
        time: later,
        type: "task_started",
        runId: "run_event",
        taskId: "task_evt",
        message: "Task started",
      });

      const events = db.queryEvents("run_event");
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe("task_started");
    });

    it("filters events by type", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_filter",
        projectId: "test-project",
        title: "Filter Test",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      db.insertEvent({ time: now, type: "run_started", runId: "run_filter" });
      db.insertEvent({ time: now, type: "task_started", runId: "run_filter" });
      db.insertEvent({ time: now, type: "run_completed", runId: "run_filter" });

      const filtered = db.queryEvents("run_filter", "task_started");
      expect(filtered).toHaveLength(1);
    });
  });

  describe("maintenance", () => {
    it("backup creates a valid copy", async () => {
      const backupPath = path.join(testDir, "backup.db");
      const result = await db.backup(backupPath);
      expect(result).toBe(true);
      expect(fs.existsSync(backupPath)).toBe(true);
    });

    it("vacuum does not throw", () => {
      expect(() => db.vacuum()).not.toThrow();
    });
  });
});
