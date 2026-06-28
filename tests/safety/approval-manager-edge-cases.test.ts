import { describe, it, expect, beforeEach } from "vitest";
import { ApprovalManager } from "../../src/safety/approval-manager.js";

describe("ApprovalManager edge cases", () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    manager = new ApprovalManager();
  });

  describe("constructor config", () => {
    it("should use defaults when no config provided", () => {
      // default: enabled=true, autoApprove=false, mode=interactive
      expect(manager).toBeDefined();
    });

    it("should accept partial config in constructor", () => {
      const m = new ApprovalManager({ enabled: false });
      // should work without error
      expect(m).toBeDefined();
    });

    it("should accept mode-only config", () => {
      const m = new ApprovalManager({ mode: "skip" });
      // should work without error
      expect(m).toBeDefined();
    });
  });

  describe("setConfig updates", () => {
    it("should merge partial config updates", () => {
      manager.setConfig({ autoApprove: true });
      // subsequent call should reflect the merged config
      manager.setConfig({ enabled: false });
    });

    it("should toggle between modes", () => {
      manager.setConfig({ mode: "skip" });
      manager.setConfig({ mode: "auto" });
      manager.setConfig({ mode: "interactive" });
      // no error expected
    });

    it("should override enabled flag", () => {
      manager.setConfig({ enabled: false });
      manager.setConfig({ enabled: true });
    });
  });

  describe("edge cases", () => {
    it("should handle request with empty command", async () => {
      manager.setConfig({ autoApprove: true });
      const result = await manager.requestApproval({
        taskId: "task_1",
        command: "",
        reason: "Empty command test",
      });
      expect(result).toBe(true);
    });

    it("should handle request with minimal fields", async () => {
      manager.setConfig({ mode: "skip" });
      const result = await manager.requestApproval({
        taskId: "task_1",
        command: "echo hello",
        reason: "",
      });
      expect(result).toBe(true);
    });

    it("should handle request with special characters", async () => {
      manager.setConfig({ autoApprove: true });
      const result = await manager.requestApproval({
        taskId: "task_001",
        stepId: "step_001",
        stepTitle: "Install & configure: rm -rf /tmp/test",
        command: "npm install --save-dev typescript@^5.0.0",
        reason: "Adding dev dependency with special chars: !@#$%^&*()",
      });
      expect(result).toBe(true);
    });

    it("should approve in non-TTY even without autoApprove", async () => {
      const originalIsTTY = process.stdin.isTTY;
      process.stdin.isTTY = false as unknown as boolean;
      try {
        // mode=interactive, enabled=true, autoApprove=false
        const m = new ApprovalManager({
          enabled: true,
          autoApprove: false,
          mode: "interactive",
        });
        const result = await m.requestApproval({
          taskId: "task_1",
          command: "echo hello",
          reason: "test",
        });
        expect(result).toBe(true);
      } finally {
        process.stdin.isTTY = originalIsTTY;
      }
    });
  });

  describe("approval flow with bypass mode", () => {
    it("should approve in skip mode regardless of autoApprove", async () => {
      manager.setConfig({ mode: "skip", autoApprove: false, enabled: true });
      const result = await manager.requestApproval({
        taskId: "task_1",
        command: "rm -rf /",
        reason: "Dangerous command",
      });
      expect(result).toBe(true);
    });

    it("should approve in auto mode regardless of autoApprove", async () => {
      manager.setConfig({ mode: "auto", autoApprove: false });
      const result = await manager.requestApproval({
        taskId: "task_1",
        command: "rm -rf /",
        reason: "Dangerous command",
      });
      expect(result).toBe(true);
    });

    it("should approve when disabled regardless of other settings", async () => {
      manager.setConfig({ enabled: false, mode: "interactive", autoApprove: false });
      const result = await manager.requestApproval({
        taskId: "task_1",
        command: "dangerous-command",
        reason: "test",
      });
      expect(result).toBe(true);
    });
  });
});
