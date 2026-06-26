import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { ApiKeyValidator } from "../../src/ai/api-key-validator.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

const SAVED_ENV: Record<string, string | undefined> = {};
const TEST_ENV_KEYS = new Set<string>();

function createConfig(overrides?: Partial<FlowTaskConfig>): FlowTaskConfig {
  return {
    version: "1.0",
    defaultExecutor: "shell",
    runsDir: ".flowtask/runs",
    logLevel: "info",
    autoResume: true,
    rules: { enabled: true, paths: [], required: false, maxFileSizeKb: 256 },
    approval: { enabled: true, requireFor: [] },
    quality: { enabledByDefault: false, commands: [] },
    limits: { maxRunMinutes: 120, maxTaskMinutes: 30, maxRetries: 2, maxLogSizeMb: 20 },
    projectMode: "development",
    process: { gracefulStopTimeoutMs: 5000, forceKillTimeoutMs: 10000 },
    validation: {
      profile: "safe",
      concurrency: 1,
      timeoutMs: 300000,
      killGraceMs: 5000,
      dedupeCommands: true,
      resourceGuard: true,
      commands: [],
      vitest: { enabled: true, maxWorkers: 1, runMode: true },
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
    executors: {},
    ...overrides,
  };
}

describe("ApiKeyValidator", () => {
  beforeAll(() => {
    process.env.FLOWTASK_SECRETS_PATH = "/tmp/flowtask-test-secrets-nonexistent.json";
  });

  beforeEach(() => {
    TEST_ENV_KEYS.clear();
  });

  afterEach(() => {
    for (const key of TEST_ENV_KEYS) {
      if (SAVED_ENV[key] !== undefined) {
        process.env[key] = SAVED_ENV[key];
      } else {
        delete process.env[key];
      }
    }
  });

  afterAll(() => {
    delete process.env.FLOWTASK_SECRETS_PATH;
  });

  function clearEnv(key: string): void {
    SAVED_ENV[key] = process.env[key];
    delete process.env[key];
    TEST_ENV_KEYS.add(key);
  }

  function setEnv(key: string, value: string): void {
    SAVED_ENV[key] = process.env[key];
    process.env[key] = value;
    TEST_ENV_KEYS.add(key);
  }

  it("detects missing API key for default openai provider", () => {
    clearEnv("OPENAI_API_KEY");
    const config = createConfig();
    const validator = new ApiKeyValidator(config);
    const result = validator.validateDefaultProvider();
    expect(result.valid).toBe(false);
    expect(result.provider).toBe("openai");
    expect(result.needsApiKey).toBe(true);
    expect(result.apiKeyAvailable).toBe(false);
    expect(result.apiKeyEnv).toBe("OPENAI_API_KEY");
    expect(result.suggestion).toContain("OPENAI_API_KEY");
  });

  it("detects present API key for openai provider", () => {
    clearEnv("OPENAI_API_KEY");
    setEnv("OPENAI_API_KEY", "sk-test-key");
    const config = createConfig();
    const validator = new ApiKeyValidator(config);
    const result = validator.validateDefaultProvider();
    expect(result.valid).toBe(true);
    expect(result.apiKeyAvailable).toBe(true);
  });

  it("reports all providers with validateAll", () => {
    clearEnv("OPENAI_API_KEY");
    setEnv("OPENAI_API_KEY", "sk-test");
    const config = createConfig();
    const validator = new ApiKeyValidator(config);
    const results = validator.validateAll();
    expect(results.length).toBeGreaterThan(0);

    const openai = results.find((r) => r.provider === "openai");
    expect(openai).toBeDefined();
    expect(openai!.valid).toBe(true);

    const ollama = results.find((r) => r.provider === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama!.valid).toBe(true);
    expect(ollama!.needsApiKey).toBe(false);
  });

  it("reports ollama as needing no API key", () => {
    const config = createConfig({
      ai: {
        providers: {
          ollama: { type: "ollama", baseUrl: "http://localhost:11434", allowNoApiKey: true },
        },
      },
    });
    const validator = new ApiKeyValidator(config);
    const result = validator.validateProvider("ollama");
    expect(result.valid).toBe(true);
    expect(result.needsApiKey).toBe(false);
  });

  it("detects configured but missing key for a custom provider", () => {
    const config = createConfig({
      planner: {
        default: "auto",
        type: "internal-ai",
        executor: "shell",
        provider: "my-provider",
        model: "gpt-4",
        maxRetries: 1,
        fallbackToSimple: true,
      },
      ai: {
        providers: {
          "my-provider": {
            type: "openai-compatible",
            apiKeyEnv: "MY_API_KEY",
            baseUrl: "http://localhost",
          },
        },
      },
    });
    const validator = new ApiKeyValidator(config);
    const result = validator.validateDefaultProvider();
    expect(result.valid).toBe(false);
    expect(result.provider).toBe("my-provider");
    expect(result.apiKeyEnv).toBe("MY_API_KEY");
    expect(result.apiKeyAvailable).toBe(false);
  });

  it("returns unconfigured result for missing provider", () => {
    const config = createConfig({
      planner: {
        default: "auto",
        type: "internal-ai",
        executor: "shell",
        provider: "nonexistent",
        model: "gpt-4",
        maxRetries: 1,
        fallbackToSimple: true,
      },
    });
    const validator = new ApiKeyValidator(config);
    const result = validator.validateDefaultProvider();
    expect(result.valid).toBe(false);
    expect(result.message).toContain("not configured");
  });

  it("summarize returns valid=true when no errors", () => {
    const validator = new ApiKeyValidator(createConfig());
    const results = [
      {
        provider: "p1",
        type: "openai",
        needsApiKey: true,
        apiKeyAvailable: true,
        apiKeyEnv: "KEY1",
        valid: true,
        message: "ok",
      },
      {
        provider: "p2",
        type: "ollama",
        needsApiKey: false,
        apiKeyAvailable: true,
        valid: true,
        message: "ok",
      },
    ];
    const summary = validator.summarize(results);
    expect(summary.valid).toBe(true);
    expect(summary.errors).toHaveLength(0);
  });

  it("summarize returns valid=false with errors", () => {
    const validator = new ApiKeyValidator(createConfig());
    const results = [
      {
        provider: "p1",
        type: "openai",
        needsApiKey: true,
        apiKeyAvailable: true,
        apiKeyEnv: "KEY1",
        valid: true,
        message: "ok",
      },
      {
        provider: "p2",
        type: "anthropic",
        needsApiKey: true,
        apiKeyAvailable: false,
        apiKeyEnv: "KEY2",
        valid: false,
        message: "missing key",
        suggestion: "set KEY2",
      },
    ];
    const summary = validator.summarize(results);
    expect(summary.valid).toBe(false);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]!.provider).toBe("p2");
  });

  it("validateProvider returns result for a specific provider", () => {
    clearEnv("OPENAI_API_KEY");
    setEnv("OPENAI_API_KEY", "sk-test");
    const config = createConfig();
    const validator = new ApiKeyValidator(config);
    const result = validator.validateProvider("openai");
    expect(result.valid).toBe(true);
    expect(result.provider).toBe("openai");
  });

  it("validateProvider returns error for unknown provider", () => {
    clearEnv("OPENAI_API_KEY");
    const config = createConfig();
    const validator = new ApiKeyValidator(config);
    const result = validator.validateProvider("not-configured");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("not configured");
  });

  it("respects custom apiKeyEnv in provider config", () => {
    clearEnv("OPENAI_API_KEY");
    clearEnv("CUSTOM_OPENAI_KEY");
    setEnv("CUSTOM_OPENAI_KEY", "sk-test");
    const config = createConfig({
      ai: {
        providers: {
          openai: { type: "openai", apiKeyEnv: "CUSTOM_OPENAI_KEY" },
        },
      },
    });
    const validator = new ApiKeyValidator(config);
    const result = validator.validateDefaultProvider();
    expect(result.valid).toBe(true);
    expect(result.apiKeyEnv).toBe("CUSTOM_OPENAI_KEY");
  });
});
