import { z } from "zod";

export const WorkflowStatusSchema = z.enum([
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
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
  "stuck",
  "needs_user_review",
  "partially_completed",
  "rollback_required",
  "rolled_back",
]);

export const WorkflowLifecycleEventTypeSchema = z.enum([
  "workflow_created",
  "scan_started",
  "scan_completed",
  "plan_created",
  "plan_approved",
  "plan_rejected",
  "step_started",
  "step_completed",
  "step_failed",
  "step_retried",
  "step_skipped",
  "step_cancelled",
  "approval_requested",
  "approval_accepted",
  "approval_rejected",
  "command_started",
  "command_completed",
  "command_failed",
  "artifact_created",
  "artifact_updated",
  "file_changed",
  "validation_started",
  "validation_passed",
  "validation_failed",
  "validation_skipped",
  "workflow_paused",
  "workflow_resumed",
  "workflow_completed",
  "workflow_cancelled",
  "workflow_failed",
  "checkpoint_saved",
  "checkpoint_restored",
  "workflow_recovered",
  "state_transition",
  "gate_approval_required",
  "gate_approved",
  "gate_rejected",
  "gate_overridden",
  "gate_skipped",
  "auto_approved",
]);

export const WorkflowLifecycleEventSchema = z.object({
  type: WorkflowLifecycleEventTypeSchema,
  timestamp: z.string().datetime(),
  workflowStatus: WorkflowStatusSchema,
  stepId: z.string().optional(),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export const PendingGateSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  actionType: z.string().min(1),
  riskLevel: z.string().min(1),
  reason: z.string().min(1),
  details: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected", "overridden"]).default("pending"),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: z.string().optional(),
});

export const ApprovalHistoryEntrySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().optional(),
  actionType: z.string().min(1),
  riskLevel: z.string().min(1),
  decision: z.enum(["approved", "rejected", "override", "skip"]),
  reason: z.string().optional(),
  autoApproved: z.boolean().default(false),
  createdAt: z.string().datetime(),
});

export const WorkflowStateSchema = z.object({
  runId: z.string().min(1),
  status: WorkflowStatusSchema,
  previousStatus: WorkflowStatusSchema.optional(),
  currentStepId: z.string().optional(),
  checkpointId: z.string().optional(),
  retryCount: z.number().int().min(0).default(0),
  errorCount: z.number().int().min(0).default(0),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  pausedAt: z.string().datetime().optional(),
  resumedAt: z.string().datetime().optional(),
  lifecycle: z.array(WorkflowLifecycleEventSchema).default([]),
  pendingGates: z.array(PendingGateSchema).optional(),
  approvalHistory: z.array(ApprovalHistoryEntrySchema).optional(),
  metadata: z.record(z.unknown()).optional(),
  updatedAt: z.string().datetime(),
});

export const WORKFLOW_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  created: ["scanning", "cancelled"],
  scanning: ["planning", "cancelled", "failed"],
  planning: ["planned", "failed", "cancelled"],
  planned: ["waiting_plan_approval", "ready", "cancelled"],
  waiting_plan_approval: ["approved", "cancelled", "planned", "failed"],
  approved: ["ready", "cancelled"],
  ready: ["running", "cancelled", "skipped"],
  running: [
    "waiting_approval",
    "waiting_input",
    "waiting_dependency",
    "validating",
    "retrying",
    "paused",
    "succeeded",
    "failed",
    "cancelled",
    "stuck",
    "needs_user_review",
    "partially_completed",
  ],
  waiting_approval: ["running", "cancelled"],
  waiting_input: ["running", "cancelled"],
  waiting_dependency: ["running", "cancelled"],
  validating: ["succeeded", "failed", "retrying", "needs_user_review"],
  retrying: ["running", "failed", "cancelled"],
  paused: ["running", "cancelled", "failed"],
  succeeded: [],
  failed: ["running", "retrying", "cancelled", "rollback_required"],
  skipped: [],
  cancelled: [],
  stuck: ["running", "failed", "cancelled"],
  needs_user_review: ["running", "cancelled", "succeeded", "failed"],
  partially_completed: ["running", "cancelled", "succeeded", "rollback_required"],
  rollback_required: ["rolled_back", "cancelled", "failed"],
  rolled_back: [],
};

export function isValidWorkflowTransition(from: string, to: string): boolean {
  const allowed = WORKFLOW_ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function isWorkflowTerminal(status: string): boolean {
  return ["succeeded", "failed", "skipped", "cancelled", "rolled_back"].includes(status);
}

export function isWorkflowActive(status: string): boolean {
  return [
    "running",
    "scanning",
    "planning",
    "waiting_approval",
    "waiting_input",
    "waiting_dependency",
    "validating",
    "retrying",
    "needs_user_review",
    "partially_completed",
  ].includes(status);
}

export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type WorkflowLifecycleEventType = z.infer<typeof WorkflowLifecycleEventTypeSchema>;
export type WorkflowLifecycleEvent = z.infer<typeof WorkflowLifecycleEventSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export type PendingGate = z.infer<typeof PendingGateSchema>;
export type ApprovalHistoryEntry = z.infer<typeof ApprovalHistoryEntrySchema>;
