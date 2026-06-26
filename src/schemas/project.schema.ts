import { z } from "zod";

export const ProjectSchema = z.object({
  projectId: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  rootPath: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Project = z.infer<typeof ProjectSchema>;
