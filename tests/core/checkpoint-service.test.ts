import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { DatabaseManager } from "../../src/core/database-manager.js";
import { CheckpointService } from "../../src/core/checkpoint-service.js";

function makeTestDir(): string {
  const dir = path.join(os.tmpdir(), `flowtask-cp-test-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("CheckpointService", () => {
  let testDir: string;
  let db: DatabaseManager;
  let checkpointService: CheckpointService;

  beforeEach(async () => {
    testDir = makeTestDir();
    db = await DatabaseManager.create(path.join(testDir, "flowtask.db"));
    checkpointService = new CheckpointService(db, testDir);

    const now = new Date().toISOString();
    db.insertRun({
      runId: "run_cp_test",
      projectId: "test-project",
      title: "Checkpoint Test",
      status: "running",
      mode: "auto",
      taskCount: 3,
      completedTaskCount: 1,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("inline checkpoints (small state)", () => {
    it("saves and loads small checkpoint inline", async () => {
      const record = await checkpointService.saveCheckpoint(
        "run_cp_test",
        {
          runId: "run_cp_test",
          taskId: "task_001",
          status: "running",
        },
        { taskId: "task_001", stateType: "task_state" },
      );

      expect(record.isSnapshot).toBe(false);
      expect(record.snapshotPath).toBeUndefined();
      expect(record.checkpointId).toMatch(/^chk_/);

      const loaded = await checkpointService.loadLatestCheckpoint("run_cp_test");
      expect(loaded).not.toBeNull();
      expect(loaded!.state.status).toBe("running");
      expect(loaded!.fromSnapshot).toBe(false);
    });
  });

  describe("snapshot checkpoints (large state)", () => {
    it("saves large state as snapshot file", async () => {
      const largeState = {
        runId: "run_cp_test",
        taskId: "task_002",
        status: "running",
        data: "x".repeat(2048),
      };

      const record = await checkpointService.saveCheckpoint("run_cp_test", largeState, {
        taskId: "task_002",
        stateType: "task_state",
      });

      expect(record.isSnapshot).toBe(true);
      expect(record.snapshotPath).toBeTruthy();
      expect(record.snapshotHash).toBeTruthy();
      expect(record.snapshotSize).toBeGreaterThan(1024);

      expect(fs.existsSync(record.snapshotPath!)).toBe(true);
    });

    it("loads snapshot checkpoint from file", async () => {
      const largeState = {
        runId: "run_cp_test",
        taskId: "task_003",
        status: "running",
        data: "y".repeat(2048),
      };

      await checkpointService.saveCheckpoint("run_cp_test", largeState, {
        taskId: "task_003",
        stateType: "task_state",
      });

      const loaded = await checkpointService.loadLatestCheckpoint("run_cp_test");
      expect(loaded).not.toBeNull();
      expect(loaded!.state.status).toBe("running");
      expect(loaded!.fromSnapshot).toBe(true);
      expect(loaded!.state.data).toBe("y".repeat(2048));
    });
  });

  describe("checkpoint management", () => {
    it("returns all checkpoints ordered by date", async () => {
      for (let i = 0; i < 3; i++) {
        await checkpointService.saveCheckpoint(
          "run_cp_test",
          {
            runId: "run_cp_test",
            status: "running",
            iteration: i,
          },
          { stateType: "run_state" },
        );
      }

      const checkpoints = checkpointService.getCheckpoints("run_cp_test");
      expect(checkpoints.length).toBeGreaterThanOrEqual(3);
    });

    it("cleans intermediate checkpoints", async () => {
      for (let i = 0; i < 7; i++) {
        await new Promise((r) => setTimeout(r, 10));
        await checkpointService.saveCheckpoint(
          "run_cp_test",
          {
            runId: "run_cp_test",
            status: "running",
            iteration: i,
          },
          { stateType: "run_state" },
        );
      }

      checkpointService.cleanOldCheckpoints("run_cp_test", 3);
      const remaining = checkpointService.getCheckpoints("run_cp_test");
      expect(remaining.length).toBeLessThanOrEqual(3);
    });

    it("returns null for nonexistent run", async () => {
      const loaded = await checkpointService.loadLatestCheckpoint("nonexistent");
      expect(loaded).toBeNull();
    });
  });
});
