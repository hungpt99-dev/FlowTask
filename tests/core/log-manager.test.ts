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
});
