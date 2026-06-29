import type { ValidationResult, ValidationCheck } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import type { Task } from "../schemas/task.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { ProcessValidator } from "./process-validator.js";
import { CommandValidator } from "./command-validator.js";
import { AcceptanceCriteriaValidator } from "./acceptance-criteria-validator.js";
import { OutcomeComparisonValidator } from "./outcome-comparison-validator.js";
import { OutputPlanValidator } from "./output-plan-validator.js";
import { AiValidator, type AiVerdict, type AiValidationMode } from "./ai-validator.js";
import { ProviderRegistry } from "../ai/provider-registry.js";
import { now } from "../utils/time.js";

export interface ValidateTaskInput {
  projectRoot: string;
  task: Task;
  executorResult: ExecutorResult;
}

export class ValidationEngine {
  private processValidator: ProcessValidator;
  private commandValidator: CommandValidator;
  private acceptanceCriteriaValidator: AcceptanceCriteriaValidator;
  private outcomeComparisonValidator: OutcomeComparisonValidator;
  private outputPlanValidator: OutputPlanValidator;
  private aiValidator?: AiValidator;
  private adaptiveValidation: boolean;
  private config?: FlowTaskConfig;

  constructor(config?: FlowTaskConfig) {
    this.processValidator = new ProcessValidator();
    this.commandValidator = new CommandValidator(config);
    this.acceptanceCriteriaValidator = new AcceptanceCriteriaValidator();
    this.outcomeComparisonValidator = new OutcomeComparisonValidator();
    this.aiValidator = config ? new AiValidator(new ProviderRegistry(config)) : undefined;
    this.outputPlanValidator = new OutputPlanValidator(this.aiValidator);
    this.adaptiveValidation = config?.validation?.adaptiveValidation ?? true;
    this.config = config;
  }

  async validateTask(input: ValidateTaskInput): Promise<ValidationResult> {
    const checks: ValidationCheck[] = [];

    const processCheck = await this.processValidator.validate(input.executorResult);
    checks.push(processCheck);

    if (input.task.validation?.commands && input.task.validation.commands.length > 0) {
      const commandChecks = await this.commandValidator.validateCommands(
        input.task.validation.commands,
        input.projectRoot,
      );
      checks.push(...commandChecks);
    }

    if (input.task.acceptanceCriteria && input.task.acceptanceCriteria.length > 0) {
      const criteriaChecks = await this.acceptanceCriteriaValidator.validate(
        input.task.acceptanceCriteria,
        input.executorResult,
        input.projectRoot,
      );
      checks.push(...criteriaChecks);
    }

    if (input.task.expectedResult) {
      const outcomeCheck = await this.outcomeComparisonValidator.validate(
        input.task.expectedResult,
        input.executorResult,
        input.projectRoot,
      );
      checks.push(outcomeCheck);
    }

    if (input.task.outputPlan && input.task.outputPlan.length > 0) {
      const outputPlanChecks = await this.outputPlanValidator.validate(
        input.task.outputPlan,
        input.executorResult,
        input.projectRoot,
        input.task.description,
      );
      checks.push(...outputPlanChecks);
    }

    const aiCheck = await this.maybeRunAiValidation(input, checks);
    if (aiCheck) checks.push(aiCheck);

    if (checks.length === 0) {
      return {
        taskId: input.task.id,
        status: "warning",
        checks: [],
        createdAt: now(),
      };
    }

    if (input.task.expectedResult && this.adaptiveValidation) {
      return this.determineAdaptiveResult(input.task.id, checks);
    }

    const allPassed = checks.every((c) => c.status === "passed");
    const anyFailed = checks.some((c) => c.status === "failed");
    const anyNeedsRetry = checks.some((c) => c.status === "needs_retry");
    const anyNeedsReview = checks.some((c) => c.status === "needs_review");

    let finalStatus: ValidationResult["status"];
    if (anyFailed) finalStatus = "failed";
    else if (anyNeedsReview) finalStatus = "needs_review";
    else if (anyNeedsRetry) finalStatus = "needs_retry";
    else if (allPassed) finalStatus = "passed";
    else finalStatus = "warning";

    return {
      taskId: input.task.id,
      status: finalStatus,
      checks,
      createdAt: now(),
    };
  }

  /**
   * Reads the AI validation mode from config.
   * Modes:
   * - "off": AI review is never performed
   * - "fallback": AI review runs only when deterministic checks have actually failed (default)
   * - "always": AI review runs on every task after deterministic checks
   * - "high_risk_only": AI review runs only for high-risk tasks (failed execution, retries, delete operations)
   */
  private getAiValidationMode(): AiValidationMode {
    return this.config?.validation?.aiValidation ?? "fallback";
  }

