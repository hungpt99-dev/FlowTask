import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HookManager, HookError } from "../../src/core/hook-manager.js";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";

describe("HookManager edge cases", () => {
  let hookDir: string;

  beforeEach(() => {
    hookDir = mkdtempSync(join(tmpdir(), "flowtask-hooks-edge-"));
  });

  afterEach(() => {
    rmSync(hookDir, { recursive: true, force: true });
  });

  it("should capture stdout from hook execution", async () => {
    const config = {
      beforeRun: [`echo "hello world"`],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "test-run" });

    expect(results).toHaveLength(1);
    expect(results[0]!.stdout).toBe("hello world");
    expect(results[0]!.success).toBe(true);
  });

  it("should capture stderr from hook execution", async () => {
    const config = {
      beforeRun: [`echo "error message" >&2`],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "test-run" });

    expect(results).toHaveLength(1);
    expect(results[0]!.stderr).toBe("error message");
    expect(results[0]!.success).toBe(true);
  });

  it("should report non-existent command as failure", async () => {
    const config = {
      beforeRun: ["nonexistent_command_xyz"],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "test-run" });

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.exitCode).not.toBe(0);
  });

  it("should handle hook context with all fields populated", async () => {
    const markerPath = join(hookDir, "all-fields-marker");
    const config = {
      beforeRetry: [`touch ${markerPath}`],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRetry({
      runId: "run-456",
      taskId: "task-789",
      taskTitle: "Complex Task",
      retryCount: 3,
      maxRetries: 5,
      success: false,
      error: "Something went wrong",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
  });

  it("should pass all context fields as environment variables", async () => {
    const envPath = join(hookDir, "env-all.txt");
    const config = {
      onFailure: [
        `echo "$HOOK_RUN_ID|$HOOK_TASK_ID|$HOOK_TASK_TITLE|$HOOK_RETRY_COUNT|$HOOK_MAX_RETRIES|$HOOK_SUCCESS|$HOOK_ERROR|$HOOK_ROOT_PATH" > ${envPath}`,
      ],
    };
    const manager = new HookManager(hookDir, config);
    await manager.runOnFailure({
      runId: "run-1",
      taskId: "task-2",
      taskTitle: "Failed Task",
      retryCount: 2,
      maxRetries: 3,
      success: false,
      error: "Command failed with exit code 1",
    });

    const content = (await import("node:fs")).readFileSync(envPath, "utf-8").trim();
    expect(content).toContain("run-1");
    expect(content).toContain("task-2");
    expect(content).toContain("Failed Task");
    expect(content).toContain("2");
    expect(content).toContain("3");
    expect(content).toContain("false");
    expect(content).toContain("Command failed");
    expect(content).toContain(hookDir);
  });

  it("should handle empty commands array gracefully", async () => {
    const config = {
      beforeRun: [],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "test-run" });

    expect(results).toEqual([]);
  });

  it("should handle multiple hook points in same config", async () => {
    const beforePath = join(hookDir, "before-marker");
    const afterPath = join(hookDir, "after-marker");
    const config = {
      beforeRun: [`touch ${beforePath}`],
      afterRun: [`touch ${afterPath}`],
    };
    const manager = new HookManager(hookDir, config);

    const beforeResults = await manager.runBeforeRun({ runId: "run-1" });
    const afterResults = await manager.runAfterRun({ runId: "run-1", success: true });

    expect(beforeResults).toHaveLength(1);
    expect(beforeResults[0]!.success).toBe(true);
    expect((await import("node:fs")).existsSync(beforePath)).toBe(true);

    expect(afterResults).toHaveLength(1);
    expect(afterResults[0]!.success).toBe(true);
    expect((await import("node:fs")).existsSync(afterPath)).toBe(true);
  });

  it("should handle hooks with special characters", async () => {
    const markerPath = join(hookDir, "special marker with spaces");
    const config = {
      beforeRun: [`touch "${markerPath}"`],
    };
    const manager = new HookManager(hookDir, config);
    await manager.runBeforeRun({ runId: "test-run" });

    expect((await import("node:fs")).existsSync(markerPath)).toBe(true);
  });

  it("should continue executing remaining hooks after a failure when failOnError is false", async () => {
    const markerPath = join(hookDir, "after-fail-marker");
    const config = {
      beforeRun: ["exit 1", `touch ${markerPath}`],
      failOnError: false,
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "test-run" });

    expect(results).toHaveLength(2);
    expect(results[0]!.success).toBe(false);
    expect(results[1]!.success).toBe(true);
  });

  it("should not execute remaining hooks after a failure when failOnError is true", async () => {
    const markerPath = join(hookDir, "after-fail-marker-2");
    const config = {
      beforeRun: ["exit 1", `touch ${markerPath}`],
      failOnError: true,
    };
    const manager = new HookManager(hookDir, config);

    await expect(manager.runBeforeRun({ runId: "test-run" })).rejects.toThrow("Hook failed");

    expect((await import("node:fs")).existsSync(markerPath)).toBe(false);
  });

  it("should include exit code in hook result for failed commands", async () => {
    const config = {
      beforeRun: ["exit 42"],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "test-run" });

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.exitCode).toBe(42);
  });

  it("should return empty arrays for all hook points with empty config", async () => {
    const manager = new HookManager(hookDir, {});

    const beforeRun = await manager.runBeforeRun({ runId: "r" });
    const afterRun = await manager.runAfterRun({ runId: "r", success: true });
    const beforeTask = await manager.runBeforeTask({ runId: "r", taskId: "t", taskTitle: "T" });
    const afterTask = await manager.runAfterTask({
      runId: "r",
      taskId: "t",
      taskTitle: "T",
      success: true,
    });
    const beforeRetry = await manager.runBeforeRetry({
      runId: "r",
      taskId: "t",
      taskTitle: "T",
      retryCount: 1,
      maxRetries: 3,
    });
    const afterRetry = await manager.runAfterRetry({
      runId: "r",
      taskId: "t",
      taskTitle: "T",
      retryCount: 1,
      maxRetries: 3,
      success: true,
    });
    const onFailure = await manager.runOnFailure({
      runId: "r",
      taskId: "t",
      taskTitle: "T",
      error: "err",
    });

    expect(beforeRun).toEqual([]);
    expect(afterRun).toEqual([]);
    expect(beforeTask).toEqual([]);
    expect(afterTask).toEqual([]);
    expect(beforeRetry).toEqual([]);
    expect(afterRetry).toEqual([]);
    expect(onFailure).toEqual([]);
  });

  // ── New hook type tests ─────────────────────────────

  it("should execute shell hook entry with object config", async () => {
    const marker = join(hookDir, "shell-object");
    const config = {
      beforeRun: [{ type: "shell" as const, command: `touch ${marker}`, timeoutMs: 5000 }],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "r" });
    expect(existsSync(marker)).toBe(true);
    expect(results[0]!.type).toBe("shell");
    expect(results[0]!.success).toBe(true);
  });

  it("should execute script hook entry", async () => {
    const scriptPath = join(hookDir, "test-script.sh");
    const marker = join(hookDir, "script-marker");
    writeFileSync(scriptPath, `echo "ran" > "${marker}"\n`, "utf-8");
    chmodSync(scriptPath, 0o755);
    const config = {
      beforeRun: [{ type: "script" as const, path: scriptPath, args: [], timeoutMs: 5000 }],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "r" });
    expect(existsSync(marker)).toBe(true);
    expect(results[0]!.type).toBe("script");
    expect(results[0]!.success).toBe(true);
  });

  it("should fail gracefully for non-existent script", async () => {
    const config = {
      beforeRun: [
        { type: "script" as const, path: "/nonexistent/script.sh", args: [], timeoutMs: 5000 },
      ],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "r" });
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.type).toBe("script");
  });

  it("should throw HookError when failOnError is true and hook fails", async () => {
    const config = {
      beforeRun: ["exit 1"],
      failOnError: true,
    };
    const manager = new HookManager(hookDir, config);
    try {
      await manager.runBeforeRun({ runId: "r" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HookError);
      expect((err as HookError).results).toHaveLength(1);
      expect((err as HookError).results[0]!.success).toBe(false);
    }
  });

  it("should time out long-running shell hooks", async () => {
    const config = {
      beforeRun: [{ type: "shell" as const, command: "sleep 10", timeoutMs: 100 }],
      failOnError: false,
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "r" });
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.exitCode).toBeNull();
  });

  it("should return HookResult with duration", async () => {
    const config = {
      beforeRun: ["echo fast"],
    };
    const manager = new HookManager(hookDir, config);
    const results = await manager.runBeforeRun({ runId: "r" });
    expect(results[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(results[0]!.entry).toBe("echo fast");
  });

  it("should handle undefined entries gracefully", async () => {
    const config = {};
    const manager = new HookManager(hookDir, config);
    const r = await manager.runBeforeScan({ runId: "r" });
    expect(r).toEqual([]);
  });
});
