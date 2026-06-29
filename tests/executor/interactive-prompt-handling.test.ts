import { describe, it, expect, vi, beforeEach } from "vitest";
import { InteractiveController } from "../../src/executor/interactive-controller.js";
import { PromptDetector, type DetectedPrompt } from "../../src/executor/prompt-detector.js";
import { getEventBus, setEventBus, EventBus } from "../../src/ui/event-bus.js";

describe("InteractiveController - New Methods", () => {
  beforeEach(() => {
    // Clear sessions between tests
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  const makeMockProcess = (overrides: Record<string, unknown> = {}) => ({
    pid: 12345,
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
    kill: vi.fn(),
    on: vi.fn(),
    ...overrides,
  });

  it("should return null for getStatusByRunId when no session exists", () => {
    const status = InteractiveController.getStatusByRunId("nonexistent");
    expect(status).toBeNull();
  });

  it("should return session status from getStatusByRunId", () => {
    const process = makeMockProcess();
    InteractiveController.createSession("run1", "task1", "test", process as never);
    const status = InteractiveController.getStatusByRunId("run1");
    expect(status).toBe("running");
  });

  it("should return empty array for getLatestOutputByRunId when no session exists", () => {
    const output = InteractiveController.getLatestOutputByRunId("nonexistent");
    expect(output).toEqual([]);
  });

  it("should return recent stdout and stderr lines from getLatestOutputByRunId", () => {
    const process = makeMockProcess();
    const id = InteractiveController.createSession("run2", "task2", "test", process as never);
    const session = InteractiveController.getSession(id)!;
    session.stdoutLines.push("line1", "line2");
    session.stderrLines.push("err1");

    const output = InteractiveController.getLatestOutputByRunId("run2", 10);
    expect(output).toContain("line1");
    expect(output).toContain("line2");
    expect(output).toContain("err1");
  });

  it("should return limited lines from getLatestOutputByRunId", () => {
    const process = makeMockProcess();
    const id = InteractiveController.createSession("run3", "task3", "test", process as never);
    const session = InteractiveController.getSession(id)!;
    for (let i = 0; i < 10; i++) {
      session.stdoutLines.push(`line${i}`);
    }

    const output = InteractiveController.getLatestOutputByRunId("run3", 3);
    expect(output).toHaveLength(3);
    expect(output[0]).toBe("line7");
  });

  it("should return false from isSessionAlive for non-existent session", () => {
    expect(InteractiveController.isSessionAlive("nonexistent")).toBe(false);
  });

  it("should return true from isSessionAlive for running session", () => {
    const process = makeMockProcess();
    const id = InteractiveController.createSession("run4", "task4", "test", process as never);
    expect(InteractiveController.isSessionAlive(id)).toBe(true);
  });

  it("should return false from isSessionAlive for killed session", () => {
    const process = makeMockProcess({ killed: true });
    const id = InteractiveController.createSession("run5", "task5", "test", process as never);
    expect(InteractiveController.isSessionAlive(id)).toBe(false);
  });

  it("should return false from isSessionAlive for exited session", () => {
    const process = makeMockProcess({ exitCode: 0 });
    const id = InteractiveController.createSession("run6", "task6", "test", process as never);
    expect(InteractiveController.isSessionAlive(id)).toBe(false);
  });

  it("should return false from isSessionAliveByRunId for non-existent run", () => {
    expect(InteractiveController.isSessionAliveByRunId("nonexistent")).toBe(false);
  });

  it("should return true from isSessionAliveByRunId for running session", () => {
    const process = makeMockProcess();
    InteractiveController.createSession("run7", "task7", "test", process as never);
    expect(InteractiveController.isSessionAliveByRunId("run7")).toBe(true);
  });

  it("should return active sessions from getActiveSessions", () => {
    const process = makeMockProcess();
    InteractiveController.createSession("run8", "task8", "test", process as never);
    InteractiveController.createSession("run9", "task9", "test", process as never);

    const sessions = InteractiveController.getActiveSessions();
    expect(sessions).toHaveLength(2);
  });

  it("should wait for process exit via waitForProcessExit", async () => {
    let closeHandler: ((code: number) => void) | null = null;
    const process = makeMockProcess({
      on: vi.fn((event: string, handler: (code: number) => void) => {
        if (event === "close") closeHandler = handler;
      }),
    });
    const id = InteractiveController.createSession("run10", "task10", "test", process as never);

    const exitPromise = InteractiveController.waitForProcessExit(id);
    expect(closeHandler).not.toBeNull();

    closeHandler!(0);
    const result = await exitPromise;
    expect(result.exitCode).toBe(0);
  });

  it("should immediately resolve waitForProcessExit if process already exited", async () => {
    const process = makeMockProcess({ exitCode: 1 });
    const id = InteractiveController.createSession("run11", "task11", "test", process as never);

    const result = await InteractiveController.waitForProcessExit(id);
    expect(result.exitCode).toBe(1);
  });

  it("should resolve null from waitForProcessExit for non-existent session", async () => {
    const result = await InteractiveController.waitForProcessExit("nonexistent");
    expect(result.exitCode).toBeNull();
  });

  it("should resolve from waitForProcessExitByRunId for non-existent run", async () => {
    const result = await InteractiveController.waitForProcessExitByRunId("nonexistent");
    expect(result.exitCode).toBeNull();
  });

  it("should update session to running and clear prompt on sendInput", () => {
    const process = makeMockProcess();
    const id = InteractiveController.createSession("run12", "task12", "test", process as never);
    const session = InteractiveController.getSession(id)!;
    session.status = "waiting_input";
    session.detectedPrompt = {
      type: "input",
      confidence: 0.9,
      matchedText: "Enter value:",
      pattern: "test",
      requiresSecureInput: false,
    } as DetectedPrompt;

    const result = InteractiveController.sendInput(id, "test input");
    expect(result).toBe(true);
    expect(session.status).toBe("running");
    expect(session.detectedPrompt).toBeNull();
    expect(process.stdin.write).toHaveBeenCalledWith("test input\n");
  });

  it("should include new entry in interactive events when prompt is handled", () => {
    const bus = new EventBus();
    setEventBus(bus);

    const process = makeMockProcess();
    const id = InteractiveController.createSession("run13", "task13", "test", process as never);
    const handler = createDetectedPromptHandler("run13", "task13", "test", id);

    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    const detector = new PromptDetector();
    const result = detector.analyzeText("Continue? [y/n]");
    if (result.bestPrompt) {
      handler(result.bestPrompt);
    }

    expect(eventSpy).toHaveBeenCalled();
  });
});

function createDetectedPromptHandler(
  runId: string,
  taskId: string,
  executorName: string,
  sessionId: string,
): (prompt: DetectedPrompt) => void {
  const eventBus = getEventBus();
  return (prompt: DetectedPrompt): void => {
    const session = InteractiveController.getSession(sessionId);
    if (session) {
      session.detectedPrompt = prompt;
      session.status = prompt.type === "approval" ? "waiting_approval" : "waiting_input";
    }
    eventBus.emit({
      type: "prompt_detected",
      runId,
      taskId,
      sessionId,
      executor: executorName,
      promptType: prompt.type,
      promptText: prompt.matchedText,
      confidence: prompt.confidence,
      requiresSecureInput: prompt.requiresSecureInput,
    } as never);
  };
}

describe("Interactive prompt detection with executor result integration", () => {
  it("approval prompt type should map to waiting_approval status", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Continue? [y/n]");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
    const waitStatus =
      result.bestPrompt!.type === "approval" ? "waiting_approval" : "waiting_input";
    expect(waitStatus).toBe("waiting_approval");
  });

  it("input prompt type should map to waiting_input status", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Press Enter to continue");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("input");
    const waitStatus =
      result.bestPrompt!.type === "approval" ? "waiting_approval" : "waiting_input";
    expect(waitStatus).toBe("waiting_input");
  });

  it("password prompt should map to waiting_input status", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Password:");
    expect(result.bestPrompt?.type).toBe("password");
    const waitStatus =
      result.bestPrompt!.type === "approval" ? "waiting_approval" : "waiting_input";
    expect(waitStatus).toBe("waiting_input");
  });

  it("sudo prompt should map to waiting_input status", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("[sudo] password for user:");
    expect(result.bestPrompt?.type).toBe("sudo");
    const waitStatus =
      result.bestPrompt!.type === "approval" ? "waiting_approval" : "waiting_input";
    expect(waitStatus).toBe("waiting_input");
  });

  it("stuck detection should produce generic_input type", () => {
    const detector = new PromptDetector(100, 200);
    detector.recordOutput();
    const result = detector.checkSilence(Date.now() + 300);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("generic_input");
  });

  it("should not detect prompts on normal output", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Processing file: src/index.ts");
    expect(result.isWaiting).toBe(false);
    expect(result.bestPrompt).toBeNull();
  });
});

