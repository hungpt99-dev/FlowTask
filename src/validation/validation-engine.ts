import type {
  ValidationResult,
  ValidationCheck,
  FailureReason,
  ValidationCheckType,
} from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import type { Task } from "../schemas/task.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { ProcessValidator } from "./process-validator.js";
import { CommandValidator } from "./command-validator.js";
import { AcceptanceCriteriaValidator } from "./acceptance-criteria-validator.js";
import { OutcomeComparisonValidator } from "./outcome-comparison-validator.js";
import { OutputPlanValidator } from "./output-plan-validator.js";
import { AiValidator, type AiVerdict, type AiValidationMode } from "./ai-validator.js";
import { EvidenceValidator } from "./evidence-validator.js";
import { DataValidator } from "./data-validator.js";
import { HybridValidator } from "./hybrid-validator.js";
import { ProviderRegistry } from "../ai/provider-registry.js";
import { fileExists, readTextFile } from "../utils/fs.js";
import { now } from "../utils/time.js";

export interface ValidateTaskInput {
  projectRoot: string;
  task: Task;
  executorResult: ExecutorResult;
}

const DEFAULT_CONFIDENCE: Record<string, number> = {
  passed: 0.9,
  warning: 0.5,
  failed: 0,
  skipped: 0.3,
  needs_retry: 0.3,
  needs_review: 0.1,
};

export class ValidationEngine {
  private processValidator: ProcessValidator;
  private commandValidator: CommandValidator;
  private acceptanceCriteriaValidator: AcceptanceCriteriaValidator;
  private outcomeComparisonValidator: OutcomeComparisonValidator;
  private outputPlanValidator: OutputPlanValidator;
  private evidenceValidator: EvidenceValidator;
  private dataValidator: DataValidator;
  private hybridValidator: HybridValidator;
  private aiValidator?: AiValidator;
  private adaptiveValidation: boolean;
  private config?: FlowTaskConfig;

  constructor(config?: FlowTaskConfig) {
    this.processValidator = new ProcessValidator();
    this.commandValidator = new CommandValidator(config);
    this.acceptanceCriteriaValidator = new AcceptanceCriteriaValidator();
    this.outcomeComparisonValidator = new OutcomeComparisonValidator();
    this.evidenceValidator = new EvidenceValidator();
    this.dataValidator = new DataValidator();
    this.hybridValidator = new HybridValidator();
    this.aiValidator = config ? new AiValidator(new ProviderRegistry(config)) : undefined;
    this.outputPlanValidator = new OutputPlanValidator(this.aiValidator);
    this.adaptiveValidation = config?.validation?.adaptiveValidation ?? true;
    this.config = config;
  }

  async validateTask(input: ValidateTaskInput): Promise<ValidationResult> {
    const checks: ValidationCheck[] = [];
    const { task, executorResult, projectRoot } = input;

    const processCheck = await this.processValidator.validate(executorResult);
    checks.push(processCheck);

    // Add executor-level error evidence as a validation signal
    if (executorResult.errorEvidence || executorResult.suggestedFix) {
      checks.push({
        type: "process",
        status: executorResult.status === "failed" ? "failed" : "passed",
        message: executorResult.error ?? "Process executed",
        evidence: executorResult.errorEvidence,
        failureReason: executorResult.error
          ? { reason: "executor_error", detail: executorResult.errorEvidence, severity: "error" }
          : undefined,
        retrySuggestion: executorResult.suggestedFix,
        userReviewSuggestion:
          executorResult.status === "failed" && !executorResult.suggestedFix
            ? "Review executor output for details."
            : undefined,
        details: { errorEvidence: executorResult.errorEvidence },
      });
    }

    if (task.validation?.commands && task.validation.commands.length > 0) {
      const commandChecks = await this.commandValidator.validateCommands(
        task.validation.commands,
        projectRoot,
      );
      checks.push(...commandChecks);
    }

    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
      const criteriaChecks = await this.acceptanceCriteriaValidator.validate(
        task.acceptanceCriteria,
        executorResult,
        projectRoot,
      );
      checks.push(...criteriaChecks);
    }

