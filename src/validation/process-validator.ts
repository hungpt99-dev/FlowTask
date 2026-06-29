import type { ValidationCheck } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";

export class ProcessValidator {
  async validate(result: ExecutorResult): Promise<ValidationCheck> {
    const isSuccess = result.exitCode === 0;
    const message = isSuccess
      ? "Process completed successfully"
      : result.exitCode !== undefined && result.exitCode !== null
        ? `Process failed with exit code ${result.exitCode}`
        : result.error
          ? `Process failed: ${result.error}`
          : "Process failed with no exit code";

    const evidence = result.errorEvidence;
    const suggestedFix = result.suggestedFix;

    return {
      type: "process",
      status: isSuccess ? "passed" : "failed",
      exitCode: result.exitCode,
      message,
      evidence: evidence ?? (result.error ? `Error: ${result.error}` : undefined),
      failureReason: !isSuccess
        ? {
            reason: "process_failed",
            detail: result.errorEvidence ?? result.error ?? "Process exited with non-zero code",
            severity: "error",
          }
        : undefined,
      retrySuggestion:
        suggestedFix ??
        (!isSuccess ? "Retry the command after fixing the reported issue." : undefined),
      details: evidence ? { errorEvidence: evidence } : undefined,
    };
  }
}
