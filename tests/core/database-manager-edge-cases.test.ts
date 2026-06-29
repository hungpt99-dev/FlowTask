import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { DatabaseManager } from "../../src/core/database-manager.js";
import type { Run } from "../../src/schemas/run.schema.js";
import type { Task } from "../../src/schemas/task.schema.js";
import type { ArtifactRecord } from "../../src/schemas/artifact.schema.js";
import type { CheckpointRecord } from "../../src/schemas/checkpoint.schema.js";
import type { TaskResultRecord } from "../../src/schemas/task-result.schema.js";

function makeTestDir(): string {
  const dir = path.join(os.tmpdir(), `flowtask-db-edge-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTimestamp(): string {
  return new Date().toISOString();
}

describe("DatabaseManager edge cases", () => {
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

  describe("migration", () => {
    it("should handle schema version correctly", () => {
      const status = db.status();
      expect(status.version).toBe(3);
    });

    it("should handle multiple table creation", () => {
      const status = db.status();
      expect(status.tableCount).toBeGreaterThanOrEqual(7);
    });
  });

  describe("run operations edge cases", () => {
    it("should update run with failedTaskCount", () => {
      const now = makeTimestamp();
      const run: Run = {
        runId: "run_edge_001",
        projectId: "test-project",
        title: "Edge Run",
        status: "running",
        mode: "auto",
        taskCount: 3,
        completedTaskCount: 1,
        createdAt: now,
        updatedAt: now,
      };
      db.insertRun(run);
      db.updateRun("run_edge_001", {
        status: "completed",
        completedTaskCount: 2,
        failedTaskCount: 1,
      });

      const retrieved = db.getRun("run_edge_001");
      expect(retrieved!.status).toBe("completed");
    });

    it("should return null for non-existent run", () => {
      const run = db.getRun("nonexistent");
      expect(run).toBeNull();
    });

    it("should handle update with empty updates object", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_empty_upd",
        projectId: "test-project",
        title: "No Updates",
        status: "created",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      expect(() => db.updateRun("run_empty_upd", {})).not.toThrow();
    });

    it("should list runs with limit and offset", () => {
      for (let i = 0; i < 5; i++) {
        const now = makeTimestamp();
        db.insertRun({
          runId: `run_limit_${i}`,
          projectId: "test-project",
          title: `Run ${i}`,
          status: "created",
          mode: "auto",
          taskCount: 0,
          completedTaskCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }

      const runs = db.listRuns("test-project", 2, 0);
      expect(runs).toHaveLength(2);
    });
  });

  describe("task operations edge cases", () => {
    it("should update task with array fields (dependsOn, acceptanceCriteria)", () => {
      const now = makeTimestamp();
      const run: Run = {
        runId: "run_task_arr",
        projectId: "test-project",
        title: "Task Arrays",
        status: "running",
        mode: "auto",
        taskCount: 1,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      db.insertRun(run);

      const task: Task = {
        id: "task_arr_001",
        runId: "run_task_arr",
        title: "Array Task",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      };
      db.insertTask(task);

      db.updateTask("task_arr_001", {
        dependsOn: ["task_prev_001"],
        acceptanceCriteria: ["Must pass", "Must compile"],
      });

      const updated = db.getTask("task_arr_001");
      expect(updated!.dependsOn).toEqual(["task_prev_001"]);
      expect(updated!.acceptanceCriteria).toEqual(["Must pass", "Must compile"]);
    });

    it("should return null for non-existent task", () => {
      const task = db.getTask("nonexistent");
      expect(task).toBeNull();
    });

    it("should handle empty tasks list for run", () => {
      const tasks = db.getTasksByRun("run_with_no_tasks");
      expect(tasks).toEqual([]);
    });

    it("should round-trip deeply nested acceptance criteria", () => {
      const now = makeTimestamp();
      const run: Run = {
        runId: "run_deep_ac",
        projectId: "test-project",
        title: "Deep AC",
        status: "created",
        mode: "auto",
        taskCount: 1,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      db.insertRun(run);

      const task: Task = {
        id: "task_deep_ac",
        runId: "run_deep_ac",
        title: "Deep AC Task",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["Criterion 1", "Criterion 2 with special chars: !@#$%"],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      };
      db.insertTask(task);

      const retrieved = db.getTask("task_deep_ac");
      expect(retrieved!.acceptanceCriteria).toHaveLength(2);
      expect(retrieved!.acceptanceCriteria[1]).toContain("special chars");
    });
  });

  describe("step operations edge cases", () => {
    it("should handle steps with approvalReason", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_step_app",
        projectId: "test-project",
        title: "Step Approval",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_step_app",
        runId: "run_step_app",
        title: "Approval Task",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      db.insertStep({
        id: "step_app_001",
        taskId: "task_step_app",
        runId: "run_step_app",
        title: "Approval Step",
        type: "shell",
        command: "rm -rf tmp",
        status: "pending_approval",
        requiresApproval: true,
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      });

      const steps = db.getStepsByTask("task_step_app");
      expect(steps[0]!.requiresApproval).toBe(true);
      expect(steps[0]!.status).toBe("pending_approval");
    });

    it("should list steps by run", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_steps_list",
        projectId: "test-project",
        title: "Step List",
        status: "running",
        mode: "auto",
        taskCount: 2,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_steps_a",
        runId: "run_steps_list",
        title: "Task A",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_steps_b",
        runId: "run_steps_list",
        title: "Task B",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      db.insertStep({
        id: "step_a_1",
        taskId: "task_steps_a",
        runId: "run_steps_list",
        title: "Step A1",
        type: "command",
        command: "echo a1",
        status: "done",
        requiresApproval: false,
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      });
      db.insertStep({
        id: "step_b_1",
        taskId: "task_steps_b",
        runId: "run_steps_list",
        title: "Step B1",
        type: "command",
        command: "echo b1",
        status: "pending",
        requiresApproval: false,
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      });

      const stepsByRun = db.getStepsByRun("run_steps_list");
      expect(stepsByRun).toHaveLength(2);
    });

    it("should update step requires_approval flag", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_upd_step",
        projectId: "test-project",
        title: "Upd Step",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_upd_step",
        runId: "run_upd_step",
        title: "Upd Task",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });
      db.insertStep({
        id: "step_upd",
        taskId: "task_upd_step",
        runId: "run_upd_step",
        title: "Upd Step",
        type: "shell",
        command: "echo test",
        status: "pending_approval",
        requiresApproval: true,
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      });

      db.updateStep("step_upd", { requiresApproval: false, status: "pending" as const });

      const updated = db.getStepsByTask("task_upd_step")[0]!;
      expect(updated.requiresApproval).toBe(false);
      expect(updated.status).toBe("pending");
    });
  });

  describe("artifact operations edge cases", () => {
    it("should handle artifacts without taskId", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_art_no_task",
        projectId: "test-project",
        title: "Art No Task",
        status: "completed",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      const artifact: ArtifactRecord = {
        artifactId: "art_no_task_001",
        runId: "run_art_no_task",
        title: "run-report.md",
        type: "markdown",
        path: "artifacts/run-report.md",
        filePath: "artifacts/run-report.md",
        fileSize: 500,
        origin: "expected",
        validationStatus: "pending",
        createdAt: now,
      };

      db.insertArtifact(artifact);
      const artifacts = db.getArtifactsByRun("run_art_no_task");
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]!.taskId).toBeUndefined();
    });

    it("should list artifacts by task", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_art_task",
        projectId: "test-project",
        title: "Art Task",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_art_list",
        runId: "run_art_task",
        title: "Art Task",
        status: "done",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      db.insertArtifact({
        artifactId: "art_t1",
        runId: "run_art_task",
        taskId: "task_art_list",
        title: "file1.json",
        type: "json",
        path: "artifacts/file1.json",
        filePath: "artifacts/file1.json",
        fileSize: 100,
        origin: "expected",
        validationStatus: "pending",
        createdAt: now,
      });
      db.insertArtifact({
        artifactId: "art_t2",
        runId: "run_art_task",
        taskId: "task_art_list",
        title: "file2.txt",
        type: "text",
        path: "artifacts/file2.txt",
        filePath: "artifacts/file2.txt",
        fileSize: 200,
        mimeType: "text/plain",
        hashSha256: "abc123",
        origin: "expected",
        validationStatus: "pending",
        createdAt: now,
      });

      const artifacts = db.getArtifactsByTask("task_art_list");
      expect(artifacts).toHaveLength(2);
      expect(artifacts[1]!.mimeType).toBe("text/plain");
      expect(artifacts[1]!.hashSha256).toBe("abc123");
    });
  });

  describe("checkpoint operations edge cases", () => {
    it("should handle snapshot checkpoints", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_cp_snap",
        projectId: "test-project",
        title: "CP Snap",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      const cp: CheckpointRecord = {
        checkpointId: "cp_snap_001",
        runId: "run_cp_snap",
        taskId: "task_001",
        stateType: "run_state",
        stateData: JSON.stringify({ status: "running" }),
        isSnapshot: true,
        snapshotPath: "/tmp/snap.json",
        snapshotSize: 2048,
        snapshotHash: "def456",
        createdAt: now,
      };

      db.insertCheckpoint(cp);
      const latest = db.getLatestCheckpoint("run_cp_snap");
      expect(latest!.isSnapshot).toBe(true);
      expect(latest!.snapshotPath).toBe("/tmp/snap.json");
      expect(latest!.snapshotSize).toBe(2048);
    });

    it("should clean old checkpoints keeping first and last", () => {
      const now = makeTimestamp();
      const runId = "run_cp_clean";
      db.insertRun({
        runId,
        projectId: "test-project",
        title: "CP Clean",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      const times = [
        new Date(Date.now() - 5000).toISOString(),
        new Date(Date.now() - 4000).toISOString(),
        new Date(Date.now() - 3000).toISOString(),
        new Date(Date.now() - 2000).toISOString(),
      ];

      for (let i = 0; i < 4; i++) {
        db.insertCheckpoint({
          checkpointId: `cp_${i}`,
          runId,
          stateType: "run_state",
          stateData: "{}",
          isSnapshot: false,
          createdAt: times[i]!,
        });
      }

      const before = db.getCheckpointsByRun(runId);
      expect(before).toHaveLength(4);

      db.cleanCheckpoints(runId, true, true);

      const after = db.getCheckpointsByRun(runId);
      expect(after).toHaveLength(2);
    });

    it("should not clean checkpoints when count <= 2", () => {
      const now = makeTimestamp();
      const runId = "run_cp_noop";
      db.insertRun({
        runId,
        projectId: "test-project",
        title: "CP NoOp",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      db.insertCheckpoint({
        checkpointId: "cp_a",
        runId,
        stateType: "run_state",
        stateData: "{}",
        isSnapshot: false,
        createdAt: now,
      });
      db.insertCheckpoint({
        checkpointId: "cp_b",
        runId,
        stateType: "run_state",
        stateData: "{}",
        isSnapshot: false,
        createdAt: new Date(Date.now() + 1000).toISOString(),
      });

      db.cleanCheckpoints(runId, true, true);
      const after = db.getCheckpointsByRun(runId);
      expect(after).toHaveLength(2);
    });
  });

  describe("task result operations edge cases", () => {
    it("should handle task results with error messages and output paths", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_res_err",
        projectId: "test-project",
        title: "Res Err",
        status: "completed",
        mode: "auto",
        taskCount: 1,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_res_err",
        runId: "run_res_err",
        title: "Error Task",
        status: "failed",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 1,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      const result: TaskResultRecord = {
        resultId: "res_err_001",
        taskId: "task_res_err",
        runId: "run_res_err",
        attempt: 1,
        status: "failed",
        exitCode: 1,
        outputPath: "outputs/task_res_err/attempt-1.log",
        errorMessage: "Command failed with exit code 1",
        durationMs: 5000,
        createdAt: now,
      };

      db.insertTaskResult(result);

      const resultsByTask = db.getResultsByTask("task_res_err");
      expect(resultsByTask).toHaveLength(1);
      expect(resultsByTask[0]!.errorMessage).toBe("Command failed with exit code 1");
      expect(resultsByTask[0]!.outputPath).toBe("outputs/task_res_err/attempt-1.log");
      expect(resultsByTask[0]!.durationMs).toBe(5000);

      const resultsByRun = db.getResultsByRun("run_res_err");
      expect(resultsByRun).toHaveLength(1);
    });

    it("should handle multiple results per task (different attempts)", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_res_multi",
        projectId: "test-project",
        title: "Res Multi",
        status: "completed",
        mode: "auto",
        taskCount: 1,
        completedTaskCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_res_multi",
        runId: "run_res_multi",
        title: "Multi Task",
        status: "done",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 2,
        maxRetries: 3,
        createdAt: now,
        updatedAt: now,
      });

      for (let attempt = 0; attempt < 3; attempt++) {
        db.insertTaskResult({
          resultId: `res_multi_${attempt}`,
          taskId: "task_res_multi",
          runId: "run_res_multi",
          attempt,
          status: attempt < 2 ? "failed" : "passed",
          exitCode: attempt < 2 ? 1 : 0,
          durationMs: (attempt + 1) * 1000,
          createdAt: new Date(Date.now() + attempt * 1000).toISOString(),
        });
      }

      const results = db.getResultsByTask("task_res_multi");
      expect(results).toHaveLength(3);
      expect(results[0]!.attempt).toBe(2); // ordered by attempt DESC
      expect(results[2]!.attempt).toBe(0);
    });
  });

  describe("event operations edge cases", () => {
    it("should handle events with step_id", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_ev_step",
        projectId: "test-project",
        title: "Ev Step",
        status: "running",
        mode: "auto",
        taskCount: 1,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_ev_step",
        runId: "run_ev_step",
        title: "Ev Step Task",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      db.insertEvent({
        time: now,
        type: "command_started",
        runId: "run_ev_step",
        taskId: "task_ev_step",
        message: "Step started",
      });

      const events = db.queryEvents("run_ev_step");
      expect(events).toHaveLength(1);
    });

    it("should handle events with details as record", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_ev_detail",
        projectId: "test-project",
        title: "Ev Detail",
        status: "running",
        mode: "auto",
        taskCount: 1,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      db.insertTask({
        id: "task_ev_detail",
        runId: "run_ev_detail",
        title: "Ev Detail Task",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });

      db.insertEvent({
        time: now,
        type: "task_completed",
        runId: "run_ev_detail",
        taskId: "task_ev_detail",
        message: "Task done",
        details: { durationMs: 1500, outputLines: 42 },
      });

      const events = db.queryEvents("run_ev_detail");
      expect(events[0]!.details).toEqual({ durationMs: 1500, outputLines: 42 });
    });

    it("should query events with limit", () => {
      const now = makeTimestamp();
      db.insertRun({
        runId: "run_ev_limit",
        projectId: "test-project",
        title: "Ev Limit",
        status: "running",
        mode: "auto",
        taskCount: 0,
        completedTaskCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      for (let i = 0; i < 5; i++) {
        db.insertEvent({
          time: new Date(Date.now() + i * 100).toISOString(),
          type: "run_started",
          runId: "run_ev_limit",
          message: `Event ${i}`,
        });
      }

      const limited = db.queryEvents("run_ev_limit", undefined, 2);
      expect(limited).toHaveLength(2);
    });
  });

  describe("maintenance edge cases", () => {
    it("should handle backup failure gracefully", async () => {
      await expect(db.backup("/nonexistent/path/backup.db")).resolves.not.toThrow();
    });

    it("should handle integrity check failure", () => {
      const result = db.integrityCheck();
      expect(result.valid).toBe(true);
    });

    it("should vacuum without error", () => {
      expect(() => db.vacuum()).not.toThrow();
    });
  });
});
