import { z } from "zod";

export const CheckpointStateTypeSchema = z.enum(["run_state", "task_state", "resume_point"]);

export const CheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().optional(),
  stepId: z.string().optional(),
  stateType: CheckpointStateTypeSchema,
  stateData: z.string(),
  isSnapshot: z.boolean().default(false),
  snapshotPath: z.string().optional(),
  snapshotSize: z.number().int().optional(),
  snapshotHash: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type CheckpointRecord = z.infer<typeof CheckpointSchema>;
export type CheckpointStateType = z.infer<typeof CheckpointStateTypeSchema>;
