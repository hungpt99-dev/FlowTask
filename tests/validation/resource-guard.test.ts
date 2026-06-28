import { describe, it, expect } from "vitest";
import { ResourceGuard } from "../../src/validation/resource-guard.js";
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

describe("ResourceGuard", () => {
  it("should warn about vitest command without worker limit", () => {
    const config = createConfig();
    const guard = new ResourceGuard(config);
    const warnings = guard.inspect("pnpm vitest run");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.severity === "warning")).toBe(true);
    expect(warnings.some((w) => w.message.includes("worker limit"))).toBe(true);
  });

  it("should not warn about vitest with worker limit", () => {
    const config = createConfig();
    const guard = new ResourceGuard(config);
    const warnings = guard.inspect("pnpm vitest run --maxWorkers=1");
    const vitestWarnings = warnings.filter(
      (w) => w.message.includes("vitest") || w.message.includes("Vitest"),
    );
    expect(vitestWarnings.length).toBe(0);
  });

  it("should not warn when profile=full", () => {
    const config = createConfig({
      validation: {
        profile: "full",
        adaptiveValidation: true,
        concurrency: 1,
        timeoutMs: 300000,
        killGraceMs: 5000,
        dedupeCommands: true,
        resourceGuard: true,
        commands: [],
        vitest: { enabled: true, maxWorkers: 1, runMode: true },
      },
    });
    const guard = new ResourceGuard(config);
    const warnings = guard.inspect("pnpm vitest run");
    const vitestWarnings = warnings.filter((w) => w.message.includes("worker limit"));
    expect(vitestWarnings.length).toBe(0);
  });

  it("should return safe command with worker limit for vitest", () => {
    const config = createConfig();
    const guard = new ResourceGuard(config);
    const safe = guard.getSafeCommand("pnpm vitest run");
    expect(safe).toContain("maxWorkers=1");
  });

  it("should not modify non-vitest commands", () => {
    const config = createConfig();
    const guard = new ResourceGuard(config);
    const safe = guard.getSafeCommand("pnpm test");
    expect(safe).toBe("pnpm test");
  });

  it("should not modify command when profile=full", () => {
    const config = createConfig({
      validation: {
        profile: "full",
        adaptiveValidation: true,
        concurrency: 1,
        timeoutMs: 300000,
        killGraceMs: 5000,
        dedupeCommands: true,
        resourceGuard: true,
        commands: [],
        vitest: { enabled: true, maxWorkers: 1, runMode: true },
      },
    });
    const guard = new ResourceGuard(config);
    const safe = guard.getSafeCommand("pnpm vitest run");
    expect(safe).toBe("pnpm vitest run");
  });

  it("should not modify command that already has worker limit", () => {
    const config = createConfig();
    const guard = new ResourceGuard(config);
    const safe = guard.getSafeCommand("pnpm vitest run --maxWorkers=2");
    expect(safe).toBe("pnpm vitest run --maxWorkers=2");
  });

  it("should detect heavy commands", () => {
    const config = createConfig();
    const guard = new ResourceGuard(config);
    expect(guard.isHeavy("pnpm vitest")).toBe(true);
    expect(guard.isHeavy("pnpm jest")).toBe(true);
    expect(guard.isHeavy("pnpm playwright")).toBe(true);
    expect(guard.isHeavy("pnpm cypress")).toBe(true);
    expect(guard.isHeavy("pnpm lint")).toBe(false);
    expect(guard.isHeavy("pnpm typecheck")).toBe(false);
  });

  it("should detect vitest in test:e2e commands", () => {
    const config = createConfig();
    const guard = new ResourceGuard(config);
    expect(guard.isHeavy("pnpm test:e2e")).toBe(true);
    expect(guard.isHeavy("pnpm test:integration")).toBe(true);
  });

  it("should not return warnings for non-vitest commands", () => {
    const config = createConfig();
    const guard = new ResourceGuard(config);
    const warnings = guard.inspect("pnpm lint");
    expect(warnings.length).toBe(0);
  });
});
