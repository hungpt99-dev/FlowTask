import { describe, it, expect } from "vitest";
import { ProcessManager } from "../../src/core/process-manager.js";
import { testDir } from "../setup.js";

describe("ProcessManager", () => {
  it("should create an instance", () => {
    const pm = new ProcessManager();
    expect(pm).toBeInstanceOf(ProcessManager);
  });

  it("should register and clear process metadata", async () => {
    const pm = new ProcessManager();
    pm.register(testDir, "run_001", "task_001", 12345, "shell");

    expect(pm.hasActiveProcess("run_001")).toBe(true);
    const meta = pm.getProcess("run_001");
    expect(meta).toBeDefined();
    expect(meta!.pid).toBe(12345);
    expect(meta!.taskId).toBe("task_001");

    await pm.clear(testDir, "run_001");
    expect(pm.hasActiveProcess("run_001")).toBe(false);
  });

  it("should report no active process when not registered", () => {
    const pm = new ProcessManager();
    expect(pm.hasActiveProcess("non-existent")).toBe(false);
  });
});
