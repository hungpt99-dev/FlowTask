import { z } from "zod";

export const AiProviderConfigSchema = z.object({
  type: z.string().min(1),
  apiKeyEnv: z.string().optional(),
  baseUrl: z.string().optional(),
  endpointEnv: z.string().optional(),
  apiVersion: z.string().optional(),
  supportsJsonObject: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  allowNoApiKey: z.boolean().optional(),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  healthCheck: z
    .object({
      enabled: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export const AiConfigSchema = z.object({
  providers: z.record(AiProviderConfigSchema).optional().default({}),
});

export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;
export type AiConfig = z.infer<typeof AiConfigSchema>;
