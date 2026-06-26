import { z } from "zod";

export const PlannerRiskLevelSchema = z.enum(["safe", "risky", "dangerous"]);

export const PlannerTaskValidationSchema = z.object({
  commands: z.array(z.string()).optional().default([]),
  requiredFiles: z.array(z.string()).optional().default([]),
  requiredArtifacts: z.array(z.string()).optional().default([]),
  requireGitDiff: z.boolean().optional().default(false),
});

export const AiPlannerTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  executor: z.string().min(1),
  dependsOn: z.array(z.string()).optional().default([]),
  riskLevel: PlannerRiskLevelSchema.optional().default("safe"),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  validation: PlannerTaskValidationSchema.optional().default({}),
});

export const AiPlannerOutputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  tasks: z.array(AiPlannerTaskSchema).min(1).max(30),
});

export const PlannerConfigSchema = z.object({
  default: z.enum(["simple", "ai", "auto"]).default("auto"),
  executor: z.string().default("shell"),
  maxRetries: z.number().int().min(0).default(1),
  fallbackToSimple: z.boolean().default(true),
});

export type AiPlannerOutput = z.infer<typeof AiPlannerOutputSchema>;
export type AiPlannerTask = z.infer<typeof AiPlannerTaskSchema>;
export type PlannerConfig = z.infer<typeof PlannerConfigSchema>;
