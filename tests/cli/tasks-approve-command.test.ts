import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import {
  tasksApproveCommand,
  tasksDenyCommand,
} from "../../src/cli/commands/tasks-approve.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("tasksApproveCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `tasks-approve-cmd-${Date.now()}`);
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

    await initCommand({ name: "TasksApproveTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Approve test", "auto");
    runId = run.runId;

    await runManager.saveTasks(runId, [
      {
        id: "task_app_001",
        runId,
        title: "Task awaiting approval",
        status: "waiting_approval" as const,
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

  it("should approve a waiting_approval task and set to pending", async () => {
    await tasksApproveCommand("task_app_001", { run: runId });

    expect(output).toContain("Task task_app_001 approved");
    expect(output).toContain("Task awaiting approval");

    const tasks = await runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === "task_app_001");
    expect(task!.status).toBe("pending");
  });

  it("should deny a waiting_approval task and set to skipped", async () => {
    await tasksDenyCommand("task_app_001", { run: runId });

    expect(output).toContain("Task task_app_001 denied");

    const tasks = await runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === "task_app_001");
    expect(task!.status).toBe("skipped");
  });

  it("should fail to approve a task not in waiting_approval status", async () => {
    try {
      await tasksApproveCommand("task_pending_001", { run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
  });

  it("should fail to deny a task not in waiting_approval status", async () => {
    try {
      await tasksDenyCommand("task_pending_001", { run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
  });

  it("should fail for non-existent task when approving", async () => {
    try {
      await tasksApproveCommand("nonexistent", { run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
  });

  it("should fail for non-existent task when denying", async () => {
    try {
      await tasksDenyCommand("nonexistent", { run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
  });

  it("should persist approval status change to disk", async () => {
    await tasksApproveCommand("task_app_001", { run: runId });

    const loaded = await runManager.loadTasks(runId);
    const task = loaded.find((t) => t.id === "task_app_001");
    expect(task!.status).toBe("pending");
  });

  it("should persist denial status change to disk", async () => {
    await tasksDenyCommand("task_app_001", { run: runId });

    const loaded = await runManager.loadTasks(runId);
    const task = loaded.find((t) => t.id === "task_app_001");
    expect(task!.status).toBe("skipped");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await tasksApproveCommand("task_app_001", { run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });

  it("should resolve run from state when no --run option given", async () => {
    const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
    await manager.saveState(projectDir, {
      projectId: JSON.parse(
        (await import("node:fs")).readFileSync(
          join(projectDir, ".flowtask", "project.json"),
          "utf-8",
        ),
      ).projectId,
      status: "has_running_run",
      activeRunId: runId,
      lastRunId: runId,
      updatedAt: new Date().toISOString(),
    });

    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true as unknown as boolean;
    output = "";

    await tasksApproveCommand("task_app_001", {});

    expect(output).toContain("Task task_app_001 approved");
    process.stdin.isTTY = originalIsTTY;
  });

  it("should fail when no run specified and state has no active/last run", async () => {
    const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
    await manager.saveState(projectDir, {
      projectId: JSON.parse(
        (await import("node:fs")).readFileSync(
          join(projectDir, ".flowtask", "project.json"),
          "utf-8",
        ),
      ).projectId,
      status: "idle",
      updatedAt: new Date().toISOString(),
    });

    output = "";
    try {
      await tasksApproveCommand("task_app_001", {});
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
    expect(output).toContain("No run specified");
  });

  it("should fail to approve when no tasks exist for the run", async () => {
    const runManager2 = new RunManager(projectDir);
    const emptyRun = await runManager2.createRun(
      JSON.parse(
        (await import("node:fs")).readFileSync(
          join(projectDir, ".flowtask", "project.json"),
          "utf-8",
        ),
      ).projectId,
      "Empty run",
      "auto",
    );

    output = "";
    try {
      await tasksApproveCommand("task_app_001", { run: emptyRun.runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
    expect(output).toContain("Task not found");
  });
});
