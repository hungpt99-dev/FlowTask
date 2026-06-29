import { z } from "zod";
import { OutputPlanSchema } from "./output-plan.schema.js";

const INJECTION_PATTERNS = /\$\(|`/;

export const WorkflowValidationConfigSchema = z.object({
  commands: z
    .array(z.string())
    .optional()
    .refine((cmds) => !cmds || cmds.every((c) => !INJECTION_PATTERNS.test(c)), {
      message: "Validation commands must not contain shell injection patterns",
    }),
  requiredArtifacts: z.array(z.string()).optional(),
  requireGitDiff: z.boolean().optional(),
});

export const WorkflowTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  executor: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  validation: WorkflowValidationConfigSchema.optional(),
  expectedResult: z.string().optional(),
  outputPlan: OutputPlanSchema.optional(),
  maxRetries: z.number().int().min(0).optional(),
});

export const WorkflowFileSchema = z.object({
  runTitle: z.string().optional(),
  tasks: z.array(WorkflowTaskSchema).min(1),
});

export const WorkflowDiffEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  reason: z.string().optional(),
});

export const WorkflowDiffModifiedSchema = z.object({
  id: z.string().min(1),
  title: z
    .object({
      old: z.string(),
      new: z.string(),
    })
    .optional(),
  changes: z.array(z.string()),
});

export const WorkflowDiffSchema = z.object({
  added: z.array(WorkflowTaskSchema),
  removed: z.array(WorkflowDiffEntrySchema),
  modified: z.array(WorkflowDiffModifiedSchema),
  unchanged: z.array(z.string()),
});

export const WorkflowValidationResultSchema = z.object({
  valid: z.boolean(),
  cycles: z.array(z.array(z.string())).default([]),
  deadRefs: z.array(z.string()).default([]),
  orphans: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type WorkflowTask = z.infer<typeof WorkflowTaskSchema>;
export type WorkflowFile = z.infer<typeof WorkflowFileSchema>;
export type WorkflowDiff = z.infer<typeof WorkflowDiffSchema>;
export type WorkflowDiffEntry = z.infer<typeof WorkflowDiffEntrySchema>;
export type WorkflowDiffModified = z.infer<typeof WorkflowDiffModifiedSchema>;
export type WorkflowValidationResult = z.infer<typeof WorkflowValidationResultSchema>;
