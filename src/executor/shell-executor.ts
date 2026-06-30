import {
  type Executor,
  type ExecutorInput,
  type ExecutorResult,
  serializeOutputPlan,
} from "./executor.js";
import { spawn } from "node:child_process";
import { now } from "../utils/time.js";
import { getShell, getShellCommandFlag } from "../utils/shell.js";
import { getEventBus } from "../ui/event-bus.js";
import { LineBuffer } from "../utils/stream-lines.js";
import { SecretRedactor } from "../safety/secret-redactor.js";
import type { LogManager } from "../core/log-manager.js";
import { sanitizeCommand, buildChildEnv } from "../utils/command-sanitizer.js";
import { PromptDetector, type PromptDetectionResult } from "./prompt-detector.js";
import { InteractiveController } from "./interactive-controller.js";
import type { ProcessManager } from "../core/process-manager.js";
import Enquirer from "enquirer";

const STUCK_TIMEOUT_MS = 60000;
const MAX_OUTPUT_LINES = 10_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_LINE_LENGTH = 10_000;

function dedupeStdio(allLines: string[], newLine: string): boolean {
  if (allLines.length > 0 && allLines[allLines.length - 1] === newLine) {
    return false;
  }
  return true;
}

function truncateLine(line: string): string {
  if (line.length > MAX_LINE_LENGTH) {
    return line.slice(0, MAX_LINE_LENGTH - 3) + "...";
  }
  return line;
}

export class ShellExecutor implements Executor {
  name = "shell";
  private logManager?: LogManager;
  private processManager?: ProcessManager;

  setLogManager(lm: LogManager): void {
    this.logManager = lm;
  }

  setProcessManager(pm: ProcessManager): void {
    this.processManager = pm;
  }

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    const startedAt = now();
    const eventBus = getEventBus();
    const redactor = new SecretRedactor();
    const runId = input.runId;
    const taskId = input.task.id;
    const executorName = "shell";

    const commands = input.task.validation?.commands;
    if (!commands || commands.length === 0) {
      const msg = `No shell commands defined for task: ${input.task.title}`;
      return {
        status: "done",
        exitCode: 0,
        output: msg + "\n",
        startedAt,
        finishedAt: now(),
      };
    }

    const writeLog = async (stream: string, text: string): Promise<void> => {
      if (!this.logManager) return;
      try {
        await this.logManager.writeTaskLog(runId, taskId, `[${stream}] ${text}`);
      } catch {
        // non-critical
      }
    };

    const outputPlanStr = serializeOutputPlan(input.task.outputPlan);
    if (outputPlanStr) {
      writeLog("info", `[output-plan] ${outputPlanStr}`);
    }

    let command = commands.join(" && ");

    if (!input.allowShellMetachars) {
      const sanResult = sanitizeCommand(command);
      if (!sanResult.valid) {
        return {
          status: "failed",
          exitCode: 1,
          output: "",
          error: `Shell command rejected: ${sanResult.reason}`,
          errorEvidence: `Rejected command: ${commands.join(" && ")}`,
          suggestedFix: `Simplify the command or set allowShellMetachars to bypass. Rejection reason: ${sanResult.reason}`,
          startedAt,
          finishedAt: now(),
        };
      }
      command = sanResult.sanitized;
    }

    // Check if we already have an interactive session for this run (resume case)
    const existingSession = InteractiveController.getSessionByRunId(runId);
    if (existingSession && input.interactiveInput !== undefined) {
      return await this.handleExistingSession(existingSession.id, input, startedAt);
    }

    eventBus.emit({
      type: "executor_started",
      runId,
      taskId,
      executor: executorName,
      command: getShell(),
      args: [getShellCommandFlag(), command],
    });

    const releaseSpawn = this.processManager
      ? await this.processManager.acquireSpawnSlot(command)
      : () => {};

