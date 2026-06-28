import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { ApprovalManager, type StepFailureAction } from "../../src/safety/approval-manager.js";

vi.mock("enquirer", () => ({
  default: vi.fn(),
}));

describe("Step failure resolution integration", () => {
  let manager: ApprovalManager;
  let EnquirerMock: ReturnType<typeof vi.fn>;

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

  describe("TTY interactive prompt flow", () => {
    it("should present retry, skip, and stop choices to the user", async () => {
      const original = setupTTY();
      try {
        const mockInstance = createMockEnquirer("retry");
        await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Integration test task",
        });
        expect(mockInstance.prompt).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "select",
            name: "action",
            choices: ["retry", "skip", "stop"],
          }),
        );
      } finally {
        restoreTTY(original);
      }
    });

    it("should include task title in the prompt message", async () => {
      const original = setupTTY();
      try {
        const mockInstance = createMockEnquirer("skip");
        await manager.requestStepFailureResolution({
          taskId: "task_42",
          taskTitle: "Build frontend assets",
        });
        const callArg = mockInstance.prompt.mock.calls[0]![0] as {
          message: string;
        };
        expect(callArg.message).toContain("Build frontend assets");
      } finally {
        restoreTTY(original);
      }
    });
  });

  describe("Retry action flow", () => {
    it("should return retry when configured interactively and user selects retry", async () => {
      const original = setupTTY();
      try {
        createMockEnquirer("retry");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_retry",
          taskTitle: "Retry me",
        });
        expect(result).toBe("retry");
      } finally {
        restoreTTY(original);
      }
    });

    it("should not prompt in auto mode — always returns skip even if TTY", async () => {
      const original = setupTTY();
      try {
        manager.setConfig({ mode: "auto" });
        createMockEnquirer("retry");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test",
        });
        expect(result).toBe("skip");
        expect(EnquirerMock).not.toHaveBeenCalled();
      } finally {
        restoreTTY(original);
      }
    });
  });

  describe("Skip action flow", () => {
    it("should return skip in non-TTY mode", async () => {
      const original = process.stdin.isTTY;
      process.stdin.isTTY = false as unknown as boolean;
      try {
        const result = await manager.requestStepFailureResolution({
          taskId: "task_skip",
          taskTitle: "Skip me",
        });
        expect(result).toBe("skip");
        expect(EnquirerMock).not.toHaveBeenCalled();
      } finally {
        process.stdin.isTTY = original;
      }
    });

    it("should return skip in skip mode even with TTY available", async () => {
      const original = setupTTY();
      try {
        manager.setConfig({ mode: "skip" });
        const result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test",
        });
        expect(result).toBe("skip");
      } finally {
        restoreTTY(original);
      }
    });
  });

  describe("Stop action flow", () => {
    it("should return stop when user selects stop in TTY mode", async () => {
      const original = setupTTY();
      try {
        createMockEnquirer("stop");
        const result = await manager.requestStepFailureResolution({
          taskId: "task_stop",
          taskTitle: "Stop me",
        });
        expect(result).toBe("stop");
      } finally {
        restoreTTY(original);
      }
    });

    it("should return stop when enquirer prompt throws", async () => {
      const original = setupTTY();
      try {
        const mockInstance = {
          prompt: vi.fn().mockRejectedValue(new Error("Prompt cancelled")),
        };
        EnquirerMock.mockReturnValue(mockInstance);
        const result = await manager.requestStepFailureResolution({
          taskId: "task_stop",
          taskTitle: "Stop on error",
        });
        expect(result).toBe("stop");
      } finally {
        restoreTTY(original);
      }
    });

    it("should return stop when enquirer returns undefined action", async () => {
      const original = setupTTY();
      try {
        const mockInstance = {
          prompt: vi.fn().mockResolvedValue({}),
        };
        EnquirerMock.mockReturnValue(mockInstance);
        const result = await manager.requestStepFailureResolution({
          taskId: "task_stop",
          taskTitle: "Undefined action",
        });
        expect(result).toBe("stop");
      } finally {
        restoreTTY(original);
      }
    });
  });

  describe("Config transitions", () => {
    it("should toggle between skip and interactive modes via setConfig", async () => {
      const original = setupTTY();
      try {
        manager.setConfig({ mode: "skip" });

        let result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test",
        });
        expect(result).toBe("skip");
        expect(EnquirerMock).not.toHaveBeenCalled();

        manager.setConfig({ mode: "interactive" });
        createMockEnquirer("retry");
        result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test",
        });
        expect(result).toBe("retry");
      } finally {
        restoreTTY(original);
      }
    });

    it("should respect autoApprove toggle", async () => {
      const original = setupTTY();
      try {
        manager.setConfig({ autoApprove: true });

        let result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test",
        });
        expect(result).toBe("skip");
        expect(EnquirerMock).not.toHaveBeenCalled();

        manager.setConfig({ autoApprove: false });
        createMockEnquirer("stop");
        result = await manager.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Test",
        });
        expect(result).toBe("stop");
      } finally {
        restoreTTY(original);
      }
    });
  });

  describe("Constructor config defaults", () => {
    it("should create with interactive mode by default", async () => {
      const m = new ApprovalManager();
      const original = setupTTY();
      try {
        createMockEnquirer("retry");
        const result = await m.requestStepFailureResolution({
          taskId: "task_1",
          taskTitle: "Default config test",
        });
        expect(result).toBe("retry");
      } finally {
        restoreTTY(original);
      }
    });
  });
});
