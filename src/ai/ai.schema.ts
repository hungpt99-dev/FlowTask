import { z } from "zod";

export const AiProviderConfigSchema = z.object({
  type: z.string().min(1),
  apiKeyEnv: z.string().min(1).default("OPENAI_API_KEY"),
  baseUrl: z.string().url().optional(),
});

export const AiConfigSchema = z.object({
  providers: z.record(AiProviderConfigSchema).optional().default({}),
});

export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;
export type AiConfig = z.infer<typeof AiConfigSchema>;