    if (task.expectedResult) {
      const outcomeCheck = await this.outcomeComparisonValidator.validate(
        task.expectedResult,
        executorResult,
        projectRoot,
      );
      checks.push(outcomeCheck);
    }

    if (task.outputPlan && task.outputPlan.length > 0) {
      const outputPlanChecks = await this.outputPlanValidator.validate(
        task.outputPlan,
        executorResult,
        projectRoot,
        task.description,
      );
      checks.push(...outputPlanChecks);
    }

    const evidenceCheck = await this.evidenceValidator.validate({
      task: {
        id: task.id,
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria,
        expectedResult: task.expectedResult,
      },
      executorResult,
      projectRoot,
    });
    checks.push(evidenceCheck);

    const workflowType = this.detectWorkflowType(task.description);
    const typeSpecificChecks = await this.runTypeSpecificValidation(
      workflowType,
      executorResult,
      projectRoot,
      task,
    );
    checks.push(...typeSpecificChecks);

    const aiCheck = await this.maybeRunAiValidation(input, checks);
    if (aiCheck) checks.push(aiCheck);

    const hybridCheck = this.buildHybridCheck(checks, aiCheck);
    if (hybridCheck) checks.push(hybridCheck);

    if (checks.length === 0) {
      return {
        taskId: task.id,
        status: "warning",
        checks: [],
        createdAt: now(),
      };
    }

    if (task.expectedResult && this.adaptiveValidation) {
      return this.determineAdaptiveResult(task.id, checks);
    }

