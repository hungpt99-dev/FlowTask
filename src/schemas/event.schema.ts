import { z } from "zod";

export const EventTypeSchema = z.enum([
  "project_initialized",
  "rules_loaded",
  "rules_missing",
  "run_created",
  "run_started",
  "run_completed",
  "run_failed",
  "run_interrupted",
  "task_created",
  "task_started",
  "task_completed",
  "task_failed",
  "task_interrupted",
  "context_pack_created",
  "executor_started",
  "executor_completed",
  "executor_failed",
  "command_started",
  "command_completed",
  "command_failed",
  "artifact_created",
  "validation_started",
  "validation_passed",
  "validation_failed",
  "approval_requested",
  "approval_approved",
  "approval_rejected",
  "quality_started",
  "quality_completed",
  "quality_failed",
]);

export const FlowTaskEventSchema = z.object({
  time: z.string().datetime(),
  type: EventTypeSchema,
  runId: z.string().optional(),
  taskId: z.string().optional(),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export type FlowTaskEvent = z.infer<typeof FlowTaskEventSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
