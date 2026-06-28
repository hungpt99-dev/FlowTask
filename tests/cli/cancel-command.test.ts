import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { cancelCommand } from "../../src/cli/commands/cancel.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("cancelCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `cancel-cmd-${Date.now()}`);
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

    await initCommand({ name: "CancelTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Cancel test run", "auto");
    runId = run.runId;

    await runManager.saveTasks(runId, [
      {
        id: "task_running_001",
        runId,
        title: "Running task",
        status: "running" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task_pending_001",
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
    ]);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should cancel a run and mark tasks as cancelled", async () => {
    await cancelCommand(runId);

    expect(output).toContain("Run cancelled");
    expect(output).toContain("Cancel test run");
    expect(output).toContain(runId);

    const tasks = await runManager.loadTasks(runId);
    const runningTask = tasks.find((t) => t.id === "task_running_001");
    expect(runningTask!.status).toBe("cancelled");
    const pendingTask = tasks.find((t) => t.id === "task_pending_001");
    expect(pendingTask!.status).toBe("cancelled");
  });

  it("should show error for non-existent run", async () => {
    try {
      await cancelCommand("nonexistent");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
  });

  it("should show message for already completed run", async () => {
    await runManager.updateRunStatus(runId, "completed");
    try {
      await cancelCommand(runId);
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("already completed");
  });

  it("should show message for already cancelled run", async () => {
    await runManager.updateRunStatus(runId, "cancelled");
    try {
      await cancelCommand(runId);
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("already cancelled");
  });

  it("should persist cancelled status to disk", async () => {
    await cancelCommand(runId);

    const run = await runManager.loadRun(runId);
    expect(run!.status).toBe("cancelled");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await cancelCommand("some_run");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
