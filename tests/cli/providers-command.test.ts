import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { ProjectManager } from "../../src/core/project-manager.js";
import {
  listProvidersCommand,
  currentProviderCommand,
  testProviderCommand,
  removeProviderCommand,
  configureProviderCommand,
} from "../../src/cli/commands/providers.command.js";
import { resetSecretStore } from "../../src/config/secret-store.js";

describe("providers commands", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `providers-cmd-${Date.now()}`);
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
    await manager.init(projectDir, "ProvidersTest");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
    resetSecretStore();
  });

  describe("listProvidersCommand", () => {
    it("should list default providers when none configured", async () => {
      await listProvidersCommand();

      expect(output).toContain("Configured AI Providers");
      expect(output).toContain("openai");
      expect(output).toContain("ollama");
    });

    it("should show key status for configured providers", async () => {
      const { setupAiCommand } = await import("../../src/cli/commands/setup.command.js");
      process.env.OPENAI_API_KEY = "sk-test-key";
      await setupAiCommand({ provider: "openai", apiKeyEnv: "OPENAI_API_KEY" });

      output = "";
      await listProvidersCommand();

      expect(output).toContain("openai");
      expect(output).toContain("key found");
      delete process.env.OPENAI_API_KEY;
    });
  });

  describe("currentProviderCommand", () => {
    it("should show default provider when none configured", async () => {
      await currentProviderCommand();

      expect(output).toContain("Current AI Provider");
      expect(output).toContain("No provider configured");
      expect(output).toContain("setup ai");
    });

    it("should show provider details when configured", async () => {
      const { setupAiCommand } = await import("../../src/cli/commands/setup.command.js");
      process.env.OPENAI_API_KEY = "sk-test-key-2";
      await setupAiCommand({ provider: "openai", apiKeyEnv: "OPENAI_API_KEY" });

      output = "";
      await currentProviderCommand();

      expect(output).toContain("openai");
      expect(output).toContain("available");
      delete process.env.OPENAI_API_KEY;
    });
  });

  describe("testProviderCommand", () => {
    it("should show test result", { timeout: 15000 }, async () => {
      await testProviderCommand();

      expect(output).toContain("Testing AI Provider");
    });
  });

  describe("removeProviderCommand", () => {
    it("should remove a provider", async () => {
      const { setupAiCommand } = await import("../../src/cli/commands/setup.command.js");
      process.env.OPENAI_API_KEY = "sk-to-remove";
      await setupAiCommand({ provider: "openai", apiKeyEnv: "OPENAI_API_KEY" });

      output = "";
      await removeProviderCommand("openai");

      expect(output).toContain("Provider");
      expect(output).toContain("removed");
      delete process.env.OPENAI_API_KEY;
    });

    it("should not error when removing non-existent provider", async () => {
      await removeProviderCommand("nonexistent");

      expect(output).toContain("removed");
    });
  });

  describe("configureProviderCommand", () => {
    it("should be a function that delegates to setup ai", () => {
      expect(typeof configureProviderCommand).toBe("function");
      expect(configureProviderCommand.name).toBe("configureProviderCommand");
    });
  });
});
