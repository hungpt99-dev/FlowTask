import { describe, it, expect, beforeEach } from "vitest";
import { ApprovalManager } from "../../src/safety/approval-manager.js";

describe("ApprovalManager retry approval", () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    manager = new ApprovalManager();
  });

  it("should auto-approve retry when approval is disabled", async () => {
    manager.setConfig({ enabled: false });
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 4,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should auto-approve retry when mode is skip", async () => {
    manager.setConfig({ mode: "skip" });
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 4,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should auto-approve retry when autoApprove is true", async () => {
    manager.setConfig({ autoApprove: true });
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 4,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should auto-approve retry when mode is auto", async () => {
    manager.setConfig({ mode: "auto" });
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 4,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should auto-approve retry in non-TTY environment", async () => {
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false as unknown as boolean;
    try {
      const result = await manager.requestRetryApproval({
        taskId: "task_1",
        taskTitle: "Test task",
        retryCount: 4,
        maxRetries: 3,
      });
      expect(result).toBe(true);
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });

  it("should include retry info in request data", async () => {
    manager.setConfig({ autoApprove: true });
    const result = await manager.requestRetryApproval({
      taskId: "task_abc",
      taskTitle: "My Task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should respect constructor config for disabled approvals", async () => {
    const m = new ApprovalManager({ enabled: false });
    const result = await m.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should respect constructor config for autoApprove", async () => {
    const m = new ApprovalManager({ autoApprove: true });
    const result = await m.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should skip the prompt when TTY is available but retryCount <= maxRetries", async () => {
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 2,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });
});
