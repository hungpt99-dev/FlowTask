import { type Executor, type ExecutorInput, type ExecutorResult } from "./executor.js";
import { spawnWithStreaming } from "../utils/process.js";
import { now } from "../utils/time.js";
import type { ExecutorEntry } from "../schemas/config.schema.js";
import { ProcessManager } from "../core/process-manager.js";
import { spawn } from "node:child_process";

export class CommandExecutor implements Executor {
  name = "command";
  private configEntry: ExecutorEntry;
  private processManager?: ProcessManager;

  constructor(configEntry: ExecutorEntry) {
    this.configEntry = configEntry;
    this.name = configEntry.command ?? "command";
  }

  setProcessManager(pm: ProcessManager): void {
    this.processManager = pm;
  }

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    const startedAt = now();
    const args = [...(this.configEntry.args ?? [])];
    const cmd = this.configEntry.command ?? "";
    const inputMode = this.configEntry.inputMode ?? "argument";
    const timeoutMs = this.configEntry.timeoutMs ?? 1800000;

    if (inputMode === "argument") {
      args.push(input.task.title);
    } else if (inputMode === "file") {
      const fileArg = this.configEntry.fileArg ?? "--file";
      args.push(fileArg, input.contextPackPath);
    }

    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];

    try {
      if (inputMode === "stdin") {
        return await this.executeStdin(cmd, args, input, startedAt, timeoutMs);
      }

      const result = await spawnWithStreaming(cmd, args, {
        cwd: input.projectRoot,
        env: {
          ...input.env,
          FLOWTASK_CONTEXT_PACK: input.contextPackContent,
          FLOWTASK_TASK_ID: input.task.id,
          FLOWTASK_RUN_ID: input.runId,
        },
        signal: input.signal,
        timeout: timeoutMs,
        callbacks: {
          onStdout: (text) => {
            process.stdout.write(text);
            stdoutBuffer.push(text);
          },
          onStderr: (text) => {
            process.stderr.write(text);
            stderrBuffer.push(text);
          },
        },
      });

      return {
        status: result.exitCode === 0 ? "done" : "failed",
        exitCode: result.exitCode ?? undefined,
        output: stdoutBuffer.join(""),
        error: stderrBuffer.join("") || undefined,
        startedAt,
        finishedAt: now(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes("timeout") || message.includes("ETIMEDOUT");
      return {
        status: isTimeout ? "timeout" : "failed",
        error: message,
        startedAt,
        finishedAt: now(),
      };
    }
  }

  private async executeStdin(
    cmd: string,
    args: string[],
    input: ExecutorInput,
    startedAt: string,
    timeoutMs: number,
  ): Promise<ExecutorResult> {
    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];

    return new Promise<ExecutorResult>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: input.projectRoot,
        env: {
          ...input.env,
          FLOWTASK_CONTEXT_PACK: input.contextPackContent,
          FLOWTASK_TASK_ID: input.task.id,
          FLOWTASK_RUN_ID: input.runId,
        },
        signal: input.signal,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        timeout: timeoutMs,
      });

      if (this.processManager && child.pid) {
        this.processManager
          .save(input.projectRoot, {
            runId: input.runId,
            taskId: input.task.id,
            pid: child.pid,
            executor: this.name,
            command: cmd,
            args,
            startedAt,
            status: "running",
          })
          .catch(() => {});
      }

      child.stdin?.write(input.contextPackContent);
      child.stdin?.end();

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        process.stdout.write(text);
        stdoutBuffer.push(text);
      });

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        process.stderr.write(text);
        stderrBuffer.push(text);
      });

      child.on("close", (exitCode) => {
        if (this.processManager) {
          this.processManager.clear(input.projectRoot, input.runId).catch(() => {});
        }
        resolve({
          status: exitCode === 0 ? "done" : "failed",
          exitCode: exitCode ?? undefined,
          output: stdoutBuffer.join(""),
          error: stderrBuffer.join("") || undefined,
          startedAt,
          finishedAt: now(),
        });
      });

      child.on("error", (err) => {
        if (this.processManager) {
          this.processManager.clear(input.projectRoot, input.runId).catch(() => {});
        }
        resolve({
          status: "failed",
          error: err.message,
          startedAt,
          finishedAt: now(),
        });
      });
    });
  }
}
