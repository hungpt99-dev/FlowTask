import {
  type Executor,
  type ExecutorInput,
  type ExecutorResult,
  serializeOutputPlan,
} from "./executor.js";
import { spawn } from "node:child_process";
import { now } from "../utils/time.js";
import type { ExecutorEntry } from "../schemas/config.schema.js";
import { ProcessManager } from "../core/process-manager.js";
import { LogManager } from "../core/log-manager.js";
import { buildCommandArgs } from "./build-command-args.js";
import { getEventBus } from "../ui/event-bus.js";
import { LineBuffer } from "../utils/stream-lines.js";
import { SecretRedactor } from "../safety/secret-redactor.js";
import { buildChildEnv } from "../utils/command-sanitizer.js";
import { PromptDetector, type PromptDetectionResult } from "./prompt-detector.js";
import { InteractiveController } from "./interactive-controller.js";
import Enquirer from "enquirer";

const STUCK_TIMEOUT_MS = 60000;

export class CommandExecutor implements Executor {
  name = "command";
  private configEntry: ExecutorEntry;
  private processManager?: ProcessManager;
  private logManager?: LogManager;

  constructor(configEntry: ExecutorEntry) {
    this.configEntry = configEntry;
    this.name = configEntry.command ?? "command";
  }

  setProcessManager(pm: ProcessManager): void {
    this.processManager = pm;
  }

  setLogManager(lm: LogManager): void {
    this.logManager = lm;
  }

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    const startedAt = now();
    const args = [...(this.configEntry.args ?? [])];
    const cmd = this.configEntry.command ?? "";
    const inputMode = this.configEntry.inputMode ?? "stdin";
    const timeoutMs = this.configEntry.timeoutMs ?? 1800000;

    if (!cmd) {
      return {
        status: "failed",
        error: "No command configured for executor",
        errorEvidence: `Executor name: ${this.name}`,
        suggestedFix: `Configure a command for executor "${this.name}" in .flowtask/config.json.`,
        startedAt,
        finishedAt: now(),
      };
    }

    const { args: finalArgs, stdin } = buildCommandArgs({
      args,
      inputMode,
      contextPackContent: input.contextPackContent,
      contextPackPath: input.contextPackPath,
      fileArg: this.configEntry.fileArg,
    });

    const eventBus = getEventBus();
    const redactor = new SecretRedactor();
    const runId = input.runId;
    const taskId = input.task.id;
    const executorName = this.name;

    const redact = (text: string): string => redactor.redact(text);

    const writeLog = async (stream: string, text: string): Promise<void> => {
      if (!this.logManager) return;
      try {
        await this.logManager.writeTaskLog(runId, taskId, `[${stream}] ${text}`);
      } catch {
        // log writes are non-critical
      }
    };

