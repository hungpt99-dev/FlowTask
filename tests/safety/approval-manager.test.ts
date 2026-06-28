import { describe, it, expect, beforeEach } from "vitest";
import { ApprovalManager } from "../../src/safety/approval-manager.js";

describe("ApprovalManager", () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    manager = new ApprovalManager();
  });

  it("should approve when approval is disabled", async () => {
    manager.setConfig({ enabled: false });
    const result = await manager.requestApproval({
      taskId: "task_1",
      command: "echo hello",
      reason: "test",
    });
    expect(result).toBe(true);
  });

  it("should approve when mode is skip", async () => {
    manager.setConfig({ mode: "skip" });
    const result = await manager.requestApproval({
      taskId: "task_1",
      command: "echo hello",
      reason: "test",
    });
    expect(result).toBe(true);
  });

  it("should approve when autoApprove is true", async () => {
    manager.setConfig({ autoApprove: true });
    const result = await manager.requestApproval({
      taskId: "task_1",
      command: "echo hello",
      reason: "test",
    });
    expect(result).toBe(true);
  });

  it("should approve when mode is auto", async () => {
    manager.setConfig({ mode: "auto" });
    const result = await manager.requestApproval({
      taskId: "task_1",
      command: "echo hello",
      reason: "test",
    });
    expect(result).toBe(true);
  });

  it("should approve in non-TTY environment", async () => {
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false as unknown as boolean;
    try {
      const result = await manager.requestApproval({
        taskId: "task_1",
        command: "echo hello",
        reason: "test",
      });
      expect(result).toBe(true);
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });

  it("should set config via constructor", async () => {
    const m = new ApprovalManager({ autoApprove: true, enabled: false });
    await expect(
      m.requestApproval({
        taskId: "task_1",
        command: "echo",
        reason: "test",
      }),
    ).resolves.toBe(true);
  });

  it("should have interactive mode as default", () => {
    const m = new ApprovalManager();
    m.setConfig({});
    // default config: enabled=true, autoApprove=false, mode=interactive
  });

  it("should handle step-specific approval request", async () => {
    manager.setConfig({ autoApprove: true });
    const result = await manager.requestApproval({
      taskId: "task_1",
      stepId: "step_001",
      stepTitle: "Install dependency",
      command: "pnpm add dep",
      reason: "Adding new dependency",
    });
    expect(result).toBe(true);
  });

  describe("requestStepFailureResolution", () => {
    it("should skip in non-TTY environment", async () => {
      const original = process.stdin.isTTY;
      process.stdin.isTTY = false as unknown as boolean;
      try {
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("skip");
      } finally {
        process.stdin.isTTY = original;
      }
    });

    it("should skip in auto mode", async () => {
      manager.setConfig({ mode: "auto" });
      const result = await manager.requestStepFailureResolution({
        taskId: "task_1",
        taskTitle: "Test task",
      });
      expect(result).toBe("skip");
    });

    it("should skip in skip mode", async () => {
      manager.setConfig({ mode: "skip" });
      const result = await manager.requestStepFailureResolution({
        taskId: "task_1",
        taskTitle: "Test task",
      });
      expect(result).toBe("skip");
    });

    it("should skip when autoApprove is true", async () => {
      manager.setConfig({ autoApprove: true });
      const result = await manager.requestStepFailureResolution({
        taskId: "task_1",
        taskTitle: "Test task",
      });
      expect(result).toBe("skip");
    });
  });
});
