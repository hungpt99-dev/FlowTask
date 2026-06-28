import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { CommandValidator } from "../../src/validation/command-validator.js";
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

describe("CommandValidator", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), "cv-test-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should pass for successful command", async () => {
    const validator = new CommandValidator(createConfig());
    const checks = await validator.validateCommands(["node -e 'process.exit(0)'"], testDir);
    expect(checks.length).toBe(1);
    expect(checks[0]!.status).toBe("passed");
  });

  it("should fail for failing command", async () => {
    const validator = new CommandValidator(createConfig());
    const checks = await validator.validateCommands(["node -e 'process.exit(1)'"], testDir);
    expect(checks.length).toBe(1);
    expect(checks[0]!.status).toBe("failed");
  });

  it("should return empty for no commands", async () => {
    const validator = new CommandValidator(createConfig());
    const checks = await validator.validateCommands([], testDir);
    expect(checks.length).toBe(0);
  });

  it("should skip duplicate commands", async () => {
    const validator = new CommandValidator(createConfig());
    const checks = await validator.validateCommands(
      ["node -e 'process.exit(0)'", "node -e 'process.exit(0)'"],
      testDir,
    );
    expect(checks.length).toBe(2);
    expect(checks[0]!.status).toBe("passed");
    expect(checks[1]!.status).toBe("skipped");
  });

  it("should work without config (use defaults)", async () => {
    const validator = new CommandValidator();
    const checks = await validator.validateCommands(["node -e 'process.exit(0)'"], testDir);
    expect(checks.length).toBe(1);
    expect(checks[0]!.status).toBe("passed");
  });
});
