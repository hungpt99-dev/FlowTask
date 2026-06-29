import type { ChildProcess } from "node:child_process";
import {
  PromptDetector,
  type DetectedPrompt,
  type PromptDetectionResult,
} from "./prompt-detector.js";
import { getEventBus } from "../ui/event-bus.js";
import { LineBuffer } from "../utils/stream-lines.js";
import { now } from "../utils/time.js";

export type InteractiveStatus =
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "stuck"
  | "completed"
  | "killed"
  | "exited";

export interface InteractiveSession {
  id: string;
  runId: string;
  taskId: string;
  executorName: string;
  process: ChildProcess;
  status: InteractiveStatus;
  detectedPrompt: DetectedPrompt | null;
  stdoutLines: string[];
  stderrLines: string[];
  createdAt: number;
  lastActivityAt: number;
  inputCount: number;
  timeoutMs?: number;
}

export class InteractiveController {
  private static sessions: Map<string, InteractiveSession> = new Map();
  private static sessionCounter = 0;

  static createSession(
    runId: string,
    taskId: string,
    executorName: string,
    process: ChildProcess,
  ): string {
    const id = `interactive-${++InteractiveController.sessionCounter}`;
    const session: InteractiveSession = {
      id,
      runId,
      taskId,
      executorName,
      process,
      status: "running",
      detectedPrompt: null,
      stdoutLines: [],
      stderrLines: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      inputCount: 0,
    };
    InteractiveController.sessions.set(id, session);
    return id;
  }

  static getSession(sessionId: string): InteractiveSession | null {
    return InteractiveController.sessions.get(sessionId) ?? null;
  }

  static getSessionByRunId(runId: string): InteractiveSession | null {
    for (const session of InteractiveController.sessions.values()) {
      if (session.runId === runId) return session;
    }
    return null;
  }

  static removeSession(sessionId: string): void {
    InteractiveController.sessions.delete(sessionId);
  }

  static removeSessionByRunId(runId: string): void {
    for (const [id, session] of InteractiveController.sessions) {
      if (session.runId === runId) {
        InteractiveController.sessions.delete(id);
      }
    }
  }

  static sendInput(sessionId: string, input: string): boolean {
    const session = InteractiveController.sessions.get(sessionId);
    if (!session) return false;
    const { process } = session;
    if (!process.stdin || process.stdin.destroyed) return false;
    try {
      process.stdin.write(input + "\n");
      session.status = "running";
      session.detectedPrompt = null;
      session.lastActivityAt = Date.now();
      session.inputCount++;
      InteractiveController.notifyInputReceived(sessionId, input);
      return true;
    } catch {
      return false;
    }
  }

  static sendInputByRunId(runId: string, input: string): boolean {
    const session = InteractiveController.getSessionByRunId(runId);
    if (!session) return false;
    return InteractiveController.sendInput(session.id, input);
  }

  static killSession(sessionId: string): boolean {
    const session = InteractiveController.sessions.get(sessionId);
    if (!session) return false;
    try {
      if (!session.process.killed) {
        session.process.kill("SIGTERM");
        setTimeout(() => {
          if (!session.process.killed) {
            try {
              session.process.kill("SIGKILL");
            } catch {
              /* ignore */
            }
          }
        }, 3000);
      }
      session.status = "killed";
      session.lastActivityAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  static killSessionByRunId(runId: string): boolean {
    const session = InteractiveController.getSessionByRunId(runId);
    if (!session) return false;
    return InteractiveController.killSession(session.id);
  }

  static getActiveSessions(): InteractiveSession[] {
    return Array.from(InteractiveController.sessions.values());
  }

  static getStatusByRunId(runId: string): InteractiveStatus | null {
    const session = InteractiveController.getSessionByRunId(runId);
    return session?.status ?? null;
  }

  static getLatestOutputByRunId(runId: string, lines = 20): string[] {
    const session = InteractiveController.getSessionByRunId(runId);
    if (!session) return [];
    const all = [...session.stdoutLines, ...session.stderrLines];
    return all.slice(-lines);
  }

  static isSessionAlive(sessionId: string): boolean {
    const session = InteractiveController.sessions.get(sessionId);
    if (!session) return false;
    return !session.process.killed && session.process.exitCode === null;
  }

  static isSessionAliveByRunId(runId: string): boolean {
    const session = InteractiveController.getSessionByRunId(runId);
    if (!session) return false;
    return !session.process.killed && session.process.exitCode === null;
  }

  static async waitForProcessExit(
    sessionId: string,
  ): Promise<{ exitCode: number | null; signal: string | null }> {
    const session = InteractiveController.sessions.get(sessionId);
    if (!session) return { exitCode: null, signal: null };
    if (session.process.exitCode !== null) {
      return { exitCode: session.process.exitCode, signal: session.process.signalCode };
    }
    return new Promise((resolve) => {
      session.process.on("close", (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    });
  }

  static async waitForProcessExitByRunId(
    runId: string,
  ): Promise<{ exitCode: number | null; signal: string | null }> {
    const session = InteractiveController.getSessionByRunId(runId);
    if (!session) return { exitCode: null, signal: null };
    return InteractiveController.waitForProcessExit(session.id);
  }

  static async waitForInputOrTimeout(
    sessionId: string,
    timeoutMs = 300000,
  ): Promise<{ action: "input_received" | "timeout" | "process_exited"; input?: string }> {
    const session = InteractiveController.sessions.get(sessionId);
    if (!session) return { action: "process_exited" };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({ action: "timeout" });
      }, timeoutMs);

      const checkInterval = setInterval(() => {
        const current = InteractiveController.sessions.get(sessionId);
        if (!current) {
          cleanup();
          resolve({ action: "process_exited" });
          return;
        }
        if (current.status === "completed" || current.status === "killed") {
          cleanup();
          resolve({ action: "process_exited" });
          return;
        }
        if (current.status === "running" && !current.detectedPrompt) {
          cleanup();
          resolve({ action: "input_received" });
          return;
        }
      }, 500);

      const inputHandler = (input: string): void => {
        cleanup();
        resolve({ action: "input_received", input });
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        InteractiveController.removeInputHandler(sessionId, inputHandler);
      };

      InteractiveController.addInputHandler(sessionId, inputHandler);
    });
  }

