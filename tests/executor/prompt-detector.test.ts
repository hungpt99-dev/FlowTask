/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { PromptDetector } from "../../src/executor/prompt-detector.js";
import { InteractiveController } from "../../src/executor/interactive-controller.js";

describe("PromptDetector", () => {
  it("should detect [y/n] approval patterns", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Would you like to continue? [y/n]");
    expect(result.prompts.length).toBeGreaterThan(0);
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
    expect(result.bestPrompt!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should detect (Y/n) patterns", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Continue? (Y/n)");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect 'Continue?' text prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Continue?");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect 'Do you want to continue' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Do you want to continue?");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect password prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Password:");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("password");
    expect(result.bestPrompt?.requiresSecureInput).toBe(true);
  });

  it("should detect sudo password prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("[sudo] password for user:");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("sudo");
  });

  it("should detect login prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Login:");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("login");
  });

  it("should detect API key prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("API Key:");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("api_key");
  });

  it("should detect 'Press Enter' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Press Enter to continue");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("input");
  });

  it("should detect 'Press any key' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Press any key to continue...");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("input");
  });

  it("should detect OAuth prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Please authorize the application via OAuth");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("oauth");
  });

  it("should not trigger on normal output lines", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Processing file: src/index.ts");
    expect(result.isWaiting).toBe(false);
    expect(result.bestPrompt).toBeNull();
  });

  it("should not trigger on empty lines", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("");
    expect(result.isWaiting).toBe(false);
  });

  it("should not trigger on informational messages", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Task completed successfully");
    expect(result.isWaiting).toBe(false);
  });

  it("should return the highest confidence prompt when multiple match", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Password: [y/n]");
    expect(result.bestPrompt).not.toBeNull();
    expect(result.prompts.length).toBeGreaterThan(1);
    expect(result.bestPrompt!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should detect 'approve' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Approve?");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect shell-style prompts with low confidence", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("# ");
    expect(result.isWaiting).toBe(false);
    expect(result.bestPrompt).not.toBeNull();
    expect(result.bestPrompt!.confidence).toBeLessThan(0.6);
  });

  it("should detect silence/stuck state", () => {
    const detector = new PromptDetector(100, 200);
    detector.recordOutput();
    const silence = detector.checkSilence(Date.now() + 300);
    expect(silence).not.toBeNull();
    expect(silence!.type).toBe("generic_input");
  });

  it("should not report silence before threshold", () => {
    const detector = new PromptDetector(5000, 10000);
    detector.recordOutput();
    const silence = detector.checkSilence(Date.now() + 100);
    expect(silence).toBeNull();
  });

  it("should detect 'Press return' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Press return to continue");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("input");
  });

  it("should detect 'Enter your' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Enter your name:");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("input");
  });
});

