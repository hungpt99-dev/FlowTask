import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { tasksCommand } from "../../src/cli/commands/tasks.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("tasksCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `tasks-cmd-${Date.now()}`);
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

    await initCommand({ name: "TasksTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Task list test", "auto");
    runId = run.runId;

    await runManager.saveTasks(runId, [
      {
        id: "task_001",
        runId,
        title: "First task",
        description: "Do this first",
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
        id: "task_002",
        runId,
        title: "Second task",
        status: "done" as const,
        executor: "shell",
        dependsOn: ["task_001"],
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

  it("should list all tasks for a run", async () => {
    await tasksCommand({ run: runId });

    expect(output).toContain("task_001");
    expect(output).toContain("task_002");
    expect(output).toContain("First task");
    expect(output).toContain("Second task");
  });

  it("should filter tasks by status", async () => {
    await tasksCommand({ run: runId, status: "done" });

    expect(output).toContain("Second task");
    expect(output).not.toContain("First task");
  });

  it("should show no tasks message when no tasks exist for a run", async () => {
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const emptyRun = await runManager.createRun(project.projectId, "Empty run", "auto");

    try {
      await tasksCommand({ run: emptyRun.runId });
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
  });

  it("should show task descriptions", async () => {
    await tasksCommand({ run: runId });

    expect(output).toContain("Do this first");
  });

  it("should show no runs found when no run specified and no state with no runs", async () => {
    const noRunDir = join(testDir, `tasks-no-runs-${Date.now()}`);
    mkdirSync(noRunDir, { recursive: true });
    process.chdir(noRunDir);
    await initCommand({ name: "NoRunsTest" });

    try {
      await tasksCommand({});
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No runs found");
  });

  it("should resolve to first run when no --run specified and no state but runs exist", async () => {
    process.chdir(originalCwd);
    const firstRunDir = join(testDir, `tasks-first-run-${Date.now()}`);
    mkdirSync(firstRunDir, { recursive: true });
    process.chdir(firstRunDir);
    await initCommand({ name: "FirstRunTest" });

    const runManager = new RunManager(firstRunDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(firstRunDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const firstRun = await runManager.createRun(project.projectId, "First fallback run", "auto");
    await runManager.saveTasks(firstRun.runId, [
      {
        id: "task_fallback_001",
        runId: firstRun.runId,
        title: "Fallback task",
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

    output = "";
    try {
      await tasksCommand({});
    } catch {
      // process.exit expected
    }

    expect(output).toContain("task_fallback_001");
    expect(output).toContain("Fallback task");
  });

  it("should show no tasks message for a run without tasks", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const emptyRun = await runManager.createRun(project.projectId, "Empty run", "auto");

    try {
      await tasksCommand({ run: emptyRun.runId });
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No tasks found");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await tasksCommand({ run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