  private static inputHandlers: Map<string, Array<(input: string) => void>> = new Map();

  private static addInputHandler(sessionId: string, handler: (input: string) => void): void {
    const handlers = InteractiveController.inputHandlers.get(sessionId) ?? [];
    handlers.push(handler);
    InteractiveController.inputHandlers.set(sessionId, handlers);
  }

  private static removeInputHandler(sessionId: string, handler: (input: string) => void): void {
    const handlers = InteractiveController.inputHandlers.get(sessionId);
    if (!handlers) return;
    const filtered = handlers.filter((h) => h !== handler);
    if (filtered.length === 0) {
      InteractiveController.inputHandlers.delete(sessionId);
    } else {
      InteractiveController.inputHandlers.set(sessionId, filtered);
    }
  }

  static notifyInputReceived(sessionId: string, input: string): void {
    const handlers = InteractiveController.inputHandlers.get(sessionId);
    if (handlers) {
      for (const handler of handlers) {
        handler(input);
      }
      InteractiveController.inputHandlers.delete(sessionId);
    }
  }
}

export function createInteractiveOutputHandler(
  sessionId: string,
  promptDetector: PromptDetector,
  runId: string,
  taskId: string,
  executorName: string,
  onPromptDetected?: (prompt: DetectedPrompt) => void,
): {
  stdoutLineBuffer: LineBuffer;
  stderrLineBuffer: LineBuffer;
  onProcessExit: () => void;
  getLatestPrompt: () => PromptDetectionResult | null;
  checkTimeout: () => DetectedPrompt | null;
  handleSilence: (currentTime: number) => DetectedPrompt | null;
} {
  let latestPromptResult: PromptDetectionResult | null = null;
  const eventBus = getEventBus();

  const handleLine = (stream: "stdout" | "stderr", line: string): void => {
    promptDetector.recordOutput();
    const session = InteractiveController.getSession(sessionId);
    if (session) {
      if (stream === "stdout") session.stdoutLines.push(line);
      else session.stderrLines.push(line);
      session.lastActivityAt = Date.now();
    }

    const result = promptDetector.analyzeText(line);
    if (result.isWaiting && result.bestPrompt) {
      latestPromptResult = result;
      if (session) {
        session.detectedPrompt = result.bestPrompt;
        const waitStatus =
          result.bestPrompt.type === "approval"
            ? ("waiting_approval" as const)
            : ("waiting_input" as const);
        session.status = waitStatus;
      }

      eventBus.emit({
        type: "prompt_detected",
        runId,
        taskId,
        sessionId,
        executor: executorName,
        promptType: result.bestPrompt.type,
        promptText: line.trim(),
        confidence: result.bestPrompt.confidence,
        requiresSecureInput: result.bestPrompt.requiresSecureInput,
      } as never);

      if (onPromptDetected && result.bestPrompt) {
        onPromptDetected(result.bestPrompt);
      }
    }
  };

  const stdoutLineBuffer = new LineBuffer((line) => {
    handleLine("stdout", line);
  });

  const stderrLineBuffer = new LineBuffer((line) => {
    handleLine("stderr", line);
  });

  return {
    stdoutLineBuffer,
    stderrLineBuffer,
    onProcessExit: () => {
      const session = InteractiveController.getSession(sessionId);
      if (session) {
        session.status = "exited";
        session.detectedPrompt = null;
        session.lastActivityAt = Date.now();
      }
    },
    getLatestPrompt: () => latestPromptResult,
    checkTimeout: (): DetectedPrompt | null => {
      const session = InteractiveController.getSession(sessionId);
      if (!session || !session.timeoutMs) return null;
      const elapsed = Date.now() - session.createdAt;
      if (elapsed >= session.timeoutMs) {
        eventBus.emit({
          type: "prompt_timeout",
          runId,
          taskId,
          sessionId,
          durationMs: elapsed,
        } as never);
        return {
          type: "generic_input",
          confidence: 0.3,
          matchedText: `Session timed out after ${Math.floor(elapsed / 1000)}s`,
          pattern: "session_timeout",
          requiresSecureInput: false,
          suggestedDefault: "",
        };
      }
      return null;
    },
    handleSilence: (currentTime: number): DetectedPrompt | null => {
      const silence = promptDetector.checkSilence(currentTime);
      if (silence) {
        const session = InteractiveController.getSession(sessionId);
        if (session) {
          session.status = "stuck";
          session.detectedPrompt = silence;
        }
        eventBus.emit({
          type: "prompt_detected",
          runId,
          taskId,
          sessionId,
          executor: executorName,
          promptType: silence.type,
          promptText: silence.matchedText,
          confidence: silence.confidence,
          requiresSecureInput: false,
        } as never);
      }
      return silence;
    },
  };
}
