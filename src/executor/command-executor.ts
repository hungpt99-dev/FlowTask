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

    eventBus.emit({
      type: "executor_started",
      runId,
      taskId,
      executor: executorName,
      command: cmd,
      args: finalArgs,
    });

    try {
      return await new Promise<ExecutorResult>((resolve) => {
        let settled = false;
        const resolveOnce = (result: ExecutorResult): void => {
          if (settled) return;
          settled = true;
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

        if (this.processManager && child.pid) {
          this.processManager
            .save(input.projectRoot, {
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
              // non-critical: process state persistence
              if (this.logManager) {
                this.logManager.writeTaskLog(
                  runId,
                  taskId,
                  `[warn] failed to save process state: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            });
        }

        if (stdin !== undefined) {
          child.stdin?.write(stdin);
          child.stdin?.end();
        } else {
          child.stdin?.end();
        }

        const stdoutLines: string[] = [];
        const stderrLines: string[] = [];
        let spawnError: string | undefined;

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

        if (child.stdout) {
          const stdoutBuf = new LineBuffer((line) => {
            stdoutLines.push(line);
            emitAndLog("stdout", line);
          });
          child.stdout.on("data", (data: Buffer) => stdoutBuf.push(data));
          child.stdout.on("end", () => stdoutBuf.flush());
        }

        if (child.stderr) {
          const stderrBuf = new LineBuffer((line) => {
            stderrLines.push(line);
            emitAndLog("stderr", line);
          });
          child.stderr.on("data", (data: Buffer) => stderrBuf.push(data));
          child.stderr.on("end", () => stderrBuf.flush());
        }

        child.on("close", (exitCode, _signal) => {
          if (this.processManager) {
            this.processManager.clear(input.projectRoot, runId).catch((err) => {
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

          resolveOnce({
            status: exitCode === 0 ? "done" : "failed",
            exitCode: exitCode ?? undefined,
            output: stdoutLines.join("\n"),
            error: stderrLines.join("\n") || spawnError,
            startedAt,
            finishedAt: now(),
          });
        });

        child.on("error", (err) => {
          spawnError = err.message;
          if (this.processManager) {
            this.processManager.clear(input.projectRoot, runId).catch((e) => {
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

          resolveOnce({
            status: "failed",
            exitCode: undefined,
            error: err.message,
            output: stdoutLines.join("\n"),
            startedAt,
            finishedAt: now(),
          });
        });
      });
    } catch (err) {
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
        startedAt,
        finishedAt: now(),
      };
    }
  }
}
