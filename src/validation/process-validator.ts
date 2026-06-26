import type { ValidationCheck } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";

export class ProcessValidator {
  async validate(result: ExecutorResult): Promise<ValidationCheck> {
    return {
      type: "process",
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      message:
        result.exitCode === 0
          ? "Process completed successfully"
          : `Process failed with exit code ${result.exitCode}`,
    };
  }
}
