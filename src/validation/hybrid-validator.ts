import type { ValidationCheck, ValidationMethod } from "../schemas/validation.schema.js";
import type { AiValidator, AiVerdict } from "./ai-validator.js";

export interface HybridValidationInput {
  deterministicChecks: ValidationCheck[];
  aiVerdict?: AiVerdict;
  taskDescription: string;
}

export interface HybridResult extends ValidationCheck {
  confidence: number;
  deterministicScore: number;
  aiScore: number;
  validationMethod: ValidationMethod;
}

export class HybridValidator {
  private weightDeterministic: number;
  private weightAi: number;

  constructor(deterministicWeight = 0.6, aiWeight = 0.4) {
    this.weightDeterministic = deterministicWeight;
    this.weightAi = aiWeight;
  }

  validate(input: HybridValidationInput): HybridResult {
    const { deterministicChecks, aiVerdict, taskDescription } = input;

    const deterministicScore = this.scoreDeterministic(deterministicChecks);
    const aiScore = aiVerdict ? this.scoreAiVerdict(aiVerdict) : 0;

    const hasAi = aiVerdict !== undefined;
    const validationMethod: ValidationMethod = hasAi ? "hybrid" : "deterministic";

    let combinedScore: number;
    let status: HybridResult["status"];
    let failureReason: HybridResult["failureReason"];
    let retrySuggestion: HybridResult["retrySuggestion"];
    let userReviewSuggestion: HybridResult["userReviewSuggestion"];

    if (hasAi) {
      combinedScore = deterministicScore * this.weightDeterministic + aiScore * this.weightAi;
    } else {
      combinedScore = deterministicScore;
    }

    if (deterministicChecks.some((c) => c.status === "failed")) {
      const failed = deterministicChecks.find((c) => c.status === "failed");
      status = "failed";
      failureReason = {
        reason: "deterministic_check_failed",
        detail: `Deterministic check failed: ${failed?.message ?? "unknown"}`,
        severity: "error",
      };
      retrySuggestion = failed?.command ? `Retry command: ${failed.command}` : undefined;
      userReviewSuggestion =
        "A deterministic validation check failed. Review the failure before proceeding.";
    } else if (combinedScore >= 0.8) {
      status = "passed";
    } else if (combinedScore >= 0.5) {
      if (hasAi && aiVerdict?.status === "needs_retry") {
        status = "needs_retry";
        retrySuggestion = aiVerdict.suggestion || "Transient issue suspected, retry may resolve";
        failureReason = {
          reason: "ai_suggests_retry",
          detail: aiVerdict.explanation,
          severity: "warning",
        };
      } else {
        status = "warning";
        failureReason = {
          reason: "low_confidence",
          detail: `Combined confidence ${combinedScore.toFixed(2)}`,
          severity: "warning",
        };
      }
    } else if (combinedScore > 0) {
      status = "needs_review";
      failureReason = {
        reason: "insufficient_evidence",
        detail: `Combined confidence ${combinedScore.toFixed(2)} below threshold`,
        severity: "warning",
      };
      userReviewSuggestion =
        "Validation confidence is too low to determine success. Manual review required.";
    } else {
      status = "failed";
      failureReason = {
        reason: "no_evidence",
        detail: "No validation evidence available",
        severity: "error",
      };
    }

    return {
      type: "hybrid",
      status,
      message: this.buildHybridMessage(status, deterministicChecks, aiVerdict),
      evidence: this.buildHybridEvidence(deterministicChecks, aiVerdict),
      confidence: Math.round(combinedScore * 100) / 100,
      validationMethod,
      deterministicScore: Math.round(deterministicScore * 100) / 100,
      aiScore: Math.round(aiScore * 100) / 100,
      failureReason,
      retrySuggestion,
      userReviewSuggestion,
      details: {
        deterministicCount: deterministicChecks.length,
        deterministicPassed: deterministicChecks.filter((c) => c.status === "passed").length,
        deterministicFailed: deterministicChecks.filter((c) => c.status === "failed").length,
        aiAvailable: hasAi,
        aiVerdict: aiVerdict?.status,
        weightDeterministic: this.weightDeterministic,
        weightAi: this.weightAi,
      },
    };
  }

  private scoreDeterministic(checks: ValidationCheck[]): number {
    if (checks.length === 0) return 0;

    let score = 0;
    let maxScore = 0;

    for (const check of checks) {
      maxScore += 1;
      if (check.confidence !== undefined) {
        if (check.status === "passed") score += check.confidence;
        else if (check.status === "failed") score += 0;
        else if (check.status === "warning") score += check.confidence * 0.5;
        else score += check.confidence * 0.25;
      } else {
        if (check.status === "passed") score += 0.8;
        else if (check.status === "failed") score += 0;
        else if (check.status === "warning") score += 0.4;
        else score += 0.2;
      }
    }

    return score / maxScore;
  }

  private scoreAiVerdict(verdict: AiVerdict): number {
    const statusScore: Record<string, number> = {
      passed: 0.9,
      warning: 0.6,
      needs_retry: 0.4,
      needs_review: 0.3,
      failed: 0.1,
    };
    const confidenceScore: Record<string, number> = {
      high: 1.0,
      medium: 0.7,
      low: 0.4,
    };

    const baseScore = statusScore[verdict.status] ?? 0.2;
    const confScore = confidenceScore[verdict.confidence] ?? 0.5;

    return baseScore * confScore;
  }

  private buildHybridMessage(
    status: string,
    checks: ValidationCheck[],
    aiVerdict?: AiVerdict,
  ): string {
    const detPassed = checks.filter((c) => c.status === "passed").length;
    const detFailed = checks.filter((c) => c.status === "failed").length;
    const detTotal = checks.length;

    if (status === "passed") {
      return `Hybrid validation passed: ${detPassed}/${detTotal} deterministic checks passed${aiVerdict ? ", AI review confirms success" : ""}`;
    }
    if (status === "failed") {
      return `Hybrid validation failed: ${detFailed} deterministic checks failed`;
    }
    if (status === "needs_retry") {
      return `Hybrid validation suggests retry: ${aiVerdict?.suggestion ?? "transient issue suspected"}`;
    }
    if (status === "needs_review") {
      return `Hybrid validation needs review: confidence too low for automatic decision`;
    }
    return `Hybrid validation result: ${status}`;
  }

  private buildHybridEvidence(checks: ValidationCheck[], aiVerdict?: AiVerdict): string {
    const parts: string[] = [];
    parts.push(
      `Deterministic: ${checks.filter((c) => c.status === "passed").length}/${checks.length} passed`,
    );
    if (aiVerdict) {
      parts.push(`AI: ${aiVerdict.status} (confidence: ${aiVerdict.confidence})`);
    }
    return parts.join(" | ");
  }
}
