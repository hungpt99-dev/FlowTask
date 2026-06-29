import { describe, it, expect, beforeEach } from "vitest";
import { ProviderRegistry } from "../../src/ai/provider-registry.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

function createConfig(overrides?: Partial<FlowTaskConfig>): FlowTaskConfig {
  return {
    version: "1.0",
    defaultExecutor: "shell",
    runsDir: ".flowtask/runs",
    logLevel: "info",
    autoResume: true,
    rules: { enabled: true, paths: [], required: false, maxFileSizeKb: 256 },
    approval: { enabled: true, autoApprove: false, requireFor: [] },
    quality: { enabledByDefault: false, commands: [] },
    limits: { maxRunMinutes: 120, maxTaskMinutes: 30, maxRetries: 2, maxLogSizeMb: 20 },
    projectMode: "development",
    process: { gracefulStopTimeoutMs: 5000, forceKillTimeoutMs: 10000 },
    validation: {
      profile: "safe",
      adaptiveValidation: true,
      concurrency: 1,
      timeoutMs: 300000,
      killGraceMs: 5000,
      dedupeCommands: true,
      resourceGuard: true,
      commands: [],
      vitest: { enabled: true, maxWorkers: 1, runMode: true },
      aiValidation: "fallback",
    },
    logging: { maxInMemoryLines: 500, maxLineLength: 4000 },
    planner: {
      default: "auto",
      type: "internal-ai",
      executor: "shell",
      provider: "openai",
      model: "gpt-4.1-mini",
      maxRetries: 1,
      fallbackToSimple: true,
    },
    ai: { providers: {} },
    useCase: { enabled: true, customPatterns: [], confidenceThreshold: 0.3 },
    hooks: {
      beforeRun: [],
      afterRun: [],
      beforeTask: [],
      afterTask: [],
      beforeRetry: [],
      afterRetry: [],
      onFailure: [],
      failOnError: false,
    },
    executors: {},
    ...overrides,
  };
}

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;
  let config: FlowTaskConfig;

  beforeEach(() => {
    config = createConfig();
    registry = new ProviderRegistry(config);
  });

  it("registers built-in provider types", () => {
    const providers = registry.listProviders();
    expect(providers.length).toBeGreaterThan(0);
    const names = providers.map((p) => p.name);
    expect(names).toContain("openai");
    expect(names).toContain("anthropic");
    expect(names).toContain("gemini");
    expect(names).toContain("ollama");
    expect(names).toContain("mistral");
    expect(names).toContain("azure-openai");
  });

  it("resolves openai provider", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const provider = registry.getProvider("openai");
    expect(provider.name).toBe("openai");
    expect(provider.type).toBe("openai");
    expect(provider.supportsJsonObject).toBe(true);
    expect(provider.supportsStreaming).toBe(true);
    delete process.env.OPENAI_API_KEY;
  });

  it("resolves anthropic provider type", () => {
    config.ai = {
      providers: {
        anthropic: {
          type: "anthropic",
          apiKeyEnv: "ANTHROPIC_API_KEY",
          baseUrl: "https://api.anthropic.com",
        },
      },
    };
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const reg = new ProviderRegistry(config);
    const provider = reg.getProvider("anthropic");
    expect(provider.name).toBe("anthropic");
    expect(provider.type).toBe("anthropic");
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("resolves gemini provider type", () => {
    config.ai = {
      providers: {
        gemini: {
          type: "gemini",
          apiKeyEnv: "GEMINI_API_KEY",
          baseUrl: "https://generativelanguage.googleapis.com",
        },
      },
    };
    process.env.GEMINI_API_KEY = "test-key";
    const reg = new ProviderRegistry(config);
    const provider = reg.getProvider("gemini");
    expect(provider.name).toBe("gemini");
    expect(provider.type).toBe("gemini");
    delete process.env.GEMINI_API_KEY;
  });

  it("resolves ollama provider (no API key needed)", () => {
    config.ai = {
      providers: {
        ollama: {
          type: "ollama",
          baseUrl: "http://localhost:11434",
          allowNoApiKey: true,
        },
      },
    };
    const reg = new ProviderRegistry(config);
    const provider = reg.getProvider("ollama");
    expect(provider.name).toBe("ollama");
    expect(provider.type).toBe("ollama");
  });

  it("resolves openai-compatible provider", () => {
    config.ai = {
      providers: {
        deepseek: {
          type: "openai-compatible",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          baseUrl: "https://api.deepseek.com/v1",
        },
      },
    };
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const reg = new ProviderRegistry(config);
    const provider = reg.getProvider("deepseek");
    expect(provider.name).toBe("deepseek");
    expect(provider.type).toBe("openai-compatible");
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("supports registerProviderType", () => {
    registry.registerProviderType("custom-test", (resolved) => ({
      name: resolved.name,
      type: "custom-test",
      supportsJsonObject: false,
      supportsStreaming: false,
      generate: async () => ({ text: "custom" }),
    }));

    registry.registerProvider("my-custom", { type: "custom-test" });

    const provider = registry.getProvider("my-custom");
    expect(provider.name).toBe("my-custom");
    expect(provider.type).toBe("custom-test");
  });

  it("supports registerProvider", () => {
    registry.registerProvider("company-ai", {
      type: "openai-compatible",
      apiKeyEnv: "COMPANY_AI_KEY",
      baseUrl: "https://ai.company.com/v1",
    });
    process.env.COMPANY_AI_KEY = "sk-test";
    const provider = registry.getProvider("company-ai");
    expect(provider.name).toBe("company-ai");
    delete process.env.COMPANY_AI_KEY;
  });

  it("rejects unknown provider type", () => {
    registry.registerProvider("unknown", { type: "nonexistent" });
    expect(() => registry.getProvider("unknown")).toThrow();
  });

  it("merges presets and user config", () => {
    config.ai = {
      providers: {
        openai: {
          type: "openai",
          apiKeyEnv: "CUSTOM_OPENAI_KEY",
        },
      },
    };
    process.env.CUSTOM_OPENAI_KEY = "sk-custom";
    const reg = new ProviderRegistry(config);
    const provider = reg.getProvider("openai");
    expect(provider.name).toBe("openai");
    delete process.env.CUSTOM_OPENAI_KEY;
  });
});
