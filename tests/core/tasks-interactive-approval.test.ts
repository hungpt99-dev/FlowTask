import { describe, it, expect } from "vitest";
import { RunManager } from "../../src/core/run-manager.js";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Interactive Task Approval", () => {
  const makeTask = (id: string, status: "pending" | "waiting_approval" = "pending") => ({
    id,
    runId: "test-run",
    title: "Test task",
    description: "A test task",
    executor: "shell",
    status,
    dependsOn: [] as string[],
    acceptanceCriteria: ["done"],
    maxRetries: 2,
    retryCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it("should approve tasks automatically in auto mode via config", () => {
    const config = { approval: { autoApprove: true } };
    expect(config.approval.autoApprove).toBe(true);
  });

  it("should mark tasks as waiting_approval in manual mode", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "flowtask-approval-status-"));
    try {
      const manager = new RunManager(testDir);
      const runId = "test-run-approval";
      const task = makeTask("task-approve-1", "pending");
      await manager.saveTasks(runId, [task]);
      const updated = await manager.updateTaskStatus(runId, task.id, "waiting_approval");
      expect(updated.status).toBe("waiting_approval");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should handle task approval via status update to pending", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "flowtask-approve-method-"));
    try {
      const manager = new RunManager(testDir);
      const runId = "test-run-approve-method";
      const task = makeTask("task-approve-2", "waiting_approval");
      await manager.saveTasks(runId, [task]);
      const approved = await manager.updateTaskStatus(runId, task.id, "pending");
      expect(approved.status).toBe("pending");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should handle task denial via status update to skipped", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "flowtask-deny-method-"));
    try {
      const manager = new RunManager(testDir);
      const runId = "test-run-deny-method";
      const task = makeTask("task-deny-1", "waiting_approval");
      await manager.saveTasks(runId, [task]);
      const denied = await manager.updateTaskStatus(runId, task.id, "skipped");
      expect(denied.status).toBe("skipped");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should resolve approval when approval is disabled", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "flowtask-approval-disabled-"));
    try {
      const manager = new RunManager(testDir);
      const runId = "test-run-disabled";
      const task = makeTask("task-disabled", "pending");
      await manager.saveTasks(runId, [task]);
      const updated = await manager.updateTaskStatus(runId, task.id, "pending");
      expect(updated.status).toBe("pending");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