  /**
   * Returns true when any deterministic check has failed.
   * Used by "fallback" mode to decide whether AI review should run.
   * Deterministic is considered failed when at least one non-AI check
   * has status "failed" (process error, non-zero exit, command failure).
   * Warnings and inconclusive results do NOT trigger fallback —
   * only actual failures do.
   */
  private hasDeterministicFailure(checks: ValidationCheck[]): boolean {
    if (checks.length === 0) return false;
    const nonAiChecks = checks.filter((c) => c.type !== "ai_review");
    return nonAiChecks.some((c) => c.status === "failed");
  }

  /**
   * Determines whether a task is high-risk, triggering AI validation in "high_risk_only" mode.
   * High-risk factors: failed execution, non-zero exit code, retry attempts, delete operations.
   */
  private isHighRiskTask(input: ValidateTaskInput): boolean {
    if (input.executorResult.status === "failed" || (input.executorResult.exitCode ?? 0) !== 0) {
      return true;
    }
    if (input.task.retryCount > 0) return true;
    if (input.task.outputPlan) {
      const hasDelete = input.task.outputPlan.some((item) => item.action === "delete");
      if (hasDelete) return true;
    }
    return false;
  }

  /**
   * Conditionally runs AI validation based on the configured mode:
   *
   * - "off": Skip entirely — no AI review, return undefined.
   * - "fallback": Run AI review only when deterministic checks have actually failed.
   *   If all deterministic checks pass or only produce warnings/inconclusive results,
   *   AI is skipped since deterministic validation is sufficient. AI acts as a
   *   fallback for genuine failures, not a blanket review layer.
   * - "always": Run AI review on every task after all deterministic checks.
   * - "high_risk_only": Run AI review only for tasks flagged as high-risk
   *   (failed execution, retries, delete operations).
   *
   * When AI review does run, it collects evidence from all deterministic checks,
   * passes them to the AiValidator, and adjusts the AI verdict if deterministic
   * checks already failed (AI cannot override a deterministic failure by default).
   */
  private async maybeRunAiValidation(
    input: ValidateTaskInput,
    checks: ValidationCheck[],
  ): Promise<ValidationCheck | undefined> {
    if (!this.aiValidator) return undefined;

    const mode = this.getAiValidationMode();
    if (mode === "off") return undefined;

    if (mode === "fallback" && !this.hasDeterministicFailure(checks)) return undefined;
    if (mode === "high_risk_only" && !this.isHighRiskTask(input)) return undefined;

    const evidenceParts: string[] = [];
    for (const c of checks) {
      const parts = [`[${c.type}] ${c.status}`];
      if (c.message) parts.push(c.message);
      if (c.evidence) parts.push(`Evidence: ${c.evidence}`);
      if (c.command) parts.push(`Command: ${c.command}`);
      if (c.path) parts.push(`Path: ${c.path}`);
      if (c.details) {
        const detailKeys = Object.keys(c.details).filter(
          (k) => k !== "verdict" && k !== "evidenceSummary",
        );
        for (const k of detailKeys) {
          const v = c.details[k];
          if (v !== undefined && v !== null) {
            parts.push(`${k}: ${JSON.stringify(v)}`);
          }
        }
      }
      evidenceParts.push(parts.join(" — "));
    }

    if (input.executorResult.outputPlanResults) {
      const opEvidence = input.executorResult.outputPlanResults
        .map(
          (r) =>
            `[output_plan] ${r.action} ${r.target} — produced: ${r.produced}${r.evidence ? ` — ${r.evidence}` : ""}`,
        )
        .join("\n");
      if (opEvidence) {
        evidenceParts.push(`Output Plan Results:\n${opEvidence}`);
      }
    }

    const commandResults = input.task.validation?.commands?.length
      ? evidenceParts.filter((e) => e.startsWith("[command]")).join("\n")
      : undefined;

    let changedFiles: string[] | undefined;
    if (input.executorResult.outputPlanResults) {
      changedFiles = input.executorResult.outputPlanResults
        .filter((r) => r.action === "create" || r.action === "modify")
        .map((r) => r.target);
    }

    let verdict: AiVerdict;
    try {
      verdict = await this.aiValidator.validate({
        taskDescription: input.task.description ?? input.task.title,
        executorOutput: input.executorResult.output ?? "",
        errorOutput: input.executorResult.error,
        expectedResult: input.task.expectedResult,
        acceptanceCriteria: input.task.acceptanceCriteria,
        executorStatus: input.executorResult.status,
        exitCode: input.executorResult.exitCode,
        changedFiles,
        artifacts: input.executorResult.artifacts,
        commandResults,
        outputPlanResults: input.executorResult.outputPlanResults,
        outputPlan: input.task.outputPlan?.map((p) => `${p.action} ${p.target}`),
        validationMode: mode,
        providerName: this.config?.validation?.aiProvider,
      });
    } catch {
      return {
        type: "ai_review",
        status: "skipped",
        message: "AI validation could not run — provider unavailable or error",
        details: { reason: "ai_provider_error" },
      };
    }

    const deterministicFailed = checks.some(
      (c) => c.type !== "ai_review" && c.type !== "outcome_comparison" && c.status === "failed",
    );

    let aiStatus: string = verdict.status;
    if (deterministicFailed && (aiStatus === "passed" || aiStatus === "needs_retry")) {
      aiStatus = "warning";
    }
    if (aiStatus === "needs_review" && deterministicFailed) {
      aiStatus = "needs_review";
    }

    const evidenceSummary =
      evidenceParts.length > 0 ? evidenceParts.join("\n") : "No deterministic checks available";

    return {
      type: "ai_review",
      status: aiStatus as ValidationCheck["status"],
      message: this.buildAiMessage(aiStatus, verdict.suggestion, deterministicFailed),
      details: {
        verdict,
        evidenceSummary,
        mode,
        deterministicFailed,
      },
    };
  }

