import { type AiProvider } from "./ai-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";

export class ProviderRegistry {
  private config: FlowTaskConfig;

  constructor(config: FlowTaskConfig) {
    this.config = config;
  }

  getProvider(providerName?: string): AiProvider {
    const name = providerName ?? this.config.planner?.provider ?? "openai";
    const providerConfig = this.config.ai?.providers?.[name];

    if (!providerConfig) {
      throw new Error(
        `AI provider "${name}" is not configured. Add it to ai.providers in .flowtask/config.json or set the FLOWTASK_AI_PROVIDER environment variable.`,
      );
    }

    const apiKeyEnv = providerConfig.apiKeyEnv ?? "OPENAI_API_KEY";
    const apiKey = process.env[apiKeyEnv];

    if (!apiKey) {
      throw new Error(
        `AI planner requires ${apiKeyEnv} environment variable. Set ${apiKeyEnv}=your-api-key, or run with --planner simple to skip AI planning.`,
      );
    }

    switch (providerConfig.type) {
      case "openai":
        return new OpenAiProvider({
          apiKey,
          baseUrl: providerConfig.baseUrl,
          model: this.config.planner?.model ?? "gpt-4.1-mini",
        });
      default:
        return new OpenAiProvider({
          apiKey,
          baseUrl: providerConfig.baseUrl,
          model: this.config.planner?.model ?? "gpt-4.1-mini",
        });
    }
  }

  hasProvider(providerName?: string): boolean {
    const name = providerName ?? this.config.planner?.provider ?? "openai";
    return this.config.ai?.providers?.[name] !== undefined;
  }

  getApiKeyEnv(providerName?: string): string | undefined {
    const name = providerName ?? this.config.planner?.provider ?? "openai";
    const config = this.config.ai?.providers?.[name];
    return config?.apiKeyEnv;
  }

  isApiKeyAvailable(providerName?: string): boolean {
    const envVar = this.getApiKeyEnv(providerName);
    if (!envVar) return false;
    return !!process.env[envVar];
  }
}