    const outputPlanStr = serializeOutputPlan(input.task.outputPlan);
    if (outputPlanStr) {
      writeLog("info", `[output-plan] ${outputPlanStr}`);
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
      command: cmd,
      args: finalArgs,
    });

    const releaseSpawn = this.processManager
      ? await this.processManager.acquireSpawnSlot(cmd)
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

        const child = spawn(cmd, finalArgs, {
          cwd: input.projectRoot,
          env: buildChildEnv({
            ...input.env,
            FLOWTASK_CONTEXT_PACK: input.contextPackContent,
            FLOWTASK_TASK_ID: taskId,
            FLOWTASK_RUN_ID: runId,
            ...(outputPlanStr ? { FLOWTASK_OUTPUT_PLAN: outputPlanStr } : {}),
          }),
          stdio: ["pipe", "pipe", "pipe"],
          signal: input.signal,
          timeout: timeoutMs,
          shell: false,
        });

        const isTty = process.stdin.isTTY === true;
        const canInteract = inputMode !== "stdin" || isTty;

        const promptDetector = new PromptDetector();
        const sessionId = InteractiveController.createSession(runId, taskId, executorName, child);
        let earlyResolve = false;

        if (this.processManager && child.pid) {
          this.processManager.registerChildProcess(runId, child);
          this.processManager
            .save(runId, {
              runId,
              taskId,
              pid: child.pid,
              executor: executorName,
              command: cmd,
              args: finalArgs,
              startedAt,
              status: "running",
            })
            .catch((err) => {
              if (this.logManager) {
                this.logManager.writeTaskLog(
                  runId,
                  taskId,
                  `[warn] failed to save process state: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            });
        }

        // Handle initial stdin
        if (stdin !== undefined) {
          child.stdin?.write(stdin);
          child.stdin?.end();
        } else if (!canInteract) {
          child.stdin?.end();
        }
        // Keep stdin open if canInteract

        // Handle interactive input if provided in resume case
        if (input.interactiveInput !== undefined && child.stdin && !child.stdin.destroyed) {
          try {
            child.stdin.write(input.interactiveInput + "\n");
          } catch {
            // stdin may be closed
          }
        }

        const stdoutLines: string[] = [];
        const stderrLines: string[] = [];
        let spawnError: string | undefined;
        let detectedPromptText: string | undefined;

        const emitAndLog = (stream: "stdout" | "stderr", text: string): void => {
          const safe = redact(text);
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

          detectedPromptText = result.bestPrompt.matchedText;
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
              error: stderrLines.join("\n") || spawnError,
              startedAt,
              finishedAt: now(),
              interactiveSessionId: sessionId,
              detectedPrompt: detectedPromptText,
            });
          }
        };

        if (child.stdout) {
          const stdoutBuf = new LineBuffer((line) => {
            stdoutLines.push(line);
            emitAndLog("stdout", line);

            if (promptDetector && !earlyResolve) {
              promptDetector.recordOutput();
              const result = promptDetector.analyzeText(line);
              handlePromptDetection(result, line);
            }
          });
          child.stdout.on("data", (data: Buffer) => stdoutBuf.push(data));
          child.stdout.on("end", () => stdoutBuf.flush());
        }

        if (child.stderr) {
          const stderrBuf = new LineBuffer((line) => {
            stderrLines.push(line);
            emitAndLog("stderr", line);

            if (promptDetector && !earlyResolve) {
              promptDetector.recordOutput();
              const result = promptDetector.analyzeText(line);
              handlePromptDetection(result, line);
            }
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
            this.processManager.clear(runId, runId).catch((err) => {
              if (this.logManager) {
                this.logManager.writeTaskLog(
                  runId,
                  taskId,
                  `[warn] failed to clear process state: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            });
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
              error: stderrText || spawnError,
              errorEvidence: isFailed
                ? `Exit code: ${exitCode}. ${spawnError ? `Spawn error: ${spawnError}` : ""}${stderrText ? `\nStderr: ${stderrText.slice(0, 2000)}` : ""}`
                : undefined,
              suggestedFix: isFailed
                ? "The command exited with a non-zero code. Review the error output and fix the issue."
                : undefined,
              startedAt,
              finishedAt: now(),
              interactiveSessionId: sessionId,
              detectedPrompt: detectedPromptText,
            });
          } else {
            releaseSpawn();
          }
        });

        child.on("error", (err) => {
          clearInterval(stuckCheck);
          spawnError = err.message;

          if (sessionId) {
            InteractiveController.removeSession(sessionId);
          }

          if (this.processManager) {
            this.processManager.unregisterChildProcess(runId);
            this.processManager.clear(runId, runId).catch((e) => {
              if (this.logManager) {
                this.logManager.writeTaskLog(
                  runId,
                  taskId,
                  `[warn] failed to clear process state on error: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            });
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

          if (!earlyResolve) {
            resolveOnce({
              status: "failed",
              exitCode: undefined,
              error: err.message,
              errorEvidence: `Process spawn error: ${err.message}`,
              suggestedFix: isMissing
                ? `Command "${cmd}" not found. Install it or check the path in executor configuration.`
                : isPermission
                  ? "Permission denied. Check file permissions."
                  : `Unexpected process error. Check the executor configuration.`,
              output: stdoutLines.join("\n"),
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
          ? "The operation timed out. Increase the timeout in executor configuration."
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

    if (input.interactiveInput !== undefined) {
      InteractiveController.sendInput(sessionId, input.interactiveInput);
    }

    eventBus.emit({
      type: "interactive_resumed",
      runId,
      taskId,
      sessionId,
    } as never);

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
      executor: this.name,
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
