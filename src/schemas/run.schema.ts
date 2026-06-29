import { z } from "zod";

export const RunStatusSchema = z.enum([
  "created",
  "scanning",
  "planning",
  "planned",
  "waiting_plan_approval",
  "approved",
  "ready",
  "running",
  "waiting_approval",
  "waiting_input",
  "waiting_dependency",
  "validating",
  "retrying",
  "paused",
  "completed",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
  "stuck",
  "needs_user_review",
  "partially_completed",
  "rollback_required",
  "rolled_back",
  "interrupted",
]);

export const RunModeSchema = z.enum(["auto", "manual", "plan-only", "dry-run", "debug"]);

export const TimelineEventTypeSchema = z.enum([
  "workflow_created",
  "workflow_scanning",
  "scan_started",
  "scan_completed",
  "workflow_planning",
  "plan_created",
  "plan_approved",
  "plan_rejected",
  "workflow_approved",
  "workflow_ready",
  "workflow_running",
  "step_started",
  "step_completed",
  "step_failed",
  "step_retried",
  "step_skipped",
  "step_blocked",
  "step_needs_review",
  "step_approved",
  "step_denied",
  "approval_requested",
  "approval_accepted",
  "approval_rejected",
  "approval_skipped",
  "approval_expired",
  "command_started",
  "command_completed",
  "command_blocked",
  "artifact_created",
  "artifact_validated",
  "file_changed",
  "file_created",
  "file_modified",
  "file_deleted",
  "file_renamed",
  "validation_started",
  "validation_passed",
  "validation_failed",
  "validation_skipped",
  "workflow_paused",
  "workflow_resumed",
  "workflow_completed",
  "workflow_cancelled",
  "workflow_failed",
  "workflow_stuck",
  "workflow_needs_review",
  "workflow_partial",
  "workflow_rollback",
  "workflow_rolled_back",
  "workflow_retrying",
  "error_occurred",
  "error_resolved",
  "cost_limit_reached",
  "hook_executed",
  "hook_failed",
  "recovery_started",
  "recovery_completed",
  "recovery_failed",
]);

export const TimelineEventSchema = z.object({
  type: TimelineEventTypeSchema,
  timestamp: z.string().datetime(),
  runId: z.string().optional(),
  taskId: z.string().optional(),
  stepId: z.string().optional(),
  status: z.string().optional(),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export const CostUsageSchema = z.object({
  totalCost: z.number().min(0).default(0),
  currency: z.string().default("USD"),
  byStep: z.record(z.number()).optional(),
  byProvider: z.record(z.number()).optional(),
});

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  totalTokens: z.number().int().min(0).default(0),
  byStep: z
    .record(
      z.object({
        inputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
      }),
    )
    .optional(),
  byProvider: z
    .record(
      z.object({
        inputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
      }),
    )
    .optional(),
});

export const RunApprovalSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["plan", "step", "continue_after_failure", "override_validation"]),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  status: z.enum(["pending", "approved", "rejected"]),
  requestedBy: z.string().optional(),
  reason: z.string().optional(),
});

export const RunErrorSchema = z.object({
  stepId: z.string().optional(),
  taskId: z.string().optional(),
  message: z.string().min(1),
  timestamp: z.string().datetime(),
  retryCount: z.number().int().min(0).optional(),
  evidence: z.string().optional(),
  suggestedFix: z.string().optional(),
});

export const RunFileChangeSchema = z.object({
  path: z.string().min(1),
  type: z.enum(["created", "modified", "deleted", "renamed"]),
  oldPath: z.string().optional(),
  expected: z.boolean().optional(),
  diffStat: z.string().optional(),
});

