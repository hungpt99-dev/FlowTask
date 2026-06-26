import { z } from "zod";

export const RunStatusSchema = z.enum([
  "created",
  "planning",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const RunModeSchema = z.enum(["auto", "manual", "plan-only", "dry-run", "debug"]);

export const RunSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  status: RunStatusSchema,
  mode: RunModeSchema.default("auto"),
  promptPath: z.string().optional(),
  planPath: z.string().optional(),
  taskCount: z.number().int().min(0).default(0),
  completedTaskCount: z.number().int().min(0).default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const RunIndexSchema = z.object({
  projectId: z.string().min(1),
  runs: z.array(
    z.object({
      runId: z.string().min(1),
      title: z.string().min(1),
      status: RunStatusSchema,
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    }),
  ),
});

export type Run = z.infer<typeof RunSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunMode = z.infer<typeof RunModeSchema>;
export type RunIndex = z.infer<typeof RunIndexSchema>;
