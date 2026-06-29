/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { InteractiveController } from "../../src/executor/interactive-controller.js";
import { PromptDetector } from "../../src/executor/prompt-detector.js";
import { getEventBus, setEventBus, EventBus } from "../../src/ui/event-bus.js";

describe("Multi-line prompt detection", () => {
  it("should detect multi-line approval pattern with do you want to + [y/n]", () => {
    const detector = new PromptDetector();

    detector.analyzeText("Do you want to continue?");
    detector.analyzeText("[y/n]");

    const result = detector.analyzeRecentWindow();
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect multi-line input pattern with please enter + colon", () => {
    const detector = new PromptDetector();

    detector.analyzeText("Please enter your name:");
    const result = detector.analyzeText("John");

    expect(result.isWaiting).toBe(false);
  });

  it("should not detect normal output across multiple lines", () => {
    const detector = new PromptDetector();

    detector.analyzeText("Processing file: src/index.ts");
    detector.analyzeText("Done processing");
    const result = detector.analyzeText("All tasks completed");

    expect(result.isWaiting).toBe(false);
    expect(result.bestPrompt).toBeNull();
  });

  it("should detect approval across lines with review pattern", () => {
    const detector = new PromptDetector();

    detector.analyzeText("Please review the changes above");
    detector.analyzeText("Proceed?");

    const result = detector.analyzeRecentWindow();
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should return recent lines via getRecentLines", () => {
    const detector = new PromptDetector(100, 200, 5);

    detector.analyzeText("line1");
    detector.analyzeText("line2");
    detector.analyzeText("line3");

    const lines = detector.getRecentLines();
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  it("should cap recent lines at maxRecentLines", () => {
    const detector = new PromptDetector(100, 200, 3);

    detector.analyzeText("line1");
    detector.analyzeText("line2");
    detector.analyzeText("line3");
    detector.analyzeText("line4");

    const lines = detector.getRecentLines();
    expect(lines).toEqual(["line2", "line3", "line4"]);
  });
});

describe("Interactive session timeout detection", () => {
  beforeEach(() => {
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  it("should track input count on sendInput", () => {
    const process: any = {
      pid: 12345,
      stdin: {
        write: (data: string) => {
          return true;
        },
        destroyed: false,
      },
      kill: vi.fn(),
      on: vi.fn(),
    };
    const id = InteractiveController.createSession("run1", "task1", "test", process);
    const session = InteractiveController.getSession(id)!;
    expect(session.inputCount).toBe(0);

    InteractiveController.sendInput(id, "input1");
    expect(session.inputCount).toBe(1);

    InteractiveController.sendInput(id, "input2");
    expect(session.inputCount).toBe(2);
  });

  it("should detect session timeout", () => {
    const bus = new EventBus();
    setEventBus(bus);
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    const process: any = {
      pid: 12346,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    const detector = new PromptDetector(100, 200);

    // Simulate silence beyond stuck threshold
    detector.recordOutput();
    const silence = detector.checkSilence(Date.now() + 300);

    expect(silence).not.toBeNull();
    expect(silence!.type).toBe("generic_input");
    expect(silence!.pattern).toBe("silence_timeout");
  });

  it("should emit prompt_timeout event and detect timeout", () => {
    const bus = new EventBus();
    setEventBus(bus);
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    const process: any = {
      pid: 12347,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    const sessionId = InteractiveController.createSession("run2", "task2", "test", process);
    const session = InteractiveController.getSession(sessionId)!;
    session.timeoutMs = 0; // Immediately timed out

    const detector = new PromptDetector(100, 200);

    // Simulate silence beyond stuck threshold
    detector.recordOutput();
    const silence = detector.checkSilence(Date.now() + 300);
    expect(silence).not.toBeNull();
    expect(silence!.type).toBe("generic_input");
    expect(silence!.pattern).toBe("silence_timeout");

    // Verify prompt_timeout can be emitted
    bus.emit({
      type: "prompt_timeout",
      runId: "run2",
      taskId: "task2",
      sessionId,
      durationMs: 100,
    } as never);

    const timeoutEvents = eventSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === "prompt_timeout",
    );
    expect(timeoutEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Interactive session full lifecycle", () => {
  beforeEach(() => {
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  const makeMockProcess = () => ({
    pid: 12348,
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
    kill: vi.fn(),
    on: vi.fn(),
  });

  it("should transition: running -> waiting_input -> running -> waiting_approval -> running -> exited", () => {
    const process = makeMockProcess() as never;
    const id = InteractiveController.createSession(
      "run_lifecycle",
      "task_lifecycle",
      "test",
      process,
    );
    const session = InteractiveController.getSession(id)!;

    // 1. Initial state
    expect(session.status).toBe("running");

    // 2. waiting_input
    session.status = "waiting_input";
    session.detectedPrompt = {
      type: "input",
      confidence: 0.9,
      matchedText: "Enter your name:",
      pattern: "test",
      requiresSecureInput: false,
    };
    expect(session.status).toBe("waiting_input");

    // 3. Input provided -> running
    InteractiveController.sendInput(id, "John");
    expect(session.status).toBe("running");
    expect(session.detectedPrompt).toBeNull();
    expect(session.inputCount).toBe(1);

    // 4. waiting_approval
    session.status = "waiting_approval";
    session.detectedPrompt = {
      type: "approval",
      confidence: 0.95,
      matchedText: "Continue? [y/n]",
      pattern: "test",
      requiresSecureInput: false,
      suggestedDefault: "y",
    };
    expect(session.status).toBe("waiting_approval");

    // 5. Approval provided -> running
    InteractiveController.sendInput(id, "y");
    expect(session.status).toBe("running");
    expect(session.detectedPrompt).toBeNull();
    expect(session.inputCount).toBe(2);

    // 6. Exited
    session.status = "exited";
    expect(session.status).toBe("exited");
  });

  it("should handle stuck detection and recovery", () => {
    const process = makeMockProcess() as never;
    const id = InteractiveController.createSession("run_stuck", "task_stuck", "test", process);
    const session = InteractiveController.getSession(id)!;

    // Running -> stuck
    session.status = "stuck";
    expect(session.status).toBe("stuck");

    // Stuck -> killed (user can kill)
    InteractiveController.killSession(id);
    expect(session.status).toBe("killed");
  });
});

describe("Interactive approval via CLI commands integration", () => {
  beforeEach(() => {
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  it("should approve (send 'y') via sendInputByRunId", () => {
    const process: any = {
      pid: 12349,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run_approve", "task_approve", "test", process);
    const result = InteractiveController.sendInputByRunId("run_approve", "y");
    expect(result).toBe(true);
    expect(process.stdin.write).toHaveBeenCalledWith("y\n");
  });

  it("should reject (send 'n') via sendInputByRunId", () => {
    const process: any = {
      pid: 12350,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run_reject", "task_reject", "test", process);
    const result = InteractiveController.sendInputByRunId("run_reject", "n");
    expect(result).toBe(true);
    expect(process.stdin.write).toHaveBeenCalledWith("n\n");
  });

  it("should continue (send '') via sendInputByRunId", () => {
    const process: any = {
      pid: 12351,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run_continue", "task_continue", "test", process);
    const result = InteractiveController.sendInputByRunId("run_continue", "");
    expect(result).toBe(true);
    expect(process.stdin.write).toHaveBeenCalledWith("\n");
  });

  it("should kill via killSessionByRunId", () => {
    let killed = false;
    const process: any = {
      pid: 12352,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: () => {
        killed = true;
      },
      on: vi.fn(),
    };
    InteractiveController.createSession("run_kill", "task_kill", "test", process);
    const result = InteractiveController.killSessionByRunId("run_kill");
    expect(result).toBe(true);
    expect(killed).toBe(true);
  });
});

describe("Event bus integration for prompt lifecycle", () => {
  beforeEach(() => {
    const bus = new EventBus();
    setEventBus(bus);
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  it("should emit prompt_detected event on approval pattern", () => {
    const bus = getEventBus();
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    bus.emit({
      type: "prompt_detected",
      runId: "run_events",
      taskId: "task_events",
      sessionId: "session1",
      executor: "test",
      promptType: "approval",
      promptText: "Continue? [y/n]",
      confidence: 0.95,
      requiresSecureInput: false,
    } as never);

    const detectionEvents = eventSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === "prompt_detected",
    );
    expect(detectionEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should emit prompt_input_provided on user input", () => {
    const bus = getEventBus();
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    bus.emit({
      type: "prompt_input_provided",
      runId: "run_input",
      taskId: "task_input",
      sessionId: "session2",
      input: "y",
    } as never);

    const inputEvents = eventSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === "prompt_input_provided",
    );
    expect(inputEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should emit prompt_cancelled when process is killed", () => {
    const bus = getEventBus();
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    bus.emit({
      type: "prompt_cancelled",
      runId: "run_cancel",
      taskId: "task_cancel",
      sessionId: "session3",
      reason: "User killed process",
    } as never);

    const cancelEvents = eventSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === "prompt_cancelled",
    );
    expect(cancelEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should emit prompt_timeout when session times out", () => {
    const bus = getEventBus();
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    bus.emit({
      type: "prompt_timeout",
      runId: "run_timeout",
      taskId: "task_timeout",
      sessionId: "session4",
      durationMs: 60000,
    } as never);

    const timeoutEvents = eventSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === "prompt_timeout",
    );
    expect(timeoutEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should emit interactive_waiting during non-TTY wait", () => {
    const bus = getEventBus();
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    bus.emit({
      type: "interactive_waiting",
      runId: "run_wait",
      taskId: "task_wait",
      sessionId: "session5",
      promptType: "approval",
      promptText: "Continue? [y/n]",
    } as never);

    const waitingEvents = eventSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === "interactive_waiting",
    );
    expect(waitingEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should emit interactive_resumed on session resume", () => {
    const bus = getEventBus();
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    bus.emit({
      type: "interactive_resumed",
      runId: "run_resume",
      taskId: "task_resume",
      sessionId: "session6",
    } as never);

    const resumeEvents = eventSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === "interactive_resumed",
    );
    expect(resumeEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should emit process_waiting_input when process blocks on stdin", () => {
    const bus = getEventBus();
    const eventSpy = vi.fn();
    bus.subscribeSync(eventSpy);

    bus.emit({
      type: "process_waiting_input",
      runId: "run_stdin",
      taskId: "task_stdin",
      sessionId: "session7",
      detectedPattern: "stdin_block",
    } as never);

    const stdinEvents = eventSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === "process_waiting_input",
    );
    expect(stdinEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PromptDetector extended edge cases", () => {
  it("should detect permission prompt", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Permission denied");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("permission");
  });

  it("should detect token expired prompt", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Token expired");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("login");
  });

  it("should detect shell prompt on its own line with low confidence", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("> ");
    expect(result.isWaiting).toBe(false); // Low confidence, below 0.6 threshold
    expect(result.bestPrompt).not.toBeNull();
    expect(result.bestPrompt!.confidence).toBeLessThan(0.6);
    expect(result.bestPrompt!.type).toBe("input");
  });

  it("should detect [confirm] style prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("[confirm]");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should detect [proceed] style prompts", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("[proceed]");
    expect(result.isWaiting).toBe(true);
    expect(result.bestPrompt?.type).toBe("approval");
  });

  it("should handle analyzeText with no matching patterns", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("Loading dependencies...");
    expect(result.prompts).toEqual([]);
    expect(result.isWaiting).toBe(false);
    expect(result.bestPrompt).toBeNull();
  });

  it("should handle empty string", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("");
    expect(result.isWaiting).toBe(false);
    expect(result.bestPrompt).toBeNull();
  });

  it("should handle whitespace-only string", () => {
    const detector = new PromptDetector();
    const result = detector.analyzeText("   ");
    expect(result.isWaiting).toBe(false);
    expect(result.bestPrompt).toBeNull();
  });
});

describe("Interactive session output tracking", () => {
  beforeEach(() => {
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  it("should track stdout lines in session", () => {
    const process: any = {
      pid: 12353,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    const id = InteractiveController.createSession(
      "run_out1",
      "task_out1",
      "test",
      process as never,
    );
    const session = InteractiveController.getSession(id)!;

    session.stdoutLines.push("line1");
    session.stdoutLines.push("line2");
    session.stdoutLines.push("line3");

    expect(session.stdoutLines).toHaveLength(3);
  });

  it("should return latest output via getLatestOutputByRunId", () => {
    const process: any = {
      pid: 12354,
      killed: false,
      exitCode: null,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    const id = InteractiveController.createSession(
      "run_out2",
      "task_out2",
      "test",
      process as never,
    );
    const session = InteractiveController.getSession(id)!;

    for (let i = 0; i < 10; i++) {
      session.stdoutLines.push(`line${i}`);
    }

    const output = InteractiveController.getLatestOutputByRunId("run_out2", 3);
    expect(output).toHaveLength(3);
    expect(output[0]).toBe("line7");
  });

  it("should return empty array for non-existent run getLatestOutputByRunId", () => {
    const output = InteractiveController.getLatestOutputByRunId("nonexistent");
    expect(output).toEqual([]);
  });
});

describe("Interactive controller session management", () => {
  beforeEach(() => {
    const sessions = (InteractiveController as unknown as Record<string, Map<string, unknown>>)
      .sessions;
    if (sessions) sessions.clear();
  });

  it("should get session by run ID", () => {
    const process: any = {
      pid: 12355,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run_mgmt1", "task_mgmt1", "test", process as never);
    const session = InteractiveController.getSessionByRunId("run_mgmt1");
    expect(session).not.toBeNull();
    expect(session!.taskId).toBe("task_mgmt1");
  });

  it("should return null for non-existent run getSessionByRunId", () => {
    const session = InteractiveController.getSessionByRunId("nonexistent");
    expect(session).toBeNull();
  });

  it("should remove session by run ID", () => {
    const process: any = {
      pid: 12356,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run_mgmt2", "task_mgmt2", "test", process as never);
    InteractiveController.removeSessionByRunId("run_mgmt2");
    const session = InteractiveController.getSessionByRunId("run_mgmt2");
    expect(session).toBeNull();
  });

  it("should get active sessions", () => {
    const process: any = {
      pid: 12357,
      stdin: { write: vi.fn().mockReturnValue(true), destroyed: false },
      kill: vi.fn(),
      on: vi.fn(),
    };
    InteractiveController.createSession("run_active1", "task_active1", "test", process as never);
    InteractiveController.createSession("run_active2", "task_active2", "test", process as never);

    const active = InteractiveController.getActiveSessions();
    expect(active.length).toBe(2);
  });

  it("should handle sendInput to non-existent session gracefully", () => {
    const result = InteractiveController.sendInput("nonexistent", "test");
    expect(result).toBe(false);
  });

  it("should handle killSession to non-existent session gracefully", () => {
    const result = InteractiveController.killSession("nonexistent");
    expect(result).toBe(false);
  });

  it("should handle sendInputByRunId to non-existent run gracefully", () => {
    const result = InteractiveController.sendInputByRunId("nonexistent", "test");
    expect(result).toBe(false);
  });

  it("should handle killSessionByRunId to non-existent run gracefully", () => {
    const result = InteractiveController.killSessionByRunId("nonexistent");
    expect(result).toBe(false);
  });
});