    return this.buildFinalResult(task.id, checks);
  }

  async runWorkflowValidation(
    validationType: string,
    input: ValidateTaskInput,
  ): Promise<ValidationCheck[]> {
    return this.runTypeSpecificValidation(
      validationType,
      input.executorResult,
      input.projectRoot,
      input.task,
    );
  }

  private detectWorkflowType(description?: string): string {
    const desc = (description ?? "").toLowerCase();
    // Use word-boundary patterns to avoid false matches (e.g. "ui" inside "requirement")
    const word = (s: string) => `\\b${s}\\b`;
    const anyWord = (words: string[]) => words.some((w) => new RegExp(word(w), "i").test(desc));

    if (anyWord(["documentation", "document", "readme", "manual", "guide"])) return "documentation";
    if (anyWord(["research", "investigate", "survey"])) return "research";
    if (anyWord(["dataset", "clean data", "transform"])) return "data";
    if (anyWord(["logging", "trace"])) return "log";
    if (anyWord(["user interface", "ui design", "screen", "interface design"])) return "ui";
    if (anyWord(["checklist", "qa", "quality assurance"])) return "checklist";
    if (anyWord(["requirement", "specification", "coverage"])) return "requirement_coverage";
    if (anyWord(["writing", "draft", "content", "article", "post"])) return "writing";
    if (anyWord(["implement", "refactor", "bug fix", "feature"])) return "code";
    if (/^#{1,6}\s/m.test(desc) || /\.md$|\.rst$/.test(desc)) return "documentation";
    if (/analyze|analysis|study/i.test(desc) && /requirement|coverage/i.test(desc))
      return "requirement_coverage";
    if (/\b(log|logging)\b/i.test(desc)) return "log";
    if (/\b(ui|design)\b/i.test(desc)) return "ui";
    if (/\b(analyze|analysis|study)\b/i.test(desc)) return "research";
    if (/\b(data|csv|json)\b/i.test(desc)) return "data";
    if (/\b(test|verify|quality)\b/i.test(desc)) return "checklist";
    return "general";
  }

  private async runTypeSpecificValidation(
    workflowType: string,
    executorResult: ExecutorResult,
    projectRoot: string,
    task: Task,
  ): Promise<ValidationCheck[]> {
    switch (workflowType) {
      case "documentation":
        return [await this.validateDocumentOutput(executorResult, task, projectRoot)];
      case "research":
        return [this.validateResearchOutput(executorResult, task)];
      case "data":
        return this.runDataValidation(executorResult, task, projectRoot);
      case "log":
        return [this.validateLogOutput(executorResult)];
      case "ui":
        return [this.validateUiResult(executorResult)];
      case "checklist":
        return [this.validateChecklist(executorResult, task)];
      case "requirement_coverage":
        return [this.validateRequirementCoverage(executorResult, task)];
      default:
        return [];
    }
  }

  private async runDataValidation(
    executorResult: ExecutorResult,
    task: Task,
    projectRoot: string,
  ): Promise<ValidationCheck[]> {
    return this.dataValidator.validate({
      executorResult,
      projectRoot,
      paths: task.outputPlan?.map((p) => p.target),
    });
  }

  private async validateDocumentOutput(
    executorResult: ExecutorResult,
    task: Task,
    projectRoot: string,
  ): Promise<ValidationCheck> {
    const output = executorResult.output ?? "";
    const artifacts = executorResult.artifacts ?? [];
    const evidence: string[] = [];
    const gaps: string[] = [];

    if (output.trim().length > 200) {
      evidence.push("document output has substantial content");
    } else if (output.trim().length > 0) {
      evidence.push("document output exists");
    } else {
      gaps.push("no document output generated");
    }

    for (const artifact of artifacts) {
      const fullPath = artifact.startsWith("/") ? artifact : `${projectRoot}/${artifact}`;
      const exists = await fileExists(fullPath);
      if (exists) {
        const content = await readTextFile(fullPath).catch(() => "");
        if (content.trim().length > 200) {
          evidence.push(`document file has substantial content: ${artifact}`);
        } else if (content.trim().length > 0) {
          evidence.push(`document file exists: ${artifact}`);
        }
      } else {
        gaps.push(`referenced document not found: ${artifact}`);
      }
    }

    const hasSections = /^#{1,6}\s/m.test(output) || /\n{2,}/.test(output);
    if (hasSections) evidence.push("document has structured sections");

    const passed = evidence.length > 0 && gaps.length === 0;

    return {
      type: "document",
      status: passed ? "passed" : gaps.length > 0 && evidence.length > 0 ? "warning" : "failed",
      message: passed ? "Document validation passed" : `Document validation: ${gaps.join("; ")}`,
      evidence: evidence.join(", "),
      confidence: passed ? 0.85 : gaps.length > 0 && evidence.length > 0 ? 0.5 : 0.15,
      failureReason:
        gaps.length > 0
          ? {
              reason: "document_incomplete",
              detail: gaps.join("; "),
              severity: passed ? "warning" : "error",
            }
          : undefined,
      retrySuggestion:
        gaps.length > 0 ? "Rerun the task to produce the expected document output" : undefined,
      details: { evidenceCount: evidence.length, gaps },
    };
  }

  private validateResearchOutput(executorResult: ExecutorResult, task: Task): ValidationCheck {
    const output = executorResult.output ?? "";
    const evidence: string[] = [];
    const gaps: string[] = [];

    const hasSources = /(source|reference|citation|according to|based on)/i.test(output);
    const hasAnalysis = /(found|discovered|identified|determined|concluded|shows)/i.test(output);
    const hasMetrics = /\d+%|\d+\.\d+|statistically|majority|minority|average|median/i.test(output);
    const hasStructure = /^#{1,6}\s/m.test(output) || /\n\n/.test(output);

    if (hasSources) evidence.push("research sources cited");
    if (hasAnalysis) evidence.push("analysis present");
    if (hasMetrics) evidence.push("metrics or data points present");
    if (hasStructure) evidence.push("structured output");

    if (output.length < 500) gaps.push("research output is brief");
    if (!hasSources) gaps.push("no sources cited");

    const passed = evidence.length >= 2;

    return {
      type: "research",
      status: passed ? "passed" : evidence.length > 0 ? "warning" : "needs_review",
      message: passed
        ? "Research validation passed"
        : gaps.length > 0
          ? `Research gaps: ${gaps.join("; ")}`
          : "Research output is minimal",
      evidence: evidence.join(", "),
      confidence: passed ? 0.8 : evidence.length > 0 ? 0.4 : 0.15,
      failureReason:
        gaps.length > 0
          ? { reason: "research_incomplete", detail: gaps.join("; "), severity: "warning" }
          : undefined,
      userReviewSuggestion: !passed
        ? "Research output may be incomplete. Review and supplement if needed."
        : undefined,
      details: { evidenceCount: evidence.length, gaps },
    };
  }

  private validateLogOutput(executorResult: ExecutorResult): ValidationCheck {
    const output = executorResult.output ?? "";
    const error = executorResult.error ?? "";
    const evidence: string[] = [];
    const issues: string[] = [];

    if (output.length > 0) evidence.push("log output captured");
    if (error.length > 0) evidence.push("error output captured");

    const errorPatterns = [
      /error/i,
      /exception/i,
      /traceback/i,
      /failed/i,
      /timeout/i,
      /uncaught/i,
      /unhandled/i,
    ];
    const warningPatterns = [/warn/i, /deprecated/i, /deprecat/i];

    const errorMatches: string[] = [];
    const warningMatches: string[] = [];

    for (const pattern of errorPatterns) {
      const match = output.match(pattern);
      if (match) errorMatches.push(match[0]);
    }
    for (const pattern of warningPatterns) {
      const match = output.match(pattern);
      if (match) warningMatches.push(match[0]);
    }

    if (errorMatches.length > 0) {
      issues.push(`${errorMatches.length} error pattern(s) found in logs`);
    }
    if (warningMatches.length > 0) {
      issues.push(`${warningMatches.length} warning pattern(s) found in logs`);
    }

    const isClean = issues.length === 0;

    return {
      type: "log",
      status: isClean ? "passed" : "warning",
      message: isClean
        ? "No error/warning patterns detected in logs"
        : `Log issues: ${issues.join("; ")}`,
      evidence: evidence.join(", "),
      confidence: isClean ? 0.9 : 0.4,
      failureReason:
        issues.length > 0
          ? { reason: "log_issues_detected", detail: issues.join("; "), severity: "warning" }
          : undefined,
      userReviewSuggestion:
        issues.length > 0 ? "Review log entries for potential issues" : undefined,
      details: {
        outputLength: output.length,
        errorOutputLength: error.length,
        errorMatches,
        warningMatches,
      },
    };
  }

  private validateUiResult(executorResult: ExecutorResult): ValidationCheck {
    const output = executorResult.output ?? "";
    const evidence: string[] = [];

    if (/(rendered|displayed|shown|painted|mounted|loaded)/i.test(output)) {
      evidence.push("UI rendering mentioned");
    }
    if (/(screenshot|snapshot|preview|capture)/i.test(output)) {
      evidence.push("UI capture mentioned");
    }
    if (/(responsive|layout|design|component)/i.test(output)) {
      evidence.push("UI structure mentioned");
    }
    if (executorResult.artifacts?.some((a) => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(a))) {
      evidence.push("UI screenshot artifact found");
    }

    return {
      type: "ui_result",
      status: evidence.length > 0 ? "passed" : "needs_review",
      message:
        evidence.length > 0
          ? "UI output detected"
          : "No UI output detected — manual review may be needed",
      evidence: evidence.join(", ") || "No UI evidence found",
      confidence: evidence.length > 0 ? 0.7 : 0.1,
      failureReason:
        evidence.length === 0
          ? {
              reason: "no_ui_evidence",
              detail: "No UI-related output or screenshots detected",
              severity: "warning",
            }
          : undefined,
      userReviewSuggestion:
        evidence.length === 0
          ? "Manual review required: no UI output captured automatically"
          : undefined,
      details: { evidenceCount: evidence.length },
    };
  }

  private validateChecklist(executorResult: ExecutorResult, task: Task): ValidationCheck {
    const output = executorResult.output ?? "";
    const evidence: string[] = [];

    const listPattern = /^[-*]\s/m;
    const numPattern = /^\d+\.\s/m;
    const checkPattern = /\[[\sxX]\]/m;
    const donePattern = /(done|complete|finished|passed|checked)/i;
    const totalPattern = /(\d+)\s*\/\s*(\d+)/;

    const hasListItems = listPattern.test(output) || numPattern.test(output);
    const hasCheckboxes = checkPattern.test(output);
    const hasDoneMentions = donePattern.test(output);
    const hasProgress = totalPattern.test(output);

    if (hasListItems) evidence.push("checklist items found in output");
    if (hasCheckboxes) evidence.push("checkbox-style checklist detected");
    if (hasDoneMentions) evidence.push("completion status mentioned");
    if (hasProgress) {
      const match = output.match(totalPattern);
      if (match) evidence.push(`progress: ${match[1]}/${match[2]} items`);
    }

    const passed = evidence.length >= 2;

    return {
      type: "checklist",
      status: passed ? "passed" : "warning",
      message: passed
        ? "Checklist validation passed — items and progress found"
        : evidence.length > 0
          ? "Checklist partially detected"
          : "No checklist structure found in output",
      evidence: evidence.join(", "),
      confidence: passed ? 0.85 : evidence.length > 0 ? 0.4 : 0.1,
      failureReason:
        !passed && evidence.length === 0
          ? {
              reason: "no_checklist",
              detail: "No checklist structure or progress indicators found",
              severity: "warning",
            }
          : undefined,
      userReviewSuggestion:
        evidence.length < 2
          ? "Checklist may exist but automatic detection was inconclusive"
          : undefined,
      details: {
        evidenceCount: evidence.length,
        hasListItems,
        hasCheckboxes,
        hasDoneMentions,
        hasProgress,
      },
    };
  }

  private validateRequirementCoverage(executorResult: ExecutorResult, task: Task): ValidationCheck {
    const output = executorResult.output ?? "";
    const criteria = task.acceptanceCriteria ?? [];
    const evidence: string[] = [];
    const uncovered: string[] = [];

    for (const criterion of criteria) {
      const lower = criterion.toLowerCase();
      if (output.toLowerCase().includes(lower)) {
        evidence.push(`covered: "${criterion.slice(0, 40)}"`);
      } else {
        uncovered.push(criterion);
      }
    }

    if (
      task.expectedResult &&
      output.toLowerCase().includes(task.expectedResult.toLowerCase().slice(0, 50))
    ) {
      evidence.push("expected result confirmed in output");
    }

    const coverage = criteria.length > 0 ? (evidence.length / criteria.length) * 100 : 0;

    const passed = coverage >= 80 || (criteria.length === 0 && evidence.length > 0);

    return {
      type: "requirement_coverage",
      status: passed ? "passed" : coverage >= 50 ? "warning" : "failed",
      message:
        criteria.length > 0
          ? `Requirement coverage: ${evidence.length}/${criteria.length} (${Math.round(coverage)}%)`
          : "No explicit acceptance criteria to validate",
      evidence: evidence.join(", "),
      confidence: criteria.length > 0 ? coverage / 100 : 0.5,
      failureReason:
        !passed && criteria.length > 0
          ? {
              reason: "insufficient_coverage",
              detail: `Only ${evidence.length}/${criteria.length} requirements confirmed in output`,
              severity: "error",
            }
          : undefined,
      retrySuggestion: !passed
        ? "Some requirements were not covered. Review the task output and retry if needed."
        : undefined,
      details: {
        totalCriteria: criteria.length,
        coveredCount: evidence.length,
        coveragePercent: Math.round(coverage),
        uncoveredCriteria: uncovered.length > 0 ? uncovered.slice(0, 5) : undefined,
      },
    };
  }

  private buildHybridCheck(
    checks: ValidationCheck[],
    aiCheck?: ValidationCheck,
  ): ValidationCheck | undefined {
    const nonAiChecks = checks.filter((c) => c.type !== "ai_review" && c.type !== "hybrid");
    if (nonAiChecks.length === 0) return undefined;

    const aiVerdict = aiCheck?.details?.verdict as AiVerdict | undefined;
    const hybridResult = this.hybridValidator.validate({
      deterministicChecks: nonAiChecks,
      aiVerdict,
      taskDescription: "",
    });

    return hybridResult;
  }

  private buildFinalResult(taskId: string, checks: ValidationCheck[]): ValidationResult {
    const allPassed = checks.every((c) => c.status === "passed");
    const anyFailed = checks.some((c) => c.status === "failed");
    const anyNeedsRetry = checks.some((c) => c.status === "needs_retry");
    const anyNeedsReview = checks.some((c) => c.status === "needs_review");
    const anyWarning = checks.some((c) => c.status === "warning");

    let finalStatus: ValidationResult["status"];
    if (anyFailed) finalStatus = "failed";
    else if (anyNeedsReview) finalStatus = "needs_review";
    else if (anyNeedsRetry) finalStatus = "needs_retry";
    else if (allPassed) finalStatus = "passed";
    else finalStatus = "warning";

    const confidence = this.calculateOverallConfidence(checks);
    const failureReason = this.buildFailureReason(finalStatus, checks);
    const retrySuggestion = this.buildRetrySuggestion(checks);
    const userReviewSuggestion = this.buildUserReviewSuggestion(finalStatus, checks);

    return {
      taskId,
      status: finalStatus,
      checks,
      createdAt: now(),
      confidence,
      failureReason,
      retrySuggestion,
      userReviewSuggestion,
    };
  }

  private calculateOverallConfidence(checks: ValidationCheck[]): number {
    if (checks.length === 0) return 0;

    const scored = checks.filter((c) => c.confidence !== undefined);
    if (scored.length > 0) {
      const weights = scored.map((c) => {
        const weight =
          c.status === "passed"
            ? 1.0
            : c.status === "warning"
              ? 0.6
              : c.status === "failed"
                ? 0
                : c.status === "needs_retry"
                  ? 0.3
                  : c.status === "needs_review"
                    ? 0.2
                    : c.status === "skipped"
                      ? 0.5
                      : 0.4;
        return (c.confidence ?? 0.5) * weight;
      });
      const totalWeight = scored.length;
      return Math.round((weights.reduce((a, b) => a + b, 0) / totalWeight) * 100) / 100;
    }

    const passedCount = checks.filter((c) => c.status === "passed").length;
    return Math.round((passedCount / checks.length) * 100) / 100;
  }

  private buildFailureReason(
    finalStatus: string,
    checks: ValidationCheck[],
  ): FailureReason | undefined {
    if (finalStatus === "passed") return undefined;

    const failed = checks.find((c) => c.status === "failed");
    if (failed) {
      if (typeof failed.failureReason === "object") return failed.failureReason;
      return {
        reason: failed.message ?? "validation check failed",
        severity: "error",
      };
    }

    const needsReview = checks.find((c) => c.status === "needs_review");
    if (needsReview) {
      if (typeof needsReview.failureReason === "object") return needsReview.failureReason;
      return {
        reason: needsReview.message ?? "needs user review",
        severity: "warning",
      };
    }

    const needsRetry = checks.find((c) => c.status === "needs_retry");
    if (needsRetry) {
      if (typeof needsRetry.failureReason === "object") return needsRetry.failureReason;
      return {
        reason: needsRetry.message ?? "retry suggested",
        severity: "warning",
      };
    }

    return {
      reason: "validation_incomplete",
      detail: `Final status: ${finalStatus}`,
      severity: finalStatus === "failed" ? "error" : "warning",
    };
  }

  private buildRetrySuggestion(checks: ValidationCheck[]): string | undefined {
    for (const check of checks) {
      if (check.retrySuggestion) return check.retrySuggestion;
    }
    const failedCommands = checks.filter((c) => c.status === "failed" && c.command);
    if (failedCommands.length > 0) {
      return `Retry failed command: ${failedCommands[0]!.command}`;
    }
    return undefined;
  }

  private buildUserReviewSuggestion(
    finalStatus: string,
    checks: ValidationCheck[],
  ): string | undefined {
    if (finalStatus === "passed") return undefined;
    if (finalStatus === "needs_review") {
      const reviewChecks = checks.filter((c) => c.userReviewSuggestion);
      if (reviewChecks.length > 0) {
        return reviewChecks.map((c) => c.userReviewSuggestion).join("; ");
      }
      return "Multiple checks need human review. Inspect the task output and validation results.";
    }
    return undefined;
  }

  // ── AI validation ────────────────────────────────────

  private getAiValidationMode(): AiValidationMode {
    return this.config?.validation?.aiValidation ?? "fallback";
  }

  private hasDeterministicFailure(checks: ValidationCheck[]): boolean {
    if (checks.length === 0) return false;
    const nonAiChecks = checks.filter((c) => c.type !== "ai_review" && c.type !== "hybrid");
    return nonAiChecks.some((c) => c.status === "failed");
  }

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

    const workflowType = this.detectWorkflowType(input.task.description);
    const previousValidationResults = this.buildPreviousValidationSummary(checks);

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
        workflowType,
        previousValidationResults,
        logs: input.executorResult.output ?? undefined,
      });
    } catch {
      return {
        type: "ai_review",
        status: "skipped",
        message: "AI validation could not run — provider unavailable or error",
        confidence: 0,
        details: { reason: "ai_provider_error" },
      };
    }

    const deterministicFailed = checks.some(
      (c) =>
        c.type !== "ai_review" &&
        c.type !== "hybrid" &&
        c.type !== "outcome_comparison" &&
        c.status === "failed",
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

    const confidenceMap: Record<string, number> = {
      passed: 0.85,
      warning: 0.5,
      failed: 0.1,
      needs_retry: 0.35,
      needs_review: 0.2,
      skipped: 0,
    };

    return {
      type: "ai_review",
      status: aiStatus as ValidationCheck["status"],
      message: this.buildAiMessage(aiStatus, verdict.suggestion, deterministicFailed),
      confidence: confidenceMap[aiStatus] ?? 0.3,
      validationMethod: "ai_semantic",
      failureReason:
        aiStatus === "failed"
          ? { reason: "ai_validation_failed", detail: verdict.suggestion, severity: "error" }
          : aiStatus === "needs_review"
            ? { reason: "ai_needs_review", detail: verdict.suggestion, severity: "warning" }
            : aiStatus === "needs_retry"
              ? { reason: "ai_suggests_retry", detail: verdict.suggestion, severity: "warning" }
              : undefined,
      retrySuggestion:
        aiStatus === "needs_retry"
          ? verdict.suggestion || "Retry may resolve the issue"
          : undefined,
      userReviewSuggestion:
        aiStatus === "needs_review"
          ? verdict.suggestion || "Evidence is ambiguous — manual review required"
          : undefined,
      details: {
        verdict,
        evidenceSummary,
        mode,
        deterministicFailed,
      },
    };
  }

  private buildPreviousValidationSummary(checks: ValidationCheck[]): string {
    const lines: string[] = [];
    for (const c of checks) {
      const statusIcon = c.status === "passed" ? "✓" : c.status === "failed" ? "✗" : "?";
      lines.push(`[${statusIcon}] ${c.type}: ${c.status}${c.message ? ` — ${c.message}` : ""}`);
      if (c.evidence) {
        lines.push(`  Evidence: ${c.evidence}`);
      }
    }
    return lines.join("\n");
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
        confidence: this.calculateOverallConfidence(checks),
        failureReason: this.buildFailureReason(finalStatus, checks),
        retrySuggestion: this.buildRetrySuggestion(checks),
        userReviewSuggestion: this.buildUserReviewSuggestion(finalStatus, checks),
      };
    }

    return this.buildFinalResult(taskId, checks);
  }
}
