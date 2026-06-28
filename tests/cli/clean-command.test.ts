import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { cleanCommand } from "../../src/cli/commands/clean.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("cleanCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `clean-cmd-${Date.now()}`);
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

    await initCommand({ name: "CleanTest" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should show no runs to clean when no runs exist", async () => {
    try {
      await cleanCommand({});
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
  });

  it("should show dry run with runs to delete", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    await runManager.createRun(project.projectId, "Run to clean", "auto");

    try {
      await cleanCommand({ dryRun: true });
    } catch {
      // process.exit is expected
    }

    expect(output).toContain("Dry run");
    expect(output).toContain("Run to clean");
  });

  it("should filter by status", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    await runManager.createRun(project.projectId, "Active run", "auto");
    await runManager.createRun(project.projectId, "Another run", "auto");

    try {
      await cleanCommand({ status: "created", dryRun: true });
    } catch {
      // process.exit is expected
    }

    expect(output).toContain("Active run");
    expect(output).toContain("Another run");
  });

  it("should reject invalid duration format", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    await runManager.createRun(project.projectId, "Some run", "auto");

    try {
      await cleanCommand({ olderThan: "invalid" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
  });

  it("should actually delete runs when not in dry-run mode", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Run to delete", "auto");
    const runDir = join(projectDir, ".flowtask", "runs", run.runId);
    const { ensureDir } = await import("../../src/utils/fs.js");
    await ensureDir(runDir);

    expect((await import("node:fs")).existsSync(runDir)).toBe(true);

    output = "";
    try {
      await cleanCommand({});
    } catch {
      // process.exit expected
    }

    expect((await import("node:fs")).existsSync(runDir)).toBe(false);
    expect(output).toContain("Cleaning");
    expect(output).toContain("run_to_delete");
    expect(output).toContain("Cleaned");
  });

  it("should show no matches when olderThan filter excludes all", async () => {
    const runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    await runManager.createRun(project.projectId, "Recent run", "auto");

    output = "";
    try {
      await cleanCommand({ olderThan: "1s", dryRun: true });
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }

    expect(output).toContain("No runs match");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await cleanCommand({});
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
