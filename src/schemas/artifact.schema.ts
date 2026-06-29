import { z } from "zod";

export const ARTIFACT_TYPES = [
  "created_file",
  "modified_file",
  "deleted_file",
  "renamed_file",
  "document",
  "report",
  "summary",
  "log",
  "data_file",
  "research_note",
  "decision",
  "checklist",
  "screenshot",
  "code_change",
  "generated_artifact",
  "config_change",
  "command_result",
  "test_result",
  "build_result",
  "translation",
  "design_artifact",
  "analysis",
  "recommendation",
  "mixed_artifact",
  "other",
] as const;

export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPES);

export const ArtifactValidationStatusSchema = z.enum([
  "pending",
  "passed",
  "failed",
  "skipped",
  "needs_review",
]);

export const ArtifactOriginSchema = z.enum(["expected", "unexpected", "related"]);

export const ArtifactSchema = z.object({
  artifactId: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().optional(),
  stepId: z.string().optional(),
  title: z.string().min(1),
  type: z.string().min(1),
  path: z.string().min(1),
  filePath: z.string().min(1),
  fileSize: z.number().int().min(0).default(0),
  mimeType: z.string().optional(),
  hashSha256: z.string().optional(),
  summary: z.string().optional(),
  origin: ArtifactOriginSchema.default("expected"),
  validationStatus: ArtifactValidationStatusSchema.default("pending"),
  diff: z.string().optional(),
  diffStat: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  modifiedAt: z.string().datetime().optional(),
});

export type ArtifactRecord = z.infer<typeof ArtifactSchema>;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type ArtifactValidationStatus = z.infer<typeof ArtifactValidationStatusSchema>;
export type ArtifactOrigin = z.infer<typeof ArtifactOriginSchema>;
