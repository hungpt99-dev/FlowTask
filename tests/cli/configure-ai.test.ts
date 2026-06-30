import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { ProjectManager } from "../../src/core/project-manager.js";
import { configureAiCommand } from "../../src/cli/commands/configure.command.js";
import { resetSecretStore } from "../../src/config/secret-store.js";
import { configJsonPath } from "../../src/utils/paths.js";
import { readJsonFile } from "../../src/utils/fs.js";

vi.mock("enquirer", () => ({
  default: class MockEnquirer {
    async prompt() {
      return { providers: ["__skip__"] };
    }
  },
}));

describe("configure AI provider command", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `configure-ai-test-${Date.now()}`);
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

    const manager = new ProjectManager();
    await manager.init(projectDir, "ConfigureTest");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
    resetSecretStore();
  });

  it("should exist as a function", () => {
    expect(typeof configureAiCommand).toBe("function");
  });

  it("should require an initialized project", async () => {
    const uninitDir = join(testDir, `no-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);

    try {
      await configureAiCommand();
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("not initialized");
  });

  it("should show configuration header", async () => {
    await configureAiCommand();

    expect(output).toContain("FlowTask AI Provider Configuration");
  });

  it("should show skip message when no providers selected", async () => {
    await configureAiCommand();

    expect(output).toContain("No providers selected");
  });

  it("should detect available API keys from environment without errors", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-test-key";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    try {
      await configureAiCommand();
      expect(output).toContain("FlowTask AI Provider Configuration");
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("should not persist raw API keys in config file after setup", async () => {
    const config = await readJsonFile<Record<string, unknown>>(configJsonPath(projectDir));
    const configStr = JSON.stringify(config);
    expect(configStr).not.toContain("sk-");
    expect(configStr).not.toContain("api-key");
  });
});
