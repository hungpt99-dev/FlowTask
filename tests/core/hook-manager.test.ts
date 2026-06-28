import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HookManager } from "../../src/core/hook-manager.js";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

describe("HookManager", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "flowtask-hooks-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should execute beforeRun hooks", async () => {
    const markerPath = join(testDir, "before-run-marker");
    const config = {
      beforeRun: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeRun({ runId: "test-run" });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute afterRun hooks", async () => {
    const markerPath = join(testDir, "after-run-marker");
    const config = {
      afterRun: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runAfterRun({ runId: "test-run", success: true });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute beforeTask hooks", async () => {
    const markerPath = join(testDir, "before-task-marker");
    const config = {
      beforeTask: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeTask({ runId: "test-run", taskId: "task-1", taskTitle: "Test Task" });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute afterTask hooks", async () => {
    const markerPath = join(testDir, "after-task-marker");
    const config = {
      afterTask: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runAfterTask({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
      success: true,
    });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute beforeRetry hooks", async () => {
    const markerPath = join(testDir, "before-retry-marker");
    const config = {
      beforeRetry: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeRetry({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
      retryCount: 1,
      maxRetries: 3,
    });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute afterRetry hooks", async () => {
    const markerPath = join(testDir, "after-retry-marker");
    const config = {
      afterRetry: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runAfterRetry({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
      retryCount: 1,
      maxRetries: 3,
      success: true,
    });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute onFailure hooks", async () => {
    const markerPath = join(testDir, "failure-marker");
    const config = {
      onFailure: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runOnFailure({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
      error: "Something failed",
    });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should log hook execution results", async () => {
    const markerPath = join(testDir, "log-marker");
    const config = {
      beforeTask: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    const results = await manager.runBeforeTask({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.command).toBe(`touch ${markerPath}`);
  });

  it("should report failed hooks without throwing when failOnError is false", async () => {
    const config = {
      beforeTask: ["exit 1"],
      failOnError: false,
    };
    const manager = new HookManager(testDir, config);
    const results = await manager.runBeforeTask({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
  });

  it("should throw on hook failure when failOnError is true", async () => {
    const config = {
      beforeTask: ["exit 1"],
      failOnError: true,
    };
    const manager = new HookManager(testDir, config);
    await expect(
      manager.runBeforeTask({ runId: "test-run", taskId: "task-1", taskTitle: "Test Task" }),
    ).rejects.toThrow();
  });

  it("should execute multiple hooks in order", async () => {
    const orderPath = join(testDir, "order.txt");
    const config = {
      beforeRun: [`echo "first" >> ${orderPath}`, `echo "second" >> ${orderPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeRun({ runId: "test-run" });
    const content = readFileSync(orderPath, "utf-8").trim().split("\n");
    expect(content).toEqual(["first", "second"]);
  });

  it("should pass hook context via environment variables", async () => {
    const envPath = join(testDir, "env.txt");
    const config = {
      beforeTask: [`echo "$HOOK_RUN_ID|$HOOK_TASK_ID|$HOOK_TASK_TITLE" > ${envPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeTask({
      runId: "test-run-123",
      taskId: "task-abc",
      taskTitle: "My Task",
    });
    const content = readFileSync(envPath, "utf-8").trim();
    expect(content).toBe("test-run-123|task-abc|My Task");
  });

  it("should not execute hooks when config is empty", async () => {
    const manager = new HookManager(testDir, {});
    const results = await manager.runBeforeTask({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
    });
    expect(results).toEqual([]);
  });

  it("should not execute hooks when config is undefined", async () => {
    const manager = new HookManager(testDir);
    const results = await manager.runBeforeRun({ runId: "test-run" });
    expect(results).toEqual([]);
  });
});
