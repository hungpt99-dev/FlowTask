import { z } from "zod";
import { OutputPlanSchema } from "./output-plan.schema.js";

export const StepStatusSchema = z.enum([
  "pending",
  "pending_approval",
  "approved",
  "denied",
  "running",
  "done",
  "failed",
  "cancelled",
  "interrupted",
]);

export const StepTypeSchema = z.enum(["command", "read", "write", "edit", "shell", "approval"]);

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
});

export const StepsMapSchema = z.record(z.string(), z.array(StepSchema));

export const StepsFileSchema = z.object({
  runId: z.string().min(1),
  stepsByTask: StepsMapSchema,
});

export type Step = z.infer<typeof StepSchema>;
export type StepStatus = z.infer<typeof StepStatusSchema>;
export type StepType = z.infer<typeof StepTypeSchema>;
