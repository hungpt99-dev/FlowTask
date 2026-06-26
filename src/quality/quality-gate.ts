import { type QualityCommandResult, type QualityGateResult } from "../schemas/quality.schema.js";
import { spawnWithPromise } from "../utils/process.js";
import { getShell, getShellCommandFlag } from "../utils/shell.js";
import { now } from "../utils/time.js";
import { atomicWriteJsonFile, ensureDir, appendToFile } from "../utils/fs.js";
import { getOutputsDir, getLogsDir } from "../utils/paths.js";
import path from "node:path";

export class QualityGate {
  async run(
    rootPath: string,
    runId: string,
    commands: string[],
    timeoutMs = 120000,
  ): Promise<QualityGateResult> {
    const startedAt = now();
    const results: QualityCommandResult[] = [];
    const outputsDir = getOutputsDir(rootPath, runId);
    const logsDir = getLogsDir(rootPath, runId);
    await ensureDir(outputsDir);
    await ensureDir(logsDir);

    for (const command of commands) {
      const cmdStartedAt = now();
      try {
        const result = await spawnWithPromise(getShell(), [getShellCommandFlag(), command], {
          cwd: rootPath,
          timeout: timeoutMs,
        });

        const cmdResult: QualityCommandResult = {
          command,
          status: result.exitCode === 0 ? "passed" : "failed",
          exitCode: result.exitCode ?? undefined,
          startedAt: cmdStartedAt,
          finishedAt: now(),
          output: result.stdout.slice(0, 2000),
          error: result.stderr.slice(0, 2000) || undefined,
        };
        results.push(cmdResult);

        const logLine = `[${cmdStartedAt}] COMMAND: ${command}\nEXIT: ${result.exitCode}\nSTDOUT:\n${result.stdout.slice(0, 2000)}\nSTDERR:\n${result.stderr.slice(0, 500)}\n---\n`;
        await appendToFile(path.join(logsDir, "quality.log"), logLine);
      } catch (err) {
        const isTimeout =
          err instanceof Error &&
          (err.message.includes("timeout") || err.message.includes("ETIMEDOUT"));
        results.push({
          command,
          status: isTimeout ? "timeout" : "failed",
          startedAt: cmdStartedAt,
          finishedAt: now(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const finishedAt = now();
    const allPassed = results.every((r) => r.status === "passed");
    const gateResult: QualityGateResult = {
      status: allPassed ? "passed" : "failed",
      commands: results,
      startedAt,
      finishedAt,
    };

    await atomicWriteJsonFile(path.join(outputsDir, "quality-results.json"), gateResult);
    return gateResult;
  }
}