describe("Interactive session lifecycle integration", () => {
  beforeEach(() => {
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  it("should transition from running to waiting_input and back", () => {
    const process = {
      pid: 12345,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    const id = InteractiveController.createSession("run14", "task14", "test", process as never);
    const session = InteractiveController.getSession(id)!;

    // Initial state
    expect(session.status).toBe("running");

    // Prompt detected -> waiting_input
    session.status = "waiting_input";
    session.detectedPrompt = {
      type: "input",
      confidence: 0.9,
      matchedText: "Enter value:",
      pattern: "test",
      requiresSecureInput: false,
    } as DetectedPrompt;
    expect(session.status).toBe("waiting_input");

    // Input provided -> running
    InteractiveController.sendInput(id, "my input");
    expect(session.status).toBe("running");
    expect(session.detectedPrompt).toBeNull();
    expect(process.stdin.write).toHaveBeenCalledWith("my input\n");
  });

  it("should handle multiple prompt detections in sequence", () => {
    const process = {
      pid: 12346,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    const id = InteractiveController.createSession("run15", "task15", "test", process as never);
    const session = InteractiveController.getSession(id)!;

    // First prompt
    session.status = "waiting_approval";
    expect(session.status).toBe("waiting_approval");
    InteractiveController.sendInput(id, "y");
    expect(session.status).toBe("running");

    // Second prompt
    session.status = "waiting_input";
    expect(session.status).toBe("waiting_input");
    InteractiveController.sendInput(id, "some data");
    expect(session.status).toBe("running");

    expect(process.stdin.write).toHaveBeenCalledTimes(2);
    expect(process.stdin.write).toHaveBeenNthCalledWith(1, "y\n");
    expect(process.stdin.write).toHaveBeenNthCalledWith(2, "some data\n");
  });

  it("should kill a waiting session", () => {
    let killed = false;
    const process = {
      pid: 12347,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: () => {
        killed = true;
      },
      on: vi.fn(),
    };
    const id = InteractiveController.createSession("run16", "task16", "test", process as never);
    const session = InteractiveController.getSession(id)!;
    session.status = "waiting_input";

    InteractiveController.killSession(id);
    expect(session.status).toBe("killed");
    expect(killed).toBe(true);
  });
});

describe("Approve/reject command patterns", () => {
  beforeEach(() => {
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  it("should send 'y' for approval", () => {
    const process = {
      pid: 12348,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run17", "task17", "test", process as never);
    const result = InteractiveController.sendInputByRunId("run17", "y");
    expect(result).toBe(true);
    expect(process.stdin.write).toHaveBeenCalledWith("y\n");
  });

  it("should send 'n' for rejection", () => {
    const process = {
      pid: 12349,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run18", "task18", "test", process as never);
    const result = InteractiveController.sendInputByRunId("run18", "n");
    expect(result).toBe(true);
    expect(process.stdin.write).toHaveBeenCalledWith("n\n");
  });

  it("should send empty string for continue", () => {
    const process = {
      pid: 12350,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run19", "task19", "test", process as never);
    const result = InteractiveController.sendInputByRunId("run19", "");
    expect(result).toBe(true);
    expect(process.stdin.write).toHaveBeenCalledWith("\n");
  });

  it("should handle approve/reject on non-existent run gracefully", () => {
    const result = InteractiveController.sendInputByRunId("nonexistent", "y");
    expect(result).toBe(false);
  });

  it("should deduplicate stdin writes (capture distinct calls)", () => {
    const writeMock = vi.fn().mockReturnValue(true);
    const process = {
      pid: 12351,
      killed: false,
      exitCode: null,
      stdin: { write: writeMock, destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run20", "task20", "test", process as never);

    InteractiveController.sendInputByRunId("run20", "y");
    InteractiveController.sendInputByRunId("run20", "set config");
    InteractiveController.sendInputByRunId("run20", "n");

    expect(writeMock).toHaveBeenCalledTimes(3);
    expect(writeMock).toHaveBeenNthCalledWith(1, "y\n");
    expect(writeMock).toHaveBeenNthCalledWith(2, "set config\n");
    expect(writeMock).toHaveBeenNthCalledWith(3, "n\n");
  });
});

describe("Event bus integration for interactive prompts", () => {
  beforeEach(() => {
    const bus = new EventBus();
    setEventBus(bus);
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  it("should emit prompt_detected event when approval pattern found", () => {
    const bus = getEventBus();
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    const process = {
      pid: 12352,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    const id = InteractiveController.createSession("run21", "task21", "test", process as never);

    const detector = new PromptDetector();
    const results = detector.analyzeText("Continue? [y/n]");
    expect(results.isWaiting).toBe(true);

    // Emit the prompt_detected event manually (as executors do)
    bus.emit({
      type: "prompt_detected",
      runId: "run21",
      taskId: "task21",
      sessionId: id,
      executor: "test",
      promptType: "approval",
      promptText: "Continue? [y/n]",
      confidence: 0.95,
      requiresSecureInput: false,
    } as never);

    const promptEvents = eventSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === "prompt_detected",
    );
    expect(promptEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PromptDetector extended patterns", () => {
  it("should detect 'Proceed?' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Proceed?");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect 'Confirm?' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Confirm?");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect 'Should I proceed' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Should I proceed with the changes?");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect 'Approve changes' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Approve changes?");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect 'Type your message:' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Type your message:");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("input");
  });

  it("should detect 'Enter to continue' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Enter to continue");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("input");
  });

  it("should detect 'Select an option' prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Select an option from the menu");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("input");
  });

  it("should detect OAuth style prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Please authorize the device via OAuth");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("oauth");
  });

  it("should detect 'Allow' prompts as low confidence approval", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Allow");
    expect(result.bestPrompt?.type).toBe("approval");
    expect(result.bestPrompt!.confidence).toBeLessThan(0.8);
  });

  it("should detect API key prompts as secure", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("API Key:");
    expect(result.bestPrompt?.requiresSecureInput).toBe(true);
  });

  it("should return silence status after timeout", () => {
    const detector = new PromptDetector(1000, 5000);
    detector.recordOutput();
    const isSilent = detector.isSilent(Date.now() + 2000);
    expect(isSilent).toBe(true);
  });

  it("should not report silence before threshold", () => {
    const detector = new PromptDetector(5000, 10000);
    detector.recordOutput();
    const isSilent = detector.isSilent(Date.now() + 100);
    expect(isSilent).toBe(false);
  });

  it("should detect stuck state after longer timeout", () => {
    const detector = new PromptDetector(100, 200);
    detector.recordOutput();
    const isStuck = detector.isStuck(Date.now() + 300);
    expect(isStuck).toBe(true);
  });

  it("should not detect stuck before threshold", () => {
    const detector = new PromptDetector(5000, 10000);
    detector.recordOutput();
    const isStuck = detector.isStuck(Date.now() + 100);
    expect(isStuck).toBe(false);
  });

  it("should return silence elapsed time", () => {
    const detector = new PromptDetector(100, 200);
    detector.recordOutput();
    const elapsed = detector.silenceElapsed(Date.now() + 150);
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it("should suggest default 'y' for approval prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Continue? [y/n]");
    expect(result.bestPrompt?.suggestedDefault).toBe("y");
  });

  it("should not suggest default for input prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Enter your name:");
    expect(result.bestPrompt?.suggestedDefault).toBeUndefined();
  });

  it("should not suggest default for password prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Password:");
    expect(result.bestPrompt?.suggestedDefault).toBeUndefined();
  });
});