describe("InteractiveController", () => {
  it("should create and retrieve a session", () => {
    const process: any = { pid: 12345, stdin: { write: () => true, destroyed: false } };
    const id = InteractiveController.createSession("run1", "task1", "test", process);
    const session = InteractiveController.getSession(id);
    expect(session).not.toBeNull();
    expect(session!.runId).toBe("run1");
    expect(session!.taskId).toBe("task1");
    expect(session!.status).toBe("running");
  });

  it("should retrieve session by run ID", () => {
    const process: any = { pid: 12346, stdin: { write: () => true, destroyed: false } };
    InteractiveController.createSession("run2", "task2", "test", process);
    const session = InteractiveController.getSessionByRunId("run2");
    expect(session).not.toBeNull();
    expect(session!.taskId).toBe("task2");
  });

  it("should send input to a session", () => {
    let written = "";
    const process: any = {
      pid: 12347,
      stdin: {
        write: (data: string) => {
          written = data;
          return true;
        },
        destroyed: false,
      },
    };
    const id = InteractiveController.createSession("run3", "task3", "test", process);
    const result = InteractiveController.sendInput(id, "test input");
    expect(result).toBe(true);
    expect(written).toBe("test input\n");
  });

  it("should update session status after sending input", () => {
    let written = "";
    const process: any = {
      pid: 12348,
      stdin: {
        write: (data: string) => {
          written = data;
          return true;
        },
        destroyed: false,
      },
    };
    const id = InteractiveController.createSession("run4", "task4", "test", process);
    const session = InteractiveController.getSession(id)!;
    session.status = "waiting_input";
    InteractiveController.sendInput(id, "y");
    expect(session.status).toBe("running");
    expect(session.detectedPrompt).toBeNull();
  });

  it("should kill a session", () => {
    let killed = false;
    const process: any = {
      pid: 12349,
      killed: false,
      kill: () => {
        killed = true;
      },
    };
    const id = InteractiveController.createSession("run5", "task5", "test", process);
    const result = InteractiveController.killSession(id);
    expect(result).toBe(true);
    const session = InteractiveController.getSession(id);
    expect(session!.status).toBe("killed");
  });

  it("should remove a session", () => {
    const process: any = {};
    const id = InteractiveController.createSession("run6", "task6", "test", process);
    InteractiveController.removeSession(id);
    const session = InteractiveController.getSession(id);
    expect(session).toBeNull();
  });

  it("should send input by run ID", () => {
    let written = "";
    const process: any = {
      pid: 12350,
      stdin: {
        write: (data: string) => {
          written = data;
          return true;
        },
        destroyed: false,
      },
    };
    InteractiveController.createSession("run7", "task7", "test", process);
    const result = InteractiveController.sendInputByRunId("run7", "yes");
    expect(result).toBe(true);
    expect(written).toBe("yes\n");
  });

  it("should handle send input to non-existent session", () => {
    const result = InteractiveController.sendInput("nonexistent", "test");
    expect(result).toBe(false);
  });

  it("should handle kill non-existent session", () => {
    const result = InteractiveController.killSession("nonexistent");
    expect(result).toBe(false);
  });

  it("should handle sendInputByRunId to non-existent run", () => {
    const result = InteractiveController.sendInputByRunId("nonexistent", "test");
    expect(result).toBe(false);
  });

  it("should handle killSessionByRunId to non-existent run", () => {
    const result = InteractiveController.killSessionByRunId("nonexistent");
    expect(result).toBe(false);
  });

  it("should remove session by run ID", () => {
    const process: any = {};
    InteractiveController.createSession("run8", "task8", "test", process);
    InteractiveController.removeSessionByRunId("run8");
    const session = InteractiveController.getSessionByRunId("run8");
    expect(session).toBeNull();
  });

  it("should switch to waiting_input status when prompt detected", () => {
    const process: any = {};
    const id = InteractiveController.createSession("run9", "task9", "test", process);
    const session = InteractiveController.getSession(id)!;
    session.status = "waiting_input";
    session.detectedPrompt = {
      type: "input",
      confidence: 0.9,
      matchedText: "Enter value:",
      pattern: "test",
      requiresSecureInput: false,
    };
    expect(session.status).toBe("waiting_input");
    expect(session.detectedPrompt?.type).toBe("input");
  });

  it("should switch to waiting_approval status when approval prompt detected", () => {
    const process: any = {};
    const id = InteractiveController.createSession("run10", "task10", "test", process);
    const session = InteractiveController.getSession(id)!;
    session.status = "waiting_approval";
    session.detectedPrompt = {
      type: "approval",
      confidence: 0.9,
      matchedText: "Continue? [y/n]",
      pattern: "test",
      requiresSecureInput: false,
    };
    expect(session.status).toBe("waiting_approval");
    expect(session.detectedPrompt?.type).toBe("approval");
    expect(session.detectedPrompt?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should switch to stuck status when process is stuck", () => {
    const process: any = {};
    const id = InteractiveController.createSession("run11", "task11", "test", process);
    const session = InteractiveController.getSession(id)!;
    session.status = "stuck";
    expect(session.status).toBe("stuck");
  });

  it("should track stdout lines in session", () => {
    const process: any = {};
    const id = InteractiveController.createSession("run12", "task12", "test", process);
    const session = InteractiveController.getSession(id)!;
    session.stdoutLines.push("line1");
    session.stdoutLines.push("line2");
    expect(session.stdoutLines).toHaveLength(2);
    expect(session.stdoutLines[0]).toBe("line1");
  });
});
