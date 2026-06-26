import { type Executor, type ExecutorInput, type ExecutorResult } from "./executor.js";
import { spawnWithStreaming } from "../utils/process.js";
import { now } from "../utils/time.js";
import { getShell, getShellCommandFlag } from "../utils/shell.js";

export class ShellExecutor implements Executor {
  name = "shell";

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    const startedAt = now();
    try {
      const stdoutBuffer: string[] = [];
      const stderrBuffer: string[] = [];

      const result = await spawnWithStreaming(
        getShell(),
        [getShellCommandFlag(), input.task.title],
        {
          cwd: input.projectRoot,
          env: input.env,
          signal: input.signal,
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
        },
      );

      return {
        status: result.exitCode === 0 ? "done" : "failed",
        exitCode: result.exitCode ?? undefined,
        output: stdoutBuffer.join(""),
        error: stderrBuffer.join("") || undefined,
        startedAt,
        finishedAt: now(),
      };
    } catch (err) {
      return {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        startedAt,
        finishedAt: now(),
      };
    }
  }
}