    try {
      return await new Promise<ExecutorResult>((resolve) => {
        let settled = false;
        const resolveOnce = (result: ExecutorResult): void => {
          if (settled) return;
          settled = true;
          releaseSpawn();
          resolve(result);
        };

        const child = spawn(getShell(), [getShellCommandFlag(), command], {
          cwd: input.projectRoot,
          env: buildChildEnv({
            ...input.env,
            FLOWTASK_TASK_ID: taskId,
            FLOWTASK_RUN_ID: runId,
            FLOWTASK_CONTEXT_PACK: input.contextPackContent,
            ...(outputPlanStr ? { FLOWTASK_OUTPUT_PLAN: outputPlanStr } : {}),
          }),
          stdio: ["pipe", "pipe", "pipe"],
          signal: input.signal,
          shell: false,
        });

        const isTty = process.stdin.isTTY === true;
        const promptDetector = new PromptDetector();
        const sessionId = InteractiveController.createSession(runId, taskId, executorName, child);
        let earlyResolve = false;

        if (this.processManager && child.pid) {
          this.processManager.registerChildProcess(runId, child);
        }

        // Keep stdin open for interactive input
        if (input.interactiveInput !== undefined && child.stdin && !child.stdin.destroyed) {
          try {
            child.stdin.write(input.interactiveInput + "\n");
          } catch {
            // stdin may be closed
          }
        }

        const stdoutLines: string[] = [];
        const stderrLines: string[] = [];
        let totalOutputBytes = 0;
        let outputLimitReached = false;

        const emitAndLog = (stream: "stdout" | "stderr", text: string): void => {
          if (outputLimitReached) return;

          const truncated = truncateLine(text);
          const safe = redactor.redact(truncated);
          const byteCost = Buffer.byteLength(safe, "utf-8");

          if (totalOutputBytes + byteCost > MAX_OUTPUT_BYTES) {
            outputLimitReached = true;
            const limitMsg = `\n[output limit reached: ${MAX_OUTPUT_BYTES} bytes]`;
            eventBus.emit({
              type: "executor_output",
              runId,
              taskId,
              executor: executorName,
              stream: "stderr",
              text: limitMsg,
            });
            writeLog("stderr", limitMsg);
            return;
          }

          totalOutputBytes += byteCost;
          eventBus.emit({
            type: "executor_output",
            runId,
            taskId,
            executor: executorName,
            stream,
            text: safe,
          });
          writeLog(stream, safe);
        };

        const handlePromptDetection = (result: PromptDetectionResult, line: string): void => {
          if (earlyResolve || !sessionId || !result.isWaiting || !result.bestPrompt) return;

          const session = InteractiveController.getSession(sessionId);
          if (!session) return;

          const waitStatus =
            result.bestPrompt.type === "approval"
              ? ("waiting_approval" as const)
              : ("waiting_input" as const);
          session.detectedPrompt = result.bestPrompt;
          session.status = waitStatus;

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

          const sessionAfter = InteractiveController.getSession(sessionId);
          if (!sessionAfter) return;

          if (isTty && child.stdin && !child.stdin.destroyed) {
            // Inline TTY: use enquirer to get user response
            const enquirer = new Enquirer();
            const promptLabel =
              result.bestPrompt.type === "approval"
                ? `AI process needs approval: "${line.trim()}"`
                : `AI process needs input: "${line.trim()}"`;

            enquirer
              .prompt({
                type:
                  result.bestPrompt.type === "approval" ? ("confirm" as const) : ("input" as const),
                name: "response",
                message: promptLabel,
              })
              .then((response: unknown) => {
                const resp = (response as Record<string, unknown>).response;
                const responseStr =
                  typeof resp === "boolean" ? (resp ? "y" : "n") : String(resp ?? "");
                if (child.stdin && !child.stdin.destroyed) {
                  try {
                    child.stdin.write(responseStr + "\n");
                    sessionAfter.status = "running";
                    sessionAfter.detectedPrompt = null;
                    sessionAfter.lastActivityAt = Date.now();
                  } catch {
                    // stdin may be closed
                  }
                }
              })
              .catch(() => {
                // Prompt cancelled, continue waiting
              });
          } else {
            // Non-TTY: resolve early with waiting status
            earlyResolve = true;
            eventBus.emit({
              type: "interactive_waiting",
              runId,
              taskId,
              sessionId,
              promptType: result.bestPrompt.type,
              promptText: line.trim(),
            } as never);

            resolveOnce({
              status: waitStatus,
              output: stdoutLines.join("\n"),
              error: stderrLines.join("\n") || undefined,
              startedAt,
              finishedAt: now(),
              interactiveSessionId: sessionId,
              detectedPrompt: result.bestPrompt.matchedText,
            });
          }
        };

        const pushLine = (
          buf: LineBuffer,
          lines: string[],
          stream: "stdout" | "stderr",
          line: string,
        ): void => {
          if (!dedupeStdio(lines, line)) return;
          if (lines.length >= MAX_OUTPUT_LINES) return;
          lines.push(line);
          emitAndLog(stream, line);

          if (promptDetector && !earlyResolve) {
            promptDetector.recordOutput();
            const result = promptDetector.analyzeText(line);
            handlePromptDetection(result, line);
          }
        };

        if (child.stdout) {
          const stdoutBuf = new LineBuffer((line) => {
            pushLine(stdoutBuf, stdoutLines, "stdout", line);
          });
          child.stdout.on("data", (data: Buffer) => stdoutBuf.push(data));
          child.stdout.on("end", () => stdoutBuf.flush());
        }

        if (child.stderr) {
          const stderrBuf = new LineBuffer((line) => {
            pushLine(stderrBuf, stderrLines, "stderr", line);
          });
          child.stderr.on("data", (data: Buffer) => stderrBuf.push(data));
          child.stderr.on("end", () => stderrBuf.flush());
        }

        const stuckCheck = setInterval(() => {
          if (promptDetector && sessionId && !earlyResolve) {
            const now_time = Date.now();
            if (promptDetector.isStuck(now_time)) {
              const session = InteractiveController.getSession(sessionId);
              if (session) {
                session.status = "stuck";
              }

              eventBus.emit({
                type: "prompt_detected",
                runId,
                taskId,
                sessionId,
                executor: executorName,
                promptType: "generic_input",
                promptText: `No output for ${Math.floor(promptDetector.silenceElapsed(now_time) / 1000)}s`,
                confidence: 0.3,
                requiresSecureInput: false,
              } as never);
            }
          }
        }, STUCK_TIMEOUT_MS / 4);

        child.on("close", (exitCode) => {
          clearInterval(stuckCheck);

          if (sessionId) {
            const session = InteractiveController.getSession(sessionId);
            if (session) {
              session.status = "exited";
              session.detectedPrompt = null;
            }
            InteractiveController.removeSession(sessionId);
          }

          if (this.processManager) {
            this.processManager.unregisterChildProcess(runId);
          }

          eventBus.emit({
            type: "executor_exited",
            runId,
            taskId,
            executor: executorName,
            exitCode,
          });

          if (!earlyResolve) {
            const stderrText = stderrLines.join("\n");
            const stdoutText = stdoutLines.join("\n");
            const isFailed = exitCode !== 0 && exitCode !== null;
            resolveOnce({
              status: exitCode === 0 ? "done" : "failed",
              exitCode: exitCode ?? undefined,
              output: stdoutText,
              error: stderrText || undefined,
              errorEvidence: isFailed
                ? `Exit code: ${exitCode}. ${stderrText ? `Stderr: ${stderrText.slice(0, 2000)}` : ""}${stdoutText ? `\nLast output lines: ${stdoutText.split("\n").slice(-5).join("\n")}` : ""}`
                : undefined,
              suggestedFix: isFailed
                ? "The command exited with a non-zero code. Review the error output and fix the issue before retrying."
                : undefined,
              startedAt,
              finishedAt: now(),
              interactiveSessionId: sessionId,
            });
          } else {
            releaseSpawn();
          }
        });

        child.on("error", (err) => {
          clearInterval(stuckCheck);

          if (sessionId) {
            InteractiveController.removeSession(sessionId);
          }

          if (this.processManager) {
            this.processManager.unregisterChildProcess(runId);
          }

          eventBus.emit({
            type: "executor_failed",
            runId,
            taskId,
            executor: executorName,
            reason: err.message,
          });

          const isMissing = err.message.includes("ENOENT") || err.message.includes("not found");
          const isPermission = err.message.includes("EACCES") || err.message.includes("EPERM");
          const isTimeout = err.message.includes("ETIMEDOUT");

          if (!earlyResolve) {
            resolveOnce({
              status: "failed",
              exitCode: undefined,
              error: err.message,
              errorEvidence: `Process error: ${err.message}${err.stack ? `\n${err.stack}` : ""}`,
              suggestedFix: isMissing
                ? `Command not found. Install the required tool or check your PATH.`
                : isPermission
                  ? "Permission denied. Check file permissions or run with appropriate privileges."
                  : isTimeout
                    ? `The command timed out. Consider increasing the timeout.`
                    : `An unexpected error occurred. Check the command and retry.`,
              startedAt,
              finishedAt: now(),
            });
          } else {
            releaseSpawn();
          }
        });
      });
    } catch (err) {
      releaseSpawn();
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes("timeout") || message.includes("ETIMEDOUT");

      eventBus.emit({
        type: "executor_failed",
        runId,
        taskId,
        executor: executorName,
        reason: message,
      });

      return {
        status: isTimeout ? "timeout" : "failed",
        error: message,
        errorEvidence: err instanceof Error ? err.stack : undefined,
        suggestedFix: isTimeout
          ? "The operation timed out. Increase the timeout or split the work into smaller tasks."
          : undefined,
        startedAt,
        finishedAt: now(),
      };
    }
  }

  private async handleExistingSession(
    sessionId: string,
    input: ExecutorInput,
    startedAt: string,
  ): Promise<ExecutorResult> {
    const eventBus = getEventBus();
    const runId = input.runId;
    const taskId = input.task.id;

    // Send the pending input
    if (input.interactiveInput !== undefined) {
      InteractiveController.sendInput(sessionId, input.interactiveInput);
    }

    eventBus.emit({
      type: "interactive_resumed",
      runId,
      taskId,
      sessionId,
    } as never);

    // Wait for the process to finish
    const exitResult = await InteractiveController.waitForProcessExit(sessionId);

    const session = InteractiveController.getSession(sessionId);
    const stdout = session?.stdoutLines ?? [];
    const stderr = session?.stderrLines ?? [];

    if (sessionId) {
      InteractiveController.removeSession(sessionId);
    }

    eventBus.emit({
      type: "executor_exited",
      runId,
      taskId,
      executor: "shell",
      exitCode: exitResult.exitCode,
    });

    return {
      status: exitResult.exitCode === 0 ? "done" : "failed",
      exitCode: exitResult.exitCode ?? undefined,
      output: stdout.join("\n"),
      error: stderr.join("\n") || undefined,
      startedAt,
      finishedAt: now(),
    };
  }
}
