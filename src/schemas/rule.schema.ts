import { z } from "zod";

export const RuleSourceSchema = z.object({
  id: z.string().optional(),
  path: z.string().min(1),
  type: z.enum(["markdown", "mdc", "text"]).default("markdown"),
  required: z.boolean().default(false),
});

export const LoadedRuleSchema = z.object({
  sourcePath: z.string().min(1),
  content: z.string(),
  sizeBytes: z.number().int().min(0),
});

export const RuleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  paths: z.array(z.string()).default([]),
  required: z.boolean().default(false),
  maxFileSizeKb: z.number().int().positive().default(256),
});

export type RuleSource = z.infer<typeof RuleSourceSchema>;
export type LoadedRule = z.infer<typeof LoadedRuleSchema>;
export type RuleConfig = z.infer<typeof RuleConfigSchema>;
