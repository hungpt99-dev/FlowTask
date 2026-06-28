import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { stopCommand } from "../../src/cli/commands/stop.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("stopCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `stop-cmd-${Date.now()}`);
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

    await initCommand({ name: "StopTest" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should show message when no active run", async () => {
    try {
      await stopCommand();
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No active run");
  });

  it("should show stopping process and update run status when run is active", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Stop test run", "auto");
    await runManager.savePrompt(run.runId, "stop test");

    const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
    await manager.saveState(projectDir, {
      projectId: project.projectId,
      status: "has_running_run",
      activeRunId: run.runId,
      lastRunId: run.runId,
      updatedAt: new Date().toISOString(),
    });

    try {
      await stopCommand();
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Stop test run");
    expect(output).toContain("Resume");
  });

  it("should handle stale process gracefully", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Stale run", "auto");

    const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
    await manager.saveState(projectDir, {
      projectId: project.projectId,
      status: "has_running_run",
      activeRunId: run.runId,
      lastRunId: run.runId,
      updatedAt: new Date().toISOString(),
    });

    try {
      await stopCommand();
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Stale run");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await stopCommand();
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
