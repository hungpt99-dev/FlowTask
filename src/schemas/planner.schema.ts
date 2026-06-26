import { z } from "zod";

export const PlannerRiskLevelSchema = z.enum([
  "safe",
  "risky",
  "dangerous",
  "low",
  "medium",
  "high",
]);

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
  commands: z.array(z.string()).optional().default([]),
  validation: PlannerTaskValidationSchema.optional().default({}),
});

export const AiPlannerOutputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  tasks: z.array(AiPlannerTaskSchema).min(1).max(30),
});

export const PlannerConfigSchema = z.object({
  default: z.enum(["simple", "ai", "auto"]).default("auto"),
  type: z.enum(["internal-ai", "external-ai", "simple"]).optional().default("internal-ai"),
  executor: z.string().default("opencode"),
  provider: z.string().default("openai"),
  model: z.string().default("gpt-4.1-mini"),
  baseUrl: z.string().optional(),
  stream: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).default(1),
  fallbackToSimple: z.boolean().default(true),
});

export function normalizeRiskLevel(risk: string): "safe" | "risky" | "dangerous" {
  switch (risk) {
    case "low":
      return "safe";
    case "medium":
      return "risky";
    case "high":
      return "dangerous";
    case "safe":
    case "risky":
    case "dangerous":
      return risk;
    default:
      return "safe";
  }
}

export function isValidRequiredArtifact(path: string): boolean {
  const knownExtensions =
    /\.(md|json|txt|log|yaml|yml|toml|xml|csv|html|css|js|ts|mjs|cjs|tsx|jsx)$/i;
  return path.includes("/") && knownExtensions.test(path);
}

export function validateArtifactPaths(paths: string[]): string[] {
  const invalid: string[] = [];
  for (const p of paths) {
    if (!isValidRequiredArtifact(p)) {
      invalid.push(p);
    }
  }
  return invalid;
}

export type AiPlannerOutput = z.infer<typeof AiPlannerOutputSchema>;
export type AiPlannerTask = z.infer<typeof AiPlannerTaskSchema>;
export type PlannerConfig = z.infer<typeof PlannerConfigSchema>;
