import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { logsCommand } from "../../src/cli/commands/logs.command.js";
import { RunManager } from "../../src/core/run-manager.js";
import { ensureDir } from "../../src/utils/fs.js";
import { runtimeLogPath } from "../../src/utils/paths.js";

describe("logsCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `logs-cmd-${Date.now()}`);
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

    await initCommand({ name: "LogsTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Logs test run", "auto");
    runId = run.runId;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should show log files for a run", async () => {
    const logsDir = join(projectDir, ".flowtask", "runs", runId, "logs");
    await ensureDir(logsDir);
    writeFileSync(join(logsDir, "runtime.log"), "[INFO] Test log entry\n");
    writeFileSync(join(logsDir, "validation.log"), "[VALIDATION] OK\n");

    try {
      await logsCommand({ run: runId });
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Log files for run");
    expect(output).toContain(runId);
    expect(output).toContain("runtime.log");
    expect(output).toContain("validation.log");
  });

  it("should show runtime log content with --runtime", async () => {
    const logPath = runtimeLogPath(projectDir, runId);
    await ensureDir(join(projectDir, ".flowtask", "runs", runId, "logs"));
    writeFileSync(logPath, "[INFO] Runtime entry\n");

    try {
      await logsCommand({ run: runId, runtime: true, tail: "50" });
    } catch {
      // process.exit expected
    }

    expect(output).toContain("Runtime entry");
  });

  it("should show message when no logs found", async () => {
    try {
      await logsCommand({ run: runId });
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No log files found");
  });

  it("should show message when no run specified and no recent run", async () => {
    try {
      await logsCommand({});
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No run specified");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await logsCommand({ run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
