import { z } from "zod";
import { OutputPlanSchema } from "./output-plan.schema.js";

export const TaskStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  "skipped",
  "blocked",
  "cancelled",
  "waiting_approval",
  "waiting_input",
  "interrupted",
]);

const INJECTION_PATTERNS = /\$\(|`/;

export const ValidationConfigSchema = z.object({
  commands: z
    .array(z.string())
    .optional()
    .refine((cmds) => !cmds || cmds.every((c) => !INJECTION_PATTERNS.test(c)), {
      message: "Validation commands must not contain shell injection patterns",
    }),
  requiredArtifacts: z.array(z.string()).optional(),
  requireGitDiff: z.boolean().optional(),
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  status: TaskStatusSchema,
  executor: z.string().default("shell"),
  dependsOn: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  validation: ValidationConfigSchema.optional(),
  expectedResult: z.string().optional(),
  outputPlan: OutputPlanSchema.optional(),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).default(2),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

export const TaskIndexSchema = z.object({
  projectId: z.string().min(1),
  tasks: z.array(
    z.object({
      taskId: z.string().min(1),
      runId: z.string().min(1),
      title: z.string().min(1),
      status: TaskStatusSchema,
    }),
  ),
});

export type Task = z.infer<typeof TaskSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskIndex = z.infer<typeof TaskIndexSchema>;
