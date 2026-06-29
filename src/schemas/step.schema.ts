import { z } from "zod";
import { OutputPlanSchema } from "./output-plan.schema.js";

export const StepStatusSchema = z.enum([
  "created",
  "pending",
  "running",
  "waiting_approval",
  "waiting_input",
  "waiting_dependency",
  "validating",
  "retrying",
  "paused",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
  "stuck",
  "needs_user_review",
  "pending_approval",
  "approved",
  "denied",
  "done",
  "interrupted",
]);

export const StepTypeSchema = z.enum(["command", "read", "write", "edit", "shell", "approval"]);

export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).default(2),
  retryDelayMs: z.number().int().min(0).default(1000),
  retryBackoff: z.enum(["linear", "exponential", "fixed"]).default("linear"),
});

export const TimeoutPolicySchema = z.object({
  durationMs: z.number().int().min(0),
  action: z.enum(["fail", "retry", "cancel", "skip"]).default("fail"),
});

export const StepErrorSchema = z.object({
  message: z.string().min(1),
  timestamp: z.string().datetime(),
  retryCount: z.number().int().min(0),
  evidence: z.string().optional(),
  suggestedFix: z.string().optional(),
});

export const StepSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  type: StepTypeSchema.default("command"),
  command: z.string().optional(),
  status: StepStatusSchema,
  expectedResult: z.string().optional(),
  outputPlan: OutputPlanSchema.optional(),
  requiresApproval: z.boolean().default(false),
  approvalReason: z.string().optional(),
  exitCode: z.number().int().optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  order: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  dependsOn: z.array(z.string()).optional().default([]),
  condition: z.string().optional(),
  retryPolicy: RetryPolicySchema.optional(),
  timeout: TimeoutPolicySchema.optional(),
  checkpointId: z.string().optional(),
  input: z.record(z.unknown()).optional(),
  expectedOutput: z.record(z.unknown()).optional(),
  output: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  errors: z.array(StepErrorSchema).optional(),
});

export const StepsMapSchema = z.record(z.string(), z.array(StepSchema));

export const StepsFileSchema = z.object({
  runId: z.string().min(1),
  stepsByTask: StepsMapSchema,
});

export const STEP_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  created: ["pending", "cancelled"],
  pending: ["running", "skipped", "cancelled"],
  running: [
    "succeeded",
    "failed",
    "waiting_approval",
    "waiting_input",
    "waiting_dependency",
    "validating",
    "paused",
    "cancelled",
    "stuck",
    "needs_user_review",
  ],
  waiting_approval: ["running", "cancelled", "skipped"],
  waiting_input: ["running", "cancelled"],
  waiting_dependency: ["running", "cancelled"],
  validating: ["succeeded", "failed", "needs_user_review", "retrying"],
  retrying: ["running", "cancelled", "failed"],
  paused: ["running", "cancelled"],
  succeeded: [],
  failed: ["pending", "skipped", "cancelled", "retrying"],
  skipped: ["pending"],
  cancelled: [],
  stuck: ["running", "failed", "cancelled"],
  needs_user_review: ["pending", "running", "cancelled", "succeeded", "failed"],
  pending_approval: ["approved", "denied", "cancelled", "running"],
  approved: ["running", "cancelled"],
  denied: ["cancelled", "skipped"],
  done: [],
  interrupted: ["pending", "cancelled", "skipped"],
};

export function isValidStepTransition(from: string, to: string): boolean {
  const allowed = STEP_ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function isStepTerminal(status: string): boolean {
  return ["succeeded", "done", "failed", "skipped", "cancelled"].includes(status);
}

export function isStepActive(status: string): boolean {
  return [
    "running",
    "waiting_approval",
    "waiting_input",
    "waiting_dependency",
    "validating",
    "retrying",
    "needs_user_review",
    "pending_approval",
  ].includes(status);
}

export type Step = z.infer<typeof StepSchema>;
export type StepStatus = z.infer<typeof StepStatusSchema>;
export type StepType = z.infer<typeof StepTypeSchema>;
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
export type TimeoutPolicy = z.infer<typeof TimeoutPolicySchema>;
export type StepError = z.infer<typeof StepErrorSchema>;
