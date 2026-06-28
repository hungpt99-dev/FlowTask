import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { retryCommand } from "../../src/cli/commands/retry.command.js";
import { RunManager } from "../../src/core/run-manager.js";

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
});
