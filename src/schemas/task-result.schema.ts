import { z } from "zod";

export const TaskResultStatusSchema = z.enum(["passed", "failed", "warning", "skipped"]);

export const TaskResultSchema = z.object({
  resultId: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  attempt: z.number().int().min(0),
  status: TaskResultStatusSchema,
  exitCode: z.number().int().optional(),
  outputPath: z.string().optional(),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().int().optional(),
  createdAt: z.string().datetime(),
});

export type TaskResultRecord = z.infer<typeof TaskResultSchema>;
export type TaskResultStatus = z.infer<typeof TaskResultStatusSchema>;
