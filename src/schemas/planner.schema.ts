import { z } from "zod";

export const AiPlanTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  executor: z.string().min(1),
  dependsOn: z.array(z.string()).optional().default([]),
  riskLevel: z.enum(["safe", "risky", "dangerous"]).optional().default("safe"),
  acceptanceCriteria: z.array(z.string()).min(1, "Acceptance criteria must not be empty"),
  validation: z
    .object({
      commands: z.array(z.string()).optional(),
      requiredFiles: z.array(z.string()).optional(),
      requiredArtifacts: z.array(z.string()).optional(),
      requireGitDiff: z.boolean().optional(),
    })
    .optional(),
});

export const AiPlanOutputSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1),
  tasks: z.array(AiPlanTaskSchema).min(1).max(50),
});

export const PlannerConfigSchema = z.object({
  default: z.enum(["simple", "ai", "auto"]).default("auto"),
  executor: z.string().default("shell"),
  maxRetries: z.number().int().min(0).default(1),
  fallbackToSimple: z.boolean().default(true),
});

export type AiPlanOutput = z.infer<typeof AiPlanOutputSchema>;
export type AiPlanTask = z.infer<typeof AiPlanTaskSchema>;
export type PlannerConfig = z.infer<typeof PlannerConfigSchema>;
