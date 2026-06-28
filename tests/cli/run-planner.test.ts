import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { selectPlanner } from "../../src/cli/commands/run-planner.js";
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

describe("selectPlanner", () => {
  let output: string;

  beforeEach(() => {
    output = "";
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("should return simple planner when simple mode explicitly requested", () => {
    const config = createConfig();
    const result = selectPlanner(config, "simple");

    expect(result.plannerMode).toBe("simple");
    expect(result.plannerType).toBe("internal-ai");
    expect(output).toContain("Using simple planner");
  });

  it("should show AI planner mode when explicit ai mode requested even without provider", () => {
    const config = createConfig({
      planner: {
        default: "ai",
        type: "internal-ai",
        executor: "shell",
        provider: "openai",
        model: "gpt-4.1-mini",
        maxRetries: 1,
        fallbackToSimple: true,
      },
      ai: { providers: {} },
    });
    const result = selectPlanner(config, "ai");

    expect(result.plannerMode).toBe("ai");
    expect(output).toContain("internal AI planner");
  });

  it("should show API key missing message in auto mode without provider", () => {
    const config = createConfig({
      ai: { providers: {} },
    });
    const result = selectPlanner(config, "auto");

    expect(result.plannerMode).toBe("auto");
    expect(output).toContain("API key missing");
    expect(output).toContain("Using simple planner");
  });

  it("should use AI planner in auto mode when provider and API key are configured", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const config = createConfig({
      ai: {
        providers: {
          openai: {
            type: "openai",
            apiKeyEnv: "OPENAI_API_KEY",
          },
        },
      },
    });
    const result = selectPlanner(config, "auto");

    expect(result.plannerMode).toBe("auto");
    expect(output).toContain("internal AI planner");
    expect(output).toContain("openai");
  });

  it("should use AI planner when AI mode with valid config", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const config = createConfig({
      planner: {
        default: "ai",
        type: "internal-ai",
        executor: "shell",
        provider: "openai",
        model: "gpt-4.1-mini",
        maxRetries: 1,
        fallbackToSimple: true,
      },
      ai: {
        providers: {
          openai: {
            type: "openai",
            apiKeyEnv: "OPENAI_API_KEY",
          },
        },
      },
    });
    const result = selectPlanner(config, "ai");

    expect(result.plannerMode).toBe("ai");
    expect(output).toContain("internal AI planner");
    expect(output).toContain("openai");
    expect(output).toContain("gpt-4.1-mini");
  });

  it("should use AI planner with custom provider and model", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const config = createConfig({
      planner: {
        default: "auto",
        type: "internal-ai",
        executor: "shell",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        maxRetries: 1,
        fallbackToSimple: true,
      },
      ai: {
        providers: {
          anthropic: {
            type: "anthropic",
            apiKeyEnv: "ANTHROPIC_API_KEY",
          },
        },
      },
    });
    const result = selectPlanner(config, "ai");

    expect(result.plannerMode).toBe("ai");
    expect(output).toContain("anthropic");
    expect(output).toContain("claude-sonnet-4-20250514");
  });

  it("should use external AI planner when configured", () => {
    const config = createConfig({
      planner: {
        default: "ai",
        type: "external-ai",
        executor: "opencode",
        provider: "openai",
        model: "gpt-4.1-mini",
        maxRetries: 1,
        fallbackToSimple: true,
      },
      executors: {
        opencode: { type: "shell", inputMode: "argument", timeoutMs: 300000, args: [] },
      },
    });
    const result = selectPlanner(config, "ai");

    expect(result.plannerMode).toBe("ai");
    expect(result.plannerType).toBe("external-ai");
    expect(output).toContain("external AI planner");
  });

  it("should return planner mode from config default when no arg given", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const config = createConfig({
      planner: {
        default: "ai",
        type: "internal-ai",
        executor: "shell",
        provider: "openai",
        model: "gpt-4.1-mini",
        maxRetries: 1,
        fallbackToSimple: true,
      },
      ai: {
        providers: {
          openai: {
            type: "openai",
            apiKeyEnv: "OPENAI_API_KEY",
          },
        },
      },
    });
    const result = selectPlanner(config);

    expect(result.plannerMode).toBe("ai");
    expect(output).toContain("internal AI planner");
  });

  it("should fall back to simple when config default is auto with no API key", () => {
    const config = createConfig({
      ai: { providers: {} },
    });
    const result = selectPlanner(config);

    expect(result.plannerMode).toBe("auto");
    expect(output).toContain("falling back to simple planner");
  });

  it("should handle non-standard planner type gracefully", () => {
    const config = createConfig({
      planner: {
        default: "simple",
        type: "internal-ai",
        executor: "shell",
        provider: "openai",
        model: "gpt-4.1-mini",
        maxRetries: 1,
        fallbackToSimple: true,
      },
    });
    const result = selectPlanner(config, "simple");

    expect(result.plannerMode).toBe("simple");
    expect(output).toContain("Using simple planner");
  });

  it("should not show internal-ai detail when planner type is external-ai in auto mode", () => {
    const config = createConfig({
      planner: {
        default: "auto",
        type: "external-ai",
        executor: "opencode",
        provider: "openai",
        model: "gpt-4.1-mini",
        maxRetries: 1,
        fallbackToSimple: true,
      },
      ai: { providers: {} },
    });
    selectPlanner(config, "auto");

    expect(output).not.toContain("internal AI planner");
    expect(output).toContain("Using simple planner");
  });
});
