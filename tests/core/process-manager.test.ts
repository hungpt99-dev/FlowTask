import { describe, it, expect } from "vitest";
import { ProcessManager } from "../../src/core/process-manager.js";
import { testDir } from "../setup.js";

describe("ProcessManager", () => {
  it("should create an instance", () => {
    const pm = new ProcessManager();
    expect(pm).toBeInstanceOf(ProcessManager);
  });

  it("should save and read process metadata", async () => {
    const pm = new ProcessManager();
    const runId = "run_test_001";

    await pm.save(testDir, {
      runId,
      taskId: "task_001",
      pid: 12345,
      executor: "shell",
      command: "node",
      args: ["script.js"],
      startedAt: new Date().toISOString(),
      status: "running",
    });

    const read = await pm.read(testDir, runId);
    expect(read).not.toBeNull();
    expect(read!.pid).toBe(12345);
    expect(read!.status).toBe("running");

    await pm.clear(testDir, runId);
    const after = await pm.read(testDir, runId);
    expect(after).toBeNull();
  });

  it("should report process not running when not saved", async () => {
    const pm = new ProcessManager();
    const running = await pm.isRunning(testDir, "non-existent");
    expect(running).toBe(false);
  });

  it("should return not_found when stopping non-existent process", async () => {
    const pm = new ProcessManager();
    const result = await pm.stop(testDir, "non-existent");
    expect(result.success).toBe(false);
    expect(result.finalStatus).toBe("not_found");
  });
});
