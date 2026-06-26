import { z } from "zod";

export const ProjectStatusSchema = z.enum([
  "idle",
  "has_running_run",
  "has_failed_run",
  "has_interrupted_run",
]);

export const ProjectStateSchema = z.object({
  projectId: z.string().min(1),
  status: ProjectStatusSchema,
  activeRunId: z.string().optional(),
  lastRunId: z.string().optional(),
  updatedAt: z.string().datetime(),
});

export const RunStateSchema = z.object({
  runId: z.string().min(1),
  status: z.enum([
    "created",
    "planning",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  currentTaskId: z.string().optional(),
  progress: z.object({
    total: z.number().int().min(0),
    done: z.number().int().min(0),
    running: z.number().int().min(0),
    failed: z.number().int().min(0),
    pending: z.number().int().min(0),
  }),
  startedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