export const RunSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  status: RunStatusSchema,
  mode: RunModeSchema.default("auto"),
  userGoal: z.string().optional(),
  promptPath: z.string().optional(),
  planPath: z.string().optional(),
  planMd: z.string().optional(),
  taskCount: z.number().int().min(0).default(0),
  completedTaskCount: z.number().int().min(0).default(0),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  durationMs: z.number().int().min(0).optional(),
  costUsage: CostUsageSchema.optional(),
  tokenUsage: TokenUsageSchema.optional(),
  timeline: z.array(TimelineEventSchema).optional(),
  approvals: z.array(RunApprovalSchema).optional(),
  errors: z.array(RunErrorSchema).optional(),
  artifactCount: z.number().int().min(0).optional(),
  fileChangeCount: z.number().int().min(0).optional(),
  errorCount: z.number().int().min(0).optional(),
  retryCount: z.number().int().min(0).optional(),
  approvalCount: z.number().int().min(0).optional(),
  fileChanges: z.array(RunFileChangeSchema).optional(),
  finalReportPath: z.string().optional(),
  finalReportMd: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const RunIndexEntrySchema = z.object({
  runId: z.string().min(1),
  title: z.string().min(1),
  status: RunStatusSchema,
  mode: RunModeSchema.optional(),
  userGoal: z.string().optional(),
  taskCount: z.number().int().min(0).default(0),
  completedTaskCount: z.number().int().min(0).default(0),
  errorCount: z.number().int().min(0).optional(),
  retryCount: z.number().int().min(0).optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  durationMs: z.number().int().min(0).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const RunIndexSchema = z.object({
  projectId: z.string().min(1),
  runs: z.array(RunIndexEntrySchema),
});

export const RunExportSchema = z.object({
  run: RunSchema,
  tasks: z.array(z.unknown()),
  steps: z.record(z.string(), z.array(z.unknown())).optional(),
  artifacts: z.array(z.unknown()).optional(),
  events: z.array(z.unknown()).optional(),
  exportedAt: z.string().datetime(),
  exportVersion: z.string().default("1.0"),
});

export const RunComparisonSchema = z.object({
  run1: z.object({
    runId: z.string(),
    title: z.string(),
    status: RunStatusSchema,
    taskCount: z.number(),
    completedTaskCount: z.number(),
    errorCount: z.number().optional().default(0),
    createdAt: z.string(),
  }),
  run2: z.object({
    runId: z.string(),
    title: z.string(),
    status: RunStatusSchema,
    taskCount: z.number(),
    completedTaskCount: z.number(),
    errorCount: z.number().optional().default(0),
    createdAt: z.string(),
  }),
  sameProject: z.boolean(),
  statusMatch: z.boolean(),
  taskCountDiff: z.number(),
  completedDiff: z.number(),
  errorDiff: z.number(),
  timeBetween: z.number().optional(),
});

export type Run = z.infer<typeof RunSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunMode = z.infer<typeof RunModeSchema>;
export type RunIndex = z.infer<typeof RunIndexSchema>;
export type RunIndexEntry = z.infer<typeof RunIndexEntrySchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type TimelineEventType = z.infer<typeof TimelineEventTypeSchema>;
export type CostUsage = z.infer<typeof CostUsageSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type RunApproval = z.infer<typeof RunApprovalSchema>;
export type RunError = z.infer<typeof RunErrorSchema>;
export type RunFileChange = z.infer<typeof RunFileChangeSchema>;
export type RunExport = z.infer<typeof RunExportSchema>;
export type RunComparison = z.infer<typeof RunComparisonSchema>;

export interface RunFilterOptions {
  status?: RunStatus | RunStatus[];
  mode?: RunMode | RunMode[];
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  hasErrors?: boolean;
  hasUnfinished?: boolean;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

export function isRunTerminal(status: RunStatus): boolean {
  return ["succeeded", "failed", "cancelled", "skipped", "rolled_back", "completed"].includes(
    status,
  );
}

export function isRunActive(status: RunStatus): boolean {
  return [
    "running",
    "waiting_approval",
    "waiting_input",
    "waiting_dependency",
    "validating",
    "retrying",
    "needs_user_review",
    "waiting_plan_approval",
  ].includes(status);
}
