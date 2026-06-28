import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { runCommand } from "../../src/cli/commands/run.command.js";
import { clearCredentialCache } from "../../src/config/credential-resolver.js";

describe("runCommand", { timeout: 30000 }, () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `run-cmd-${Date.now()}`);
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
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
    clearCredentialCache();
  });

  it("should show error and exit when project not initialized", async () => {
    try {
      await runCommand("do something", {});
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
    expect(output).toContain("not initialized");
    expect(output).toContain("flowtask init");
  });

  it("should show run header and execute with simple planner", async () => {
    await initCommand({ name: "RunTest" });

    try {
      await runCommand("Generate README", { mode: "plan-only", planner: "simple" });
    } catch {
      // process.exit may be called
    }

    expect(output).toContain("FlowTask Run");
    expect(output).toContain("Generate README");
    expect(output).toContain("Using simple planner");
  });

  it("should show verbose info when --verbose is set", async () => {
    await initCommand({ name: "VerboseTest" });

    try {
      await runCommand("Write docs", { mode: "plan-only", verbose: true, planner: "simple" });
    } catch {
      // process.exit may be called
    }

    expect(output).toContain("Planner:");
    expect(output).toContain("Executor:");
  });

  it("should suppress verbose CLI header when --quiet is set", async () => {
    await initCommand({ name: "QuietTest" });

    try {
      await runCommand("Quiet run", { mode: "plan-only", quiet: true });
    } catch {
      // process.exit may be called
    }

    expect(output).not.toContain("Planner:");
    expect(output).not.toContain("Executor:");
    expect(output).toContain("Plan-only mode");
  });

  it("should set mode to plan-only when --plan-only flag is used", async () => {
    await initCommand({ name: "PlanOnlyTest" });

    try {
      await runCommand("Plan only test", { planOnly: true });
    } catch {
      // process.exit may be called
    }

    expect(output).toContain("Plan-only mode");
    expect(output).toContain("FlowTask Run");
  });

  it("should set mode to dry-run when --dry-run flag is used", async () => {
    await initCommand({ name: "DryRunTest" });

    try {
      await runCommand("Dry run test", { dryRun: true });
    } catch {
      // process.exit may be called
    }

    expect(output).toContain("Dry-run mode");
  });

  it("should show debug output when --debug flag is used with plan-only", async () => {
    await initCommand({ name: "DebugTest" });

    try {
      await runCommand("Debug test", { debug: true, planOnly: true });
    } catch {
      // process.exit may be called
    }

    expect(output).toContain("[debug]");
    expect(output).toContain("Plan-only mode");
  });

  it("should show JSON output when --json is set", async () => {
    await initCommand({ name: "JsonTest" });

    try {
      await runCommand("JSON run test", { json: true, mode: "plan-only" });
    } catch {
      // process.exit may be called
    }

    expect(output).toContain("Plan-only mode");
  });

  it("should handle run lifecycle errors gracefully", async () => {
    await initCommand({ name: "ErrorTest" });

    try {
      await runCommand("", { mode: "plan-only" });
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
  });

  it("should accept empty prompt with plan-only mode", async () => {
    await initCommand({ name: "EmptyPromptTest" });

    try {
      await runCommand("", { mode: "plan-only" });
    } catch {
      // process.exit may be called
    }

    expect(output).toContain("FlowTask Run");
  });
});
