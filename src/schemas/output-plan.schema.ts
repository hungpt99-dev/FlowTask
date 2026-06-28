import { z } from "zod";

export const OutputActionTypeSchema = z.enum(["create", "modify", "delete"]);

export const OutputValidationMethodSchema = z.enum([
  "file_exists",
  "file_content",
  "file_diff",
  "command_output",
  "test",
  "ai_review",
  "manual",
]);

export const OutputPlanItemSchema = z.object({
  action: OutputActionTypeSchema,
  target: z.string().min(1),
  description: z.string().optional(),
  validationMethod: OutputValidationMethodSchema.default("file_exists"),
  acceptanceCriteria: z.array(z.string()).optional(),
});

export const OutputPlanSchema = z.array(OutputPlanItemSchema);

export type OutputActionType = z.infer<typeof OutputActionTypeSchema>;
export type OutputValidationMethod = z.infer<typeof OutputValidationMethodSchema>;
export type OutputPlanItem = z.infer<typeof OutputPlanItemSchema>;
export type OutputPlan = z.infer<typeof OutputPlanSchema>;
