import { type QualityCommandResult, type QualityGateResult } from "../schemas/quality.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { now } from "../utils/time.js";
import { atomicWriteJsonFile, ensureDir } from "../utils/fs.js";
import { getOutputsDir, getLogsDir } from "../utils/paths.js";
import { ValidationRunner } from "../validation/validation-runner.js";
import path from "node:path";

export class QualityGate {
  private validationRunner: ValidationRunner;
  private config: FlowTaskConfig;

  constructor(config: FlowTaskConfig) {
    this.config = config;
    this.validationRunner = new ValidationRunner(config);
  }

  async run(
    rootPath: string,
    runId: string,
    commands: string[],
    _timeoutMs = 120000,
  ): Promise<QualityGateResult> {
    const startedAt = now();
    const results: QualityCommandResult[] = [];
    const outputsDir = getOutputsDir(rootPath, runId);
    await ensureDir(outputsDir);

    const logDir = getLogsDir(rootPath, runId);
    await ensureDir(logDir);

    const validationResults = await this.validationRunner.runValidation({
      commands,
      cwd: rootPath,
      runId,
    });

    for (const vr of validationResults) {
      const cmdResult: QualityCommandResult = {
        command: vr.command,
        status: mapStatus(vr.status),
        exitCode: vr.exitCode,
        startedAt: vr.startedAt,
        finishedAt: vr.finishedAt,
        output: vr.output,
        error: vr.error,
      };
      results.push(cmdResult);
    }

    this.validationRunner.clearDedupeCache();

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

  cancel(runId: string): void {
    this.validationRunner.cancel(runId);
  }

  cancelAll(): void {
    this.validationRunner.cancelAll();
  }
}

function mapStatus(s: string): QualityCommandResult["status"] {
  if (s === "passed") return "passed";
  if (s === "timeout") return "timeout";
  return "failed";
}
