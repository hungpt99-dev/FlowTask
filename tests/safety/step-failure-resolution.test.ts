import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApprovalManager, type StepFailureAction } from "../../src/safety/approval-manager.js";

vi.mock("enquirer", () => ({
  default: vi.fn(),
}));

async function importTestModules() {
  const mod = await import("../../src/safety/approval-manager.js");
  return mod;
}

describe("Step failure resolution", () => {
  let EnquirerMock: ReturnType<typeof vi.fn>;
  let manager: ApprovalManager;

  beforeEach(async () => {
    vi.resetAllMocks();
    const { default: Enquirer } = await import("enquirer");
    EnquirerMock = Enquirer as unknown as ReturnType<typeof vi.fn>;
    manager = new ApprovalManager();
  });

  function setupTTY() {
    const original = process.stdin.isTTY;
    process.stdin.isTTY = true as unknown as boolean;
    return original;
  }

  function restoreTTY(original: boolean | undefined) {
    process.stdin.isTTY = original as unknown as boolean;
  }

  function createMockEnquirer(result: StepFailureAction) {
    const mockInstance = {
      prompt: vi.fn().mockResolvedValue({ action: result }),
    };
    EnquirerMock.mockReturnValue(mockInstance);
    return mockInstance;
  }

  function createFailingMockEnquirer() {
    const mockInstance = {
      prompt: vi.fn().mockRejectedValue(new Error("Prompt failed")),
    };
    EnquirerMock.mockReturnValue(mockInstance);
    return mockInstance;
  }

  describe("TTY mode with mocked enquirer", () => {
    it("should return retry when user selects retry in TTY mode", async () => {
      const original = setupTTY();
      try {
        createMockEnquirer("retry");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("retry");
      } finally {
        restoreTTY(original);
      }
    });

    it("should return skip when user selects skip in TTY mode", async () => {
      const original = setupTTY();
      try {
        createMockEnquirer("skip");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("skip");
      } finally {
        restoreTTY(original);
      }
    });

    it("should return stop when user selects stop in TTY mode", async () => {
      const original = setupTTY();
      try {
        createMockEnquirer("stop");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("stop");
      } finally {
        restoreTTY(original);
      }
    });

    it("should return stop when enquirer throws", async () => {
      const original = setupTTY();
      try {
        createFailingMockEnquirer();
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("stop");
      } finally {
        restoreTTY(original);
      }
    });

    it("should pass taskTitle to enquirer prompt message", async () => {
      const original = setupTTY();
      try {
        const mockInstance = createMockEnquirer("retry");
        await manager.requestStepFailureResolution({
          taskId: "task_001",
          taskTitle: "Deploy to production",
        });
        expect(mockInstance.prompt).toHaveBeenCalledTimes(1);
        const callArg = mockInstance.prompt.mock.calls[0]![0] as {
          type: string;
          name: string;
          message: string;
          choices: string[];
        };
        expect(callArg.type).toBe("select");
        expect(callArg.name).toBe("action");
        expect(callArg.message).toContain("Deploy to production");
        expect(callArg.choices).toEqual(["retry", "skip", "stop"]);
      } finally {
        restoreTTY(original);
      }
    });
  });

  describe("Non-TTY and auto mode", () => {
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

  describe("Config interaction", () => {
    it("should return skip in auto mode even in TTY", async () => {
      const original = setupTTY();
      try {
        manager.setConfig({ mode: "auto" });
        createMockEnquirer("retry");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("skip");
        expect(EnquirerMock).not.toHaveBeenCalled();
      } finally {
        restoreTTY(original);
      }
    });

    it("should return skip when autoApprove is true even in TTY", async () => {
      const original = setupTTY();
      try {
        manager.setConfig({ autoApprove: true });
        createMockEnquirer("retry");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("skip");
        expect(EnquirerMock).not.toHaveBeenCalled();
      } finally {
        restoreTTY(original);
      }
    });

    it("should not prompt in non-TTY even when mode is interactive", async () => {
      const original = process.stdin.isTTY;
      process.stdin.isTTY = false as unknown as boolean;
      try {
        createMockEnquirer("retry");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("skip");
        expect(EnquirerMock).not.toHaveBeenCalled();
      } finally {
        process.stdin.isTTY = original;
      }
    });

    it("should skip when autoApprove is true with constructor config", async () => {
      const original = setupTTY();
      try {
        const m = new ApprovalManager({ autoApprove: true });
        const result = await m.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("skip");
      } finally {
        restoreTTY(original);
      }
    });

    it("should toggle behavior via setConfig", async () => {
      const original = setupTTY();
      try {
        manager.setConfig({ mode: "auto" });
        expect(
          await manager.requestStepFailureResolution({
            taskId: "task_1",
            taskTitle: "Test task",
          }),
        ).toBe("skip");

        manager.setConfig({ mode: "interactive" });
        createMockEnquirer("retry");
        expect(
          await manager.requestStepFailureResolution({
            taskId: "task_1",
            taskTitle: "Test task",
          }),
        ).toBe("retry");
      } finally {
        restoreTTY(original);
      }
    });
  });

  describe("StepFailureRequest with error field", () => {
    it("should accept error field in request", async () => {
      const original = setupTTY();
      try {
        createMockEnquirer("skip");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
          error: "Command exited with code 1",
        });
        expect(result).toBe("skip");
      } finally {
        restoreTTY(original);
      }
    });

    it("should accept request without error field", async () => {
      const original = setupTTY();
      try {
        createMockEnquirer("stop");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test task",
        });
        expect(result).toBe("stop");
      } finally {
        restoreTTY(original);
      }
    });
  });
});
