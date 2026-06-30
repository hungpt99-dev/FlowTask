import { describe, it, expect, beforeAll } from "vitest";
import { LogManager } from "../../src/core/log-manager.js";
import { testDir } from "../setup.js";

describe("LogManager", () => {
  let manager: LogManager;
  const runId = "log-test-run";

  beforeAll(() => {
    manager = new LogManager(testDir);
  });

  it("should write and read runtime logs", async () => {
    await manager.writeRuntime(runId, "Runtime started");
    await manager.flush();
    const content = await manager.readRuntime(runId);
    expect(content).toContain("Runtime started");
  });

  it("should write and read task logs", async () => {
    await manager.writeTaskLog(runId, "task_001", "Task running");
    await manager.flush();
    const content = await manager.readTaskLog(runId, "task_001");
    expect(content).toContain("Task running");
  });

  it("should write and read validation logs", async () => {
    await manager.writeValidation(runId, "Validation passed");
    await manager.flush();
    const content = await manager.readValidation(runId);
    expect(content).toContain("Validation passed");
  });

  it("should list log files", async () => {
    await manager.flush();
    const files = await manager.listLogFiles(runId);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("should redact secrets from log output", async () => {
    await manager.writeTaskLog(runId, "task_002", "API_KEY=super-secret-key-value");
    await manager.flush();
    const content = await manager.readTaskLog(runId, "task_002");
    expect(content).toContain("API_KEY=****");
    expect(content).not.toContain("super-secret-key-value");
  });

  it("should write startup info to runtime and jsonl logs", async () => {
    await manager.writeStartup(runId, {
      nodeVersion: "v22.0.0",
      projectMode: "development",
      configStatus: "loaded",
      planner: "internal-ai (openai)",
      executorCount: 3,
    });
    await manager.flush();

    const runtimeContent = await manager.readRuntime(runId);
    expect(runtimeContent).toContain("FlowTask startup");
    expect(runtimeContent).toContain("v22.0.0");
    expect(runtimeContent).toContain("development");
    expect(runtimeContent).toContain("internal-ai (openai)");
    expect(runtimeContent).toContain("Executors: 3");
  });

  it("should write AI connectivity results to logs", async () => {
    await manager.writeAiConnectivity(runId, [
      { provider: "openai", ok: true, message: "OK", latencyMs: 150 },
      { provider: "anthropic", ok: false, message: "API key not set" },
    ]);
    await manager.flush();

    const runtimeContent = await manager.readRuntime(runId);
    expect(runtimeContent).toContain("AI providers: 1 ok, 1 failed");
    expect(runtimeContent).toContain("anthropic");
  });

  it("should write health check results to runtime logs", async () => {
    await manager.writeHealthCheck(runId, {
      overall: "degraded",
      healthy: 5,
      degraded: 2,
      failing: 0,
      total: 7,
    });
    await manager.flush();

    const runtimeContent = await manager.readRuntime(runId);
    expect(runtimeContent).toContain("Health check: DEGRADED");
    expect(runtimeContent).toContain("5 healthy");
    expect(runtimeContent).toContain("2 degraded");
  });

  it("should write errors to runtime logs", async () => {
    await manager.writeError(runId, {
      message: "Connection refused",
      code: "ECONNREFUSED",
      stack: "Error: Connection refused\n    at connect",
    });
    await manager.flush();

    const runtimeContent = await manager.readRuntime(runId);
    expect(runtimeContent).toContain("ERROR [ECONNREFUSED]");
    expect(runtimeContent).toContain("Connection refused");
  });

  it("should write startup with new optional fields", async () => {
    await manager.writeStartup(runId, {
      nodeVersion: "v22.0.0",
      projectMode: "development",
      configStatus: "loaded",
      planner: "internal-ai (openai)",
      executorCount: 3,
      validationProfile: "safe",
      aiProviderCount: 5,
    });
    await manager.flush();

    const runtimeContent = await manager.readRuntime(runId);
    expect(runtimeContent).toContain("Validation: safe");
    expect(runtimeContent).toContain("AI providers: 5");
  });
});
