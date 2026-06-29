import { z } from "zod";

export const ValidationCheckStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
  "warning",
  "skipped",
  "needs_retry",
  "needs_review",
]);

export const ValidationCheckTypeSchema = z.enum([
  "process",
  "file",
  "artifact",
  "command",
  "git_diff",
  "manual",
  "ai_review",
  "acceptance_criteria",
  "content",
  "outcome_comparison",
  "output_plan",
  "evidence",
  "document",
  "research",
  "data",
  "log",
  "ui_result",
  "checklist",
  "requirement_coverage",
  "deterministic",
  "hybrid",
  "semantic",
]);

export const ValidationMethodSchema = z.enum(["deterministic", "ai_semantic", "hybrid"]);

export const FailureReasonSchema = z.object({
  reason: z.string(),
  detail: z.string().optional(),
  evidenceGap: z.string().optional(),
  severity: z.enum(["error", "warning", "info"]).optional(),
});

export const ValidationCheckSchema = z.object({
  type: ValidationCheckTypeSchema,
  status: ValidationCheckStatusSchema,
  message: z.string().optional(),
  command: z.string().optional(),
  path: z.string().optional(),
  exitCode: z.number().int().optional(),
  criteria: z.string().optional(),
  evidence: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  failureReason: z.union([z.string(), FailureReasonSchema]).optional(),
  retrySuggestion: z.string().optional(),
  userReviewSuggestion: z.string().optional(),
  validationMethod: ValidationMethodSchema.optional(),
  details: z.record(z.unknown()).optional(),
});

export const ValidationResultSchema = z.object({
  taskId: z.string().min(1),
  status: ValidationCheckStatusSchema,
  checks: z.array(ValidationCheckSchema),
  createdAt: z.string().datetime(),
  confidence: z.number().min(0).max(1).optional(),
  failureReason: z.union([z.string(), FailureReasonSchema]).optional(),
  retrySuggestion: z.string().optional(),
  userReviewSuggestion: z.string().optional(),
});

export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;
export type ValidationCheckType = z.infer<typeof ValidationCheckTypeSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type ValidationCheckStatus = z.infer<typeof ValidationCheckStatusSchema>;
export type ValidationMethod = z.infer<typeof ValidationMethodSchema>;
export type FailureReason = z.infer<typeof FailureReasonSchema>;
