import { type Executor, type ExecutorInput, type ExecutorResult } from "./executor.js";
import { spawn } from "node:child_process";
import { now } from "../utils/time.js";
import { getShell, getShellCommandFlag } from "../utils/shell.js";
import { getEventBus } from "../ui/event-bus.js";
import { LineBuffer } from "../utils/stream-lines.js";
import { SecretRedactor } from "../safety/secret-redactor.js";
import type { LogManager } from "../core/log-manager.js";
import { sanitizeCommand, buildChildEnv } from "../utils/command-sanitizer.js";

export class ShellExecutor implements Executor {
  name = "shell";
  private logManager?: LogManager;

  setLogManager(lm: LogManager): void {
    this.logManager = lm;
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

    let command = commands.join(" && ");

    if (!input.allowShellMetachars) {
      const sanResult = sanitizeCommand(command);
      if (!sanResult.valid) {
        return {
          status: "failed",
          exitCode: 1,
          output: "",
          error: `Shell command rejected: ${sanResult.reason}`,
          startedAt,
          finishedAt: now(),
        };
      }
      command = sanResult.sanitized;
    }

    eventBus.emit({
      type: "executor_started",
      runId,
      taskId,
      executor: executorName,
      command: getShell(),
      args: [getShellCommandFlag(), command],
    });

    try {
      return await new Promise<ExecutorResult>((resolve) => {
        const child = spawn(getShell(), [getShellCommandFlag(), command], {
          cwd: input.projectRoot,
          env: buildChildEnv({
            ...input.env,
            FLOWTASK_TASK_ID: taskId,
            FLOWTASK_RUN_ID: runId,
            FLOWTASK_CONTEXT_PACK: input.contextPackContent,
          }),
          stdio: ["pipe", "pipe", "pipe"],
          signal: input.signal,
          shell: false,
        });

        child.stdin?.end();

        const stdoutLines: string[] = [];
        const stderrLines: string[] = [];

        const emitAndLog = (stream: "stdout" | "stderr", text: string): void => {
          const safe = redactor.redact(text);
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

        child.on("close", (exitCode) => {
          eventBus.emit({
            type: "executor_exited",
            runId,
            taskId,
            executor: executorName,
            exitCode,
          });

          resolve({
            status: exitCode === 0 ? "done" : "failed",
            exitCode: exitCode ?? undefined,
            output: stdoutLines.join("\n"),
            error: stderrLines.join("\n") || undefined,
            startedAt,
            finishedAt: now(),
          });
        });

        child.on("error", (err) => {
          eventBus.emit({
            type: "executor_failed",
            runId,
            taskId,
            executor: executorName,
            reason: err.message,
          });

          resolve({
            status: "failed",
            error: err.message,
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
