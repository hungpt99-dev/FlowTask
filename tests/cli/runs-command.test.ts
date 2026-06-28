import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { runsCommand } from "../../src/cli/commands/runs.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("runsCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `runs-cmd-${Date.now()}`);
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

    await initCommand({ name: "RunsTest" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should show no runs message when no runs exist", async () => {
    try {
      await runsCommand({});
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
  });

  it("should list runs", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    await runManager.createRun(project.projectId, "First run", "auto");
    await runManager.createRun(project.projectId, "Second run", "manual");

    await runsCommand({});

    expect(output).toContain("First run");
    expect(output).toContain("Second run");
    expect(output).toContain("Runs");
  });

  it("should filter by status", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    await runManager.createRun(project.projectId, "Auto run", "auto");
    await runManager.createRun(project.projectId, "Manual run", "manual");

    await runsCommand({ status: "created" });

    expect(output).toContain("Auto run");
    expect(output).toContain("Manual run");
  });

  it("should respect limit option", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    for (let i = 0; i < 5; i++) {
      await runManager.createRun(project.projectId, `Run ${i}`, "auto");
    }

    await runsCommand({ limit: "3" });

    expect(output).toContain("3/5 shown");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await runsCommand({});
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
