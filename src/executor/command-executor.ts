import { type Executor, type ExecutorInput, type ExecutorResult } from "./executor.js";
import { spawn } from "node:child_process";
import { now } from "../utils/time.js";
import type { ExecutorEntry } from "../schemas/config.schema.js";
import { ProcessManager } from "../core/process-manager.js";
import { buildCommandArgs } from "./build-command-args.js";

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

    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];

    try {
      return await new Promise<ExecutorResult>((resolve) => {
        const child = spawn(cmd, finalArgs, {
          cwd: input.projectRoot,
          env: {
            ...process.env,
            ...input.env,
            FLOWTASK_CONTEXT_PACK: input.contextPackContent,
            FLOWTASK_TASK_ID: input.task.id,
            FLOWTASK_RUN_ID: input.runId,
          },
          stdio: ["pipe", "pipe", "pipe"],
          signal: input.signal,
          timeout: timeoutMs,
          shell: false,
        });

        if (this.processManager && child.pid) {
          this.processManager
            .save(input.projectRoot, {
              runId: input.runId,
              taskId: input.task.id,
              pid: child.pid,
              executor: this.name,
              command: cmd,
              args: finalArgs,
              startedAt,
              status: "running",
            })
            .catch(() => {});
        }

        if (stdin !== undefined) {
          child.stdin?.write(stdin);
          child.stdin?.end();
        } else {
          child.stdin?.end();
        }

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
}
