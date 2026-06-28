import { z } from "zod";

export const ArtifactSchema = z.object({
  artifactId: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().optional(),
  title: z.string().min(1),
  type: z.string().min(1),
  filePath: z.string().min(1),
  fileSize: z.number().int().min(0).default(0),
  mimeType: z.string().optional(),
  hashSha256: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type ArtifactRecord = z.infer<typeof ArtifactSchema>;
