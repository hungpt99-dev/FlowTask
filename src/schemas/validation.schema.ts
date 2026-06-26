import { z } from "zod";

export const ValidationCheckStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
  "warning",
  "skipped",
]);

export const ValidationCheckSchema = z.object({
  type: z.enum(["process", "file", "artifact", "command", "git_diff", "manual", "ai_review"]),
  status: ValidationCheckStatusSchema,
  message: z.string().optional(),
  command: z.string().optional(),
  path: z.string().optional(),
  exitCode: z.number().int().optional(),
});

export const ValidationResultSchema = z.object({
  taskId: z.string().min(1),
  status: ValidationCheckStatusSchema,
  checks: z.array(ValidationCheckSchema),
  createdAt: z.string().datetime(),
});

export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type ValidationCheckStatus = z.infer<typeof ValidationCheckStatusSchema>;
