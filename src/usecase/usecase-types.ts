import { z } from "zod";

export const UseCaseTypeSchema = z.enum([
  "coding",
  "documentation",
  "debugging",
  "research",
  "planning",
  "project-setup",
  "testing",
  "devops",
  "data-analysis",
  "ui-design",
  "writing",
  "general",
]);

export const UseCaseDetectionSchema = z.object({
  type: UseCaseTypeSchema,
  confidence: z.number().min(0).max(1),
  matchedPatterns: z.array(z.string()).default([]),
});

export const UseCaseConfigSchema = z.object({
  enabled: z.boolean().default(true),
  customPatterns: z
    .array(
      z.object({
        type: UseCaseTypeSchema,
        patterns: z.array(z.string()),
      }),
    )
    .optional()
    .default([]),
  confidenceThreshold: z.number().min(0).max(1).default(0.3),
});

export const TaskTemplateSchema = z.object({
  useCase: UseCaseTypeSchema,
  title: z.string(),
  description: z.string(),
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      executor: z.string().default("shell"),
      acceptanceCriteria: z.array(z.string()),
    }),
  ),
});

export type UseCaseType = z.infer<typeof UseCaseTypeSchema>;
export type UseCaseDetection = z.infer<typeof UseCaseDetectionSchema>;
export type UseCaseConfig = z.infer<typeof UseCaseConfigSchema>;
export type TaskTemplate = z.infer<typeof TaskTemplateSchema>;
