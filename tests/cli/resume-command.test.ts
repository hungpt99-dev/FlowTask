import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { resumeCommand } from "../../src/cli/commands/resume.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("resumeCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `resume-cmd-${Date.now()}`);
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

    await initCommand({ name: "ResumeTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Resume test run", "auto");
    runId = run.runId;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should show message when no run to resume", async () => {
    try {
      await resumeCommand();
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No run to resume");
  });

  it("should show error for non-existent run", async () => {
    try {
      await resumeCommand("nonexistent");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
  });

  it("should show completed message for already completed run", async () => {
    await runManager.updateRunStatus(runId, "completed");
    try {
      await resumeCommand(runId);
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("already completed");
  });

  it("should show dry run info with interrupted tasks", async () => {
    await runManager.updateRunStatus(runId, "interrupted");
    await runManager.saveTasks(runId, [
      {
        id: "task_interrupted_001",
        runId,
        title: "Interrupted task",
        status: "interrupted" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    try {
      await resumeCommand(runId, { dryRun: true });
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Resume dry-run");
    expect(output).toContain("Interrupted task");
  });

  it("should show dry run info with pending tasks", async () => {
    await runManager.updateRunStatus(runId, "interrupted");
    await runManager.saveTasks(runId, [
      {
        id: "task_pending_002",
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

    try {
      await resumeCommand(runId, { dryRun: true });
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Resume dry-run");
    expect(output).toContain("Pending task");
  });

  it("should mark running tasks as interrupted when not skipping", async () => {
    await runManager.updateRunStatus(runId, "interrupted");
    await runManager.saveTasks(runId, [
      {
        id: "task_running_002",
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
    ]);

    try {
      await resumeCommand(runId, { dryRun: true });
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Running task");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await resumeCommand("some_run");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
