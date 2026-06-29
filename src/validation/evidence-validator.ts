import type { ValidationCheck, FailureReason } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import type { Task } from "../schemas/task.schema.js";
import { fileExists } from "../utils/fs.js";

export interface EvidenceValidatorInput {
  task: Pick<Task, "id" | "description" | "acceptanceCriteria" | "expectedResult">;
  executorResult: ExecutorResult;
  projectRoot: string;
}

const CODE_EXTENSIONS = /\.(ts|js|tsx|jsx|py|rs|go|java|cpp|c|rb|php|swift|kt)$/;
const DOC_EXTENSIONS = /\.(md|rst|txt|docx?|pdf)$/;

export class EvidenceValidator {
  async validate(input: EvidenceValidatorInput): Promise<ValidationCheck> {
    const { task, executorResult, projectRoot } = input;
    const output = executorResult.output ?? "";
    const error = executorResult.error ?? "";
    const processPassed = executorResult.exitCode === 0;
    const artifacts = executorResult.artifacts ?? [];

    const evidence: string[] = [];
    const gaps: string[] = [];

    if (output) evidence.push("executor_output");
    if (error) evidence.push("error_output");
    if (processPassed) evidence.push("process_success");
    if (artifacts.length > 0) evidence.push("artifacts");

    const taskDesc = (task.description ?? "").toLowerCase();
    const taskIsCode = CODE_EXTENSIONS.test(taskDesc) || taskDesc.includes("code");
    const taskIsDoc = DOC_EXTENSIONS.test(taskDesc) || taskDesc.includes("document");
    const requiresFileOutput =
      taskIsCode || taskIsDoc || /file|create|write|generate|save/.test(taskDesc);

    if (requiresFileOutput && artifacts.length === 0) {
      gaps.push("No artifacts or files were produced");
    }

    if (
      task.expectedResult &&
      !output.toLowerCase().includes(task.expectedResult.toLowerCase().slice(0, 40))
    ) {
      gaps.push("Expected result not confirmed in output");
    }

    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
      const unmetCriteria = task.acceptanceCriteria.filter(
        (c) => !output.toLowerCase().includes(c.toLowerCase()),
      );
      if (unmetCriteria.length > 0) {
        gaps.push(`${unmetCriteria.length} acceptance criteria not confirmed in output`);
      }
    }

    if (!output && !processPassed && artifacts.length === 0) {
      gaps.push("No evidence available — no output, process failed, no artifacts");
    }

    const hasSufficient = gaps.length === 0 || (gaps.length <= 1 && processPassed);
    const failureReason: FailureReason | undefined =
      gaps.length > 0
        ? {
            reason: gaps.join("; "),
            severity: hasSufficient ? "warning" : "error",
          }
        : undefined;

    return {
      type: "evidence",
      status: hasSufficient ? "passed" : "needs_review",
      message: hasSufficient
        ? "Sufficient evidence available for validation"
        : `Insufficient evidence: ${gaps.join("; ")}`,
      evidence: evidence.length > 0 ? evidence.join(", ") : "No evidence collected",
      confidence: hasSufficient ? 0.8 : 0.3,
      failureReason,
      userReviewSuggestion: hasSufficient
        ? undefined
        : "Evidence is insufficient to determine task completion. Review manually.",
      retrySuggestion: gaps.every((g) => g.includes("No artifacts"))
        ? "Run executor again to produce expected files"
        : undefined,
      details: {
        evidenceCount: evidence.length,
        gapCount: gaps.length,
        gaps,
        requiresFileOutput,
      },
    };
  }
}
