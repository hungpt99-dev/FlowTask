import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { rulesCommand } from "../../src/cli/commands/rules.command.js";

describe("rulesCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `rules-cmd-${Date.now()}`);
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

    await initCommand({ name: "RulesTest" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should list configured rule sources", async () => {
    await rulesCommand("list");

    expect(output).toContain("Configured Rule Sources");
    expect(output).toContain("Enabled");
    expect(output).toContain("Required");
  });

  it("should scan for rule files", async () => {
    await rulesCommand("scan");

    expect(output).toContain("Scanning for common rule files");
  });

  it("should add a rule path", async () => {
    const docsDir = join(projectDir, "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "CUSTOM_RULES.md"), "# Custom Rules\n");
    await rulesCommand("add", "docs/CUSTOM_RULES.md");

    expect(output).toContain("Added rule path");

    const config = JSON.parse(readFileSync(join(projectDir, ".flowtask", "config.json"), "utf-8"));
    expect(config.rules.paths).toContain("docs/CUSTOM_RULES.md");
  });

  it("should warn when adding a duplicate rule path", async () => {
    const docsDir = join(projectDir, "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "DUPE.md"), "# Dupe\n");
    await rulesCommand("add", "docs/DUPE.md");

    try {
      await rulesCommand("add", "docs/DUPE.md");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }

    expect(output).toContain("already configured");
  });

  it("should show error when add is called without a path", async () => {
    try {
      await rulesCommand("add");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
    expect(output).toContain("Usage");
  });

  it("should validate rule paths", async () => {
    await rulesCommand("validate");

    expect(output).toContain("Validating rule paths");
  });

  it("should handle unknown action", async () => {
    await rulesCommand("unknown_action");

    expect(output).toContain("Unknown action");
    expect(output).toContain("Available actions");
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await rulesCommand("list");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });
});
