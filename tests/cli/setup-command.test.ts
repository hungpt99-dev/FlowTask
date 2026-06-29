import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { setupAiCommand } from "../../src/cli/commands/setup.command.js";
import { readJsonFile } from "../../src/utils/fs.js";
import { configJsonPath } from "../../src/utils/paths.js";
import { ProjectManager } from "../../src/core/project-manager.js";
import { resetSecretStore } from "../../src/config/secret-store.js";

describe("setupAiCommand", () => {
  let projectDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    projectDir = join(testDir, `setup-cmd-test-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
    const manager = new ProjectManager();
    await manager.init(projectDir, "Test Project");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    resetSecretStore();
  });

  it("should configure OpenAI non-interactively", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key-12345";
    try {
      await setupAiCommand({ provider: "openai", apiKeyEnv: "OPENAI_API_KEY" });

      const config = await readJsonFile<Record<string, unknown>>(configJsonPath(projectDir));
      const planner = config.planner as Record<string, unknown>;
      expect(planner.provider).toBe("openai");

      const ai = config.ai as Record<string, unknown>;
      const providers = ai.providers as Record<string, Record<string, unknown>>;
      expect(providers.openai).toBeDefined();
      expect(providers.openai!.type).toBe("openai");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("should error for unknown provider", async () => {
    let exitCode: number | null = null;
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
    }) as typeof process.exit;

    try {
      await setupAiCommand({ provider: "nonexistent" });
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });

  it("should work with provider that has allowNoApiKey (ollama)", async () => {
    await setupAiCommand({ provider: "ollama" });

    const config = await readJsonFile<Record<string, unknown>>(configJsonPath(projectDir));
    const planner = config.planner as Record<string, unknown>;
    expect(planner.provider).toBe("ollama");
    expect((config.ai as Record<string, unknown>).providers).toBeDefined();
  });

  it("should not store raw API key in config", async () => {
    process.env.OPENAI_API_KEY = "sk-secret";
    try {
      await setupAiCommand({ provider: "openai", apiKeyEnv: "OPENAI_API_KEY" });

      const config = await readJsonFile<Record<string, unknown>>(configJsonPath(projectDir));
      const configStr = JSON.stringify(config);
      expect(configStr).not.toContain("sk-secret");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("should use env var when available", async () => {
    process.env.OPENAI_API_KEY = "sk-env-key";
    try {
      await setupAiCommand({ provider: "openai", apiKeyEnv: "OPENAI_API_KEY" });

      const config = await readJsonFile<Record<string, unknown>>(configJsonPath(projectDir));
      const providers = (config.ai as Record<string, unknown>).providers as Record<
        string,
        Record<string, unknown>
      >;
      expect(providers.openai).toBeDefined();
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
