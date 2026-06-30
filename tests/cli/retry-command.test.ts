import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { retryCommand } from "../../src/cli/commands/retry.command.js";
import { RunManager } from "../../src/core/run-manager.js";
import { RunLifecycle } from "../../src/core/run-lifecycle.js";
import { EventStore } from "../../src/core/event-store.js";

describe("retryCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `retry-cmd-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
    process.stdin.isTTY = false as unknown as boolean;

    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    output = "";
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    await initCommand({ name: "RetryTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Retry test run", "auto");
    runId = run.runId;

    await runManager.saveTasks(runId, [
      {
        id: "task_failed_001",
        runId,
        title: "Failed task",
        status: "failed" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task_pending_003",
        runId,
        title: "Pending task",
        status: "pending" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task_max_retries_001",
        runId,
        title: "Max retries task",
        status: "failed" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 2,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should show retry dry-run for a failed task", async () => {
    try {
      await retryCommand("task_failed_001", { run: runId, dryRun: true });
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Retry dry-run");
    expect(output).toContain("Failed task");
    expect(output).toContain("task_failed_001");
    expect(output).toContain("Retry count: 1/2");
  });

  it("should show error when task not found", async () => {
    try {
      await retryCommand("nonexistent", { run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
    expect(output).toContain("Task not found");
  });

  it("should show warning when task is not failed or interrupted", async () => {
    try {
      await retryCommand("task_pending_003", { run: runId });
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain('"pending"');
    expect(output).toContain("--force");
  });

  it("should show error when max retries reached", async () => {
    try {
      await retryCommand("task_max_retries_001", { run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
    expect(output).toContain("max retries");
    expect(output).toContain("--force");
  });

  it("should show error when no run specified and no active run", async () => {
    try {
      await retryCommand("task_failed_001", {});
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
    expect(output).toContain("No run specified");
  });

  it("should show error when run not found", async () => {
    try {
      await retryCommand("task_failed_001", { run: "nonexistent_run" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
    expect(output).toContain("Run not found");
  });

  it("should accept instruction option in dry-run", async () => {
    try {
      await retryCommand("task_failed_001", {
        run: runId,
        dryRun: true,
        instruction: "Use semicolons instead of &&",
      });
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Retry dry-run");
    expect(output).toContain("Instruction: Use semicolons instead of &&");
  });

  it("should accept skipValidation option in dry-run", async () => {
    try {
      await retryCommand("task_failed_001", { run: runId, dryRun: true, skipValidation: true });
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Retry dry-run");
    expect(output).toContain("Failed task");
  });

  it("should accept multiple instructions in dry-run", async () => {
    try {
      await retryCommand("task_failed_001", {
        run: runId,
        dryRun: true,
        instruction: ["Use semicolons", "Add error handling"],
      });
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Retry dry-run");
    expect(output).toContain("Instruction: Use semicolons, Add error handling");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await retryCommand("task_failed_001", { run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });

  it("should increment and persist retryCount after retry success", async () => {
    const run = (await runManager.loadRun(runId))!;
    run.errors = [
      {
        taskId: "task_failed_001",
        message: "First attempt error",
        timestamp: new Date().toISOString(),
      },
    ];
    run.errorCount = 1;
    await runManager.saveRun(run);

    const execSpy = vi.spyOn(RunLifecycle.prototype, "executeSingleTask").mockResolvedValue(true);
    const eventSpy = vi.spyOn(EventStore.prototype, "appendToRun").mockResolvedValue();

    try {
      await retryCommand("task_failed_001", { run: runId, skipValidation: true });
    } catch {
      // process.exit expected
    }

    const tasks = await runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === "task_failed_001");
    expect(task?.retryCount).toBe(1);

    execSpy.mockRestore();
    eventSpy.mockRestore();
  });

  it("should clear task errors from run before retry execution", async () => {
    const run = (await runManager.loadRun(runId))!;
    run.errors = [
      {
        taskId: "task_failed_001",
        message: "First attempt error",
        timestamp: new Date().toISOString(),
      },
    ];
    run.errorCount = 1;
    await runManager.saveRun(run);

    // Mock executeSingleTask to fail, so only pre-retry error clearing runs
    const execSpy = vi.spyOn(RunLifecycle.prototype, "executeSingleTask").mockResolvedValue(false);
    const eventSpy = vi.spyOn(EventStore.prototype, "appendToRun").mockResolvedValue();

    try {
      await retryCommand("task_failed_001", { run: runId, skipValidation: true });
    } catch {
      // process.exit expected
    }

    const updatedRun = await runManager.loadRun(runId);
    expect(updatedRun?.errors ?? []).toHaveLength(0);
    expect(updatedRun?.errorCount).toBe(0);

    execSpy.mockRestore();
    eventSpy.mockRestore();
  });

  it("should clear task errors from run after retry success", async () => {
    const run = (await runManager.loadRun(runId))!;
    run.errors = [
      {
        taskId: "task_failed_001",
        message: "First attempt error",
        timestamp: new Date().toISOString(),
      },
      {
        taskId: "other_task",
        message: "Other task error",
        timestamp: new Date().toISOString(),
      },
    ];
    run.errorCount = 2;
    await runManager.saveRun(run);

    const execSpy = vi.spyOn(RunLifecycle.prototype, "executeSingleTask").mockResolvedValue(true);
    const eventSpy = vi.spyOn(EventStore.prototype, "appendToRun").mockResolvedValue();

    try {
      await retryCommand("task_failed_001", { run: runId, skipValidation: true });
    } catch {
      // process.exit expected
    }

    const updatedRun = await runManager.loadRun(runId);
    expect(updatedRun?.errors?.filter((e) => e.taskId === "task_failed_001")).toHaveLength(0);
    expect(updatedRun?.errors?.filter((e) => e.taskId === "other_task")).toHaveLength(1);
    expect(updatedRun?.errorCount).toBe(1);

    execSpy.mockRestore();
    eventSpy.mockRestore();
  });
});
