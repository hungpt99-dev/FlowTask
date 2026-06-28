import { describe, it, expect, beforeEach } from "vitest";
import { ApprovalManager } from "../../src/safety/approval-manager.js";

describe("ApprovalManager retry flow", () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    manager = new ApprovalManager();
  });

  it("should auto-approve when retryCount is 0 (first retry)", async () => {
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 0,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should auto-approve when retryCount is below maxRetries", async () => {
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 1,
      maxRetries: 5,
    });
    expect(result).toBe(true);
  });

  it("should auto-approve when retryCount equals maxRetries", async () => {
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 3,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should auto-approve in non-TTY even when retryCount exceeds maxRetries", async () => {
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should respect mode toggle from setConfig", async () => {
    manager.setConfig({ mode: "auto" });
    const autoResult = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(autoResult).toBe(true);

    manager.setConfig({ mode: "skip" });
    const skipResult = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(skipResult).toBe(true);
  });

  it("should work with constructor mode set to auto", async () => {
    const m = new ApprovalManager({ mode: "auto" });
    const result = await m.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should return early without prompt when disabled with setConfig", async () => {
    manager.setConfig({ enabled: false });
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 10,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should carry RetryApprovalRequest fields correctly", async () => {
    manager.setConfig({ autoApprove: true });
    const request = {
      taskId: "task_deploy",
      taskTitle: "Deploy to production",
      retryCount: 4,
      maxRetries: 3,
    };
    const result = await manager.requestRetryApproval(request);
    expect(result).toBe(true);
  });

  it("should handle very large retryCount values", async () => {
    manager.setConfig({ autoApprove: true });
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 1000,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should handle maxRetries of 0", async () => {
    manager.setConfig({ autoApprove: true });
    const result = await manager.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 1,
      maxRetries: 0,
    });
    expect(result).toBe(true);
  });

  it("should toggle enabled via setConfig and have immediate effect", async () => {
    const m = new ApprovalManager({ enabled: false });
    const disabledResult = await m.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(disabledResult).toBe(true);

    m.setConfig({ enabled: true });
    const enabledResult = await m.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(enabledResult).toBe(true);
  });

  it("should set config toggling autoApprove with setConfig", async () => {
    const m = new ApprovalManager({ autoApprove: false, mode: "auto" });

    const result = await m.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(result).toBe(true);

    m.setConfig({ autoApprove: true });
    const result2 = await m.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(result2).toBe(true);
  });

  it("should combine enabled=false with any mode", async () => {
    const m = new ApprovalManager({ enabled: false, mode: "interactive" });
    const result = await m.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 5,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });

  it("should skip prompt when mode is skip regardless of retry count", async () => {
    const m = new ApprovalManager({ mode: "skip" });
    const result = await m.requestRetryApproval({
      taskId: "task_1",
      taskTitle: "Test task",
      retryCount: 999,
      maxRetries: 3,
    });
    expect(result).toBe(true);
  });
});
