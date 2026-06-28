import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { statusCommand } from "../../src/cli/commands/status.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("statusCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `status-cmd-${Date.now()}`);
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

    await initCommand({ name: "StatusTest" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should show project name and status", async () => {
    await statusCommand();

    expect(output).toContain("FlowTask Project");
    expect(output).toContain("StatusTest");
  });

  it("should show active run if present", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Active run", "auto");
    await runManager.savePrompt(run.runId, "test prompt");

    await runManager.saveTasks(run.runId, [
      {
        id: "task_001",
        runId: run.runId,
        title: "Test task",
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

    const state = {
      projectId: project.projectId,
      status: "has_running_run" as const,
      activeRunId: run.runId,
      lastRunId: run.runId,
      updatedAt: new Date().toISOString(),
    };
    const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
    await manager.saveState(projectDir, state);

    await statusCommand();

    expect(output).toContain("Active run");
    expect(output).toContain("Active Run");
    expect(output).toContain("Test task");
  });

  it("should show last run when no active run but last run exists", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Last run test", "auto");

    const state = {
      projectId: project.projectId,
      status: "idle" as const,
      lastRunId: run.runId,
      updatedAt: new Date().toISOString(),
    };
    const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
    await manager.saveState(projectDir, state);

    output = "";
    await statusCommand();

    expect(output).toContain("Last Run");
    expect(output).toContain("Last run test");
  });

  it("should show next commands when active run exists", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Active cmd test", "auto");

    const state = {
      projectId: project.projectId,
      status: "has_running_run" as const,
      activeRunId: run.runId,
      lastRunId: run.runId,
      updatedAt: new Date().toISOString(),
    };
    const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
    await manager.saveState(projectDir, state);

    output = "";
    await statusCommand();

    expect(output).toContain("Next commands");
    expect(output).toContain("flowtask logs --follow");
    expect(output).toContain("flowtask stop");
    expect(output).toContain("flowtask inspect");
  });

  it("should show config section", async () => {
    await statusCommand();

    expect(output).toContain("Config");
    expect(output).toContain("Planner mode");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await statusCommand();
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
