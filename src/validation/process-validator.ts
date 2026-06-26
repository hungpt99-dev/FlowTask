import type { ValidationCheck } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";

export class ProcessValidator {
  async validate(result: ExecutorResult): Promise<ValidationCheck> {
    const message =
      result.exitCode === 0
        ? "Process completed successfully"
        : result.exitCode !== undefined && result.exitCode !== null
          ? `Process failed with exit code ${result.exitCode}`
          : result.error
            ? `Process failed: ${result.error}`
            : "Process failed with no exit code";
    return {
      type: "process",
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      message,
    };
  }
}