  private buildAiMessage(status: string, suggestion: string, deterministicFailed: boolean): string {
    if (status === "passed") {
      return deterministicFailed
        ? "AI review indicates success, but some deterministic checks failed — review recommended"
        : "AI review passed — evidence confirms task completed successfully";
    }
    if (status === "failed") {
      return `AI review failed — ${suggestion || "evidence does not confirm expected result"}`;
    }
    if (status === "warning") {
      return `AI review warning — ${suggestion || "evidence is inconclusive"}`;
    }
    if (status === "needs_retry") {
      return `AI review suggests retry — ${suggestion || "retry may resolve the issue"}`;
    }
    if (status === "needs_review") {
      return `AI review requires human review — ${suggestion || "evidence is ambiguous or requires manual assessment"}`;
    }
    return `AI review: ${status}`;
  }

  private determineAdaptiveResult(taskId: string, checks: ValidationCheck[]): ValidationResult {
    const outcomeCheck = checks.find((c) => c.type === "outcome_comparison");
    const otherChecks = checks.filter((c) => c.type !== "outcome_comparison");
    const otherFailed = otherChecks.some((c) => c.status === "failed");
    const otherNeedsReview = otherChecks.some((c) => c.status === "needs_review");
    const otherNeedsRetry = otherChecks.some((c) => c.status === "needs_retry");

    if (outcomeCheck) {
      let finalStatus: ValidationResult["status"];

      switch (outcomeCheck.status) {
        case "passed":
          if (otherNeedsReview) finalStatus = "needs_review";
          else if (otherNeedsRetry) finalStatus = "needs_retry";
          else finalStatus = otherFailed ? "warning" : "passed";
          break;
        case "warning":
          if (otherNeedsReview) finalStatus = "needs_review";
          else if (otherNeedsRetry) finalStatus = "needs_retry";
          else finalStatus = otherFailed ? "failed" : "warning";
          break;
        case "failed":
          finalStatus = "failed";
          break;
        case "needs_review":
          finalStatus = "needs_review";
          break;
        case "needs_retry":
          finalStatus = "needs_retry";
          break;
        default:
          finalStatus = outcomeCheck.status;
      }

      return {
        taskId,
        status: finalStatus,
        checks,
        createdAt: now(),
      };
    }

    const allPassed = checks.every((c) => c.status === "passed");
    const anyFailed = checks.some((c) => c.status === "failed");
    const anyNeedsRetry = checks.some((c) => c.status === "needs_retry");
    const anyNeedsReview = checks.some((c) => c.status === "needs_review");

    if (anyFailed) {
      return { taskId, status: "failed", checks, createdAt: now() };
    }
    if (anyNeedsReview) {
      return { taskId, status: "needs_review", checks, createdAt: now() };
    }
    if (anyNeedsRetry) {
      return { taskId, status: "needs_retry", checks, createdAt: now() };
    }

    return {
      taskId,
      status: allPassed ? "passed" : "warning",
      checks,
      createdAt: now(),
    };
  }
}
