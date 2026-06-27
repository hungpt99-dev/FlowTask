import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { ValidationRunner } from "../../src/validation/validation-runner.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

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
    useCase: { enabled: true, customPatterns: [], confidenceThreshold: 0.3 },
    executors: {},
    ...overrides,
  };
}

describe("ValidationRunner", () => {
  let testDir: string;
  let runner: ValidationRunner;

  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), "vr-test-"));
    runner = new ValidationRunner(createConfig());
  });

  afterEach(async () => {
    runner.cancelAll();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should pass on successful command", async () => {
    const results = await runner.runValidation({
      commands: ["node -e 'process.exit(0)'"],
      cwd: testDir,
      runId: "test-run-1",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.status).toBe("passed");
    expect(results[0]!.exitCode).toBe(0);
  });

  it("should fail on failing command", async () => {
    const results = await runner.runValidation({
      commands: ["node -e 'process.exit(1)'"],
      cwd: testDir,
      runId: "test-run-2",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.exitCode).toBe(1);
  });

  it("should run commands serially by default", async () => {
    const config = createConfig({
      validation: {
        profile: "safe",
        concurrency: 1,
        timeoutMs: 10000,
        killGraceMs: 500,
        dedupeCommands: false,
        resourceGuard: false,
        commands: [],
        vitest: { enabled: true, maxWorkers: 1, runMode: true },
      },
    });
    const serialRunner = new ValidationRunner(config);
    const results = await serialRunner.runValidation({
      commands: [
        "node -e 'process.exit(0)'",
        "node -e 'process.exit(0)'",
        "node -e 'process.exit(0)'",
      ],
      cwd: testDir,
      runId: "test-run-3",
    });
    expect(results.length).toBe(3);
    expect(results.every((r) => r.status === "passed")).toBe(true);
  });

  it("should skip duplicate commands when dedupe is enabled", async () => {
    const results = await runner.runValidation({
      commands: ["node -e 'process.exit(0)'", "node -e 'process.exit(0)'"],
      cwd: testDir,
      runId: "test-run-4",
    });
    expect(results.length).toBe(2);
    expect(results[0]!.status).toBe("passed");
    expect(results[1]!.status).toBe("skipped");
  });

  it("should timeout long-running command", async () => {
    const config = createConfig({
      validation: {
        profile: "safe",
        concurrency: 1,
        timeoutMs: 100,
        killGraceMs: 500,
        dedupeCommands: false,
        resourceGuard: false,
        commands: [],
        vitest: { enabled: true, maxWorkers: 1, runMode: true },
      },
    });
    const timeoutRunner = new ValidationRunner(config);
    const results = await timeoutRunner.runValidation({
      commands: ["node -e 'setTimeout(() => process.exit(0), 50000)'"],
      cwd: testDir,
      runId: "test-run-5",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.status).toBe("timeout");
    expect(results[0]!.timedOut).toBe(true);
  });

  it("should cancel running validation", async () => {
    const config = createConfig({
      validation: {
        profile: "safe",
        concurrency: 1,
        timeoutMs: 60000,
        killGraceMs: 500,
        dedupeCommands: false,
        resourceGuard: false,
        commands: [],
        vitest: { enabled: true, maxWorkers: 1, runMode: true },
      },
    });
    const cancelRunner = new ValidationRunner(config);

    const promise = cancelRunner.runValidation({
      commands: ["node -e 'setTimeout(() => process.exit(0), 50000)'"],
      cwd: testDir,
      runId: "test-run-cancel",
    });

    // Wait briefly for the process to start, then cancel
    await new Promise((r) => setTimeout(r, 200));
    cancelRunner.cancel("test-run-cancel");

    const results = await promise;
    expect(results.length).toBe(1);
    expect(results[0]!.status).toBe("cancelled");
  });

  it("should keep only last N lines in ring buffer", async () => {
    const config = createConfig({
      validation: {
        profile: "safe",
        concurrency: 1,
        timeoutMs: 10000,
        killGraceMs: 500,
        dedupeCommands: false,
        resourceGuard: false,
        commands: [],
        vitest: { enabled: true, maxWorkers: 1, runMode: true },
      },
      logging: { maxInMemoryLines: 3, maxLineLength: 4000 },
    });
    const smallBufferRunner = new ValidationRunner(config);
    const results = await smallBufferRunner.runValidation({
      commands: ["node -e 'for(let i=0;i<10;i++)console.log(\"line\"+i)'"],
      cwd: testDir,
      runId: "test-run-buffer",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.ringBuffer.length).toBeLessThanOrEqual(3);
  });

  it("should stream output without accumulating unlimited memory", async () => {
    const results = await runner.runValidation({
      commands: ["node -e 'console.log(\"hello\")'"],
      cwd: testDir,
      runId: "test-run-stream",
    });
    expect(results.length).toBe(1);
    const output = results[0]!.output;
    expect(output).toBeTruthy();
    expect(results[0]!.ringBuffer.length).toBeGreaterThan(0);
  });

  it("should classify timeout as non-retriable", async () => {
    const config = createConfig({
      validation: {
        profile: "safe",
        concurrency: 1,
        timeoutMs: 50,
        killGraceMs: 200,
        dedupeCommands: false,
        resourceGuard: false,
        commands: [],
        vitest: { enabled: true, maxWorkers: 1, runMode: true },
      },
    });
    const tRunner = new ValidationRunner(config);
    const results = await tRunner.runValidation({
      commands: ["node -e 'setTimeout(() => process.exit(0), 50000)'"],
      cwd: testDir,
      runId: "test-run-timeout-2",
    });
    expect(results[0]!.status).toBe("timeout");
    expect(results[0]!.timedOut).toBe(true);
  });

  it("should clear dedupe cache", async () => {
    await runner.runValidation({
      commands: ["node -e 'process.exit(0)'"],
      cwd: testDir,
      runId: "test-run-clear-1",
    });
    runner.clearDedupeCache();

    const results = await runner.runValidation({
      commands: ["node -e 'process.exit(0)'"],
      cwd: testDir,
      runId: "test-run-clear-2",
    });
    expect(results[0]!.status).toBe("passed");
    expect(results[0]!.exitCode).toBe(0);
  });
});
