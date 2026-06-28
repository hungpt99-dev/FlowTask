import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { inspectCommand } from "../../src/cli/commands/inspect.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("inspectCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `inspect-cmd-${Date.now()}`);
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

    await initCommand({ name: "InspectTest" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should inspect a run and show its details", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Inspect me", "auto");
    await runManager.savePrompt(run.runId, "test prompt");

    await runManager.saveTasks(run.runId, [
      {
        id: "task_001",
        runId: run.runId,
        title: "Inspect task",
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

    await inspectCommand(run.runId);

    expect(output).toContain("Inspect Run");
    expect(output).toContain("Inspect me");
    expect(output).toContain(run.runId);
    expect(output).toContain("Inspect task");
  });

  it("should show events section when events exist", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Events test", "auto");

    const { EventStore } = await import("../../src/core/event-store.js");
    const eventStore = new EventStore(projectDir);
    await eventStore.appendToRun(run.runId, {
      type: "task_started",
      runId: run.runId,
      taskId: "task_001",
      message: "Task started",
    });
    await eventStore.appendToRun(run.runId, {
      type: "task_completed",
      runId: run.runId,
      taskId: "task_001",
      message: "Task completed",
    });

    output = "";
    await inspectCommand(run.runId);

    expect(output).toContain("Events");
    expect(output).toContain("task_started");
    expect(output).toContain("Task started");
    expect(output).toContain("task_completed");
    expect(output).toContain("Task completed");
  });

  it("should show log files section when logs exist", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Logs inspect test", "auto");

    const { ensureDir } = await import("../../src/utils/fs.js");
    const logsDir = join(projectDir, ".flowtask", "runs", run.runId, "logs");
    await ensureDir(logsDir);
    (await import("node:fs")).writeFileSync(join(logsDir, "runtime.log"), "[INFO] test");

    output = "";
    await inspectCommand(run.runId);

    expect(output).toContain("Log files");
    expect(output).toContain("runtime.log");
  });

  it("should show error for non-existent run", async () => {
    try {
      await inspectCommand("nonexistent_run_id");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
  });

  it("should show commands section with helpful hints", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Commands test", "auto");

    output = "";
    await inspectCommand(run.runId);

    expect(output).toContain("Commands");
    expect(output).toContain("flowtask logs --run");
    expect(output).toContain("flowtask tasks --run");
    expect(output).toContain("flowtask resume");
    expect(output).toContain(".flowtask/runs/");
  });

  it("should show retry count when task has retries", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Retry inspect", "auto");
    await runManager.saveTasks(run.runId, [
      {
        id: "task_retry_001",
        runId: run.runId,
        title: "Retried task",
        status: "failed" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 2,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    output = "";
    await inspectCommand(run.runId);

    expect(output).toContain("Retries");
    expect(output).toContain("2/3");
  });

  it("should show dependencies when task has dependsOn", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Dep inspect", "auto");
    await runManager.saveTasks(run.runId, [
      {
        id: "task_dep_001",
        runId: run.runId,
        title: "Dependent task",
        status: "pending" as const,
        executor: "shell",
        dependsOn: ["task_dep_002"],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    output = "";
    await inspectCommand(run.runId);

    expect(output).toContain("Depends");
    expect(output).toContain("task_dep_002");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await inspectCommand("some_run");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
