import { z } from "zod";

export const QualityCommandResultSchema = z.object({
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "timeout"]),
  exitCode: z.number().int().optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  output: z.string().optional(),
  error: z.string().optional(),
});

export const QualityGateResultSchema = z.object({
  status: z.enum(["passed", "failed", "skipped"]),
  commands: z.array(QualityCommandResultSchema),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
});

export type QualityCommandResult = z.infer<typeof QualityCommandResultSchema>;
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;
