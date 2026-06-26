import { type AiProvider } from "./ai-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible-provider.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { GeminiProvider } from "./providers/gemini-provider.js";
import { MistralProvider } from "./providers/mistral-provider.js";
import { AzureOpenAiProvider } from "./providers/azure-openai-provider.js";
import { OllamaProvider } from "./providers/ollama-provider.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import type { AiProviderConfig } from "./ai.schema.js";
import { DEFAULT_PROVIDER_MODELS, mergeProviderConfigs } from "./provider-presets.js";
import { AiProviderError } from "./ai-provider-error.js";
import { resolveCredentialSync } from "../config/credential-resolver.js";

export type AiProviderFactory = (config: ResolvedAiProviderConfig) => AiProvider;

export interface ResolvedAiProviderConfig {
  name: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  endpointEnv?: string;
  apiVersion?: string;
  allowNoApiKey?: boolean;
  customHeaders?: Record<string, string>;
}

export interface ProviderSummary {
  name: string;
  type: string;
  configured: boolean;
  apiKeyAvailable: boolean;
  apiKeyEnv?: string;
  needsApiKey: boolean;
}

export class ProviderRegistry {
  private config: FlowTaskConfig;
  private mergedProviders: Record<string, AiProviderConfig>;
  private providerFactories: Map<string, AiProviderFactory>;
  private customProviders: Map<string, AiProvider>;

  constructor(config: FlowTaskConfig) {
    this.config = config;
    this.mergedProviders = mergeProviderConfigs(config.ai?.providers);
    this.providerFactories = new Map();
    this.customProviders = new Map();
    this.registerBuiltInFactories();
  }

  registerProviderType(type: string, factory: AiProviderFactory): void {
    this.providerFactories.set(type, factory);
  }

  registerProvider(name: string, config: AiProviderConfig): void {
    this.mergedProviders[name] = config;
  }

  getProvider(providerName?: string): AiProvider {
    const name = providerName ?? this.config.planner?.provider ?? "openai";
    const providerConfig = this.mergedProviders[name];

    if (!providerConfig) {
      throw new AiProviderError({
        provider: name,
        kind: "missing_api_key",
        message: `AI provider "${name}" is not configured.`,
        suggestion: `Add "${name}" to ai.providers in .flowtask/config.json.`,
      });
    }

    // Check for runtime-registered custom provider instance
    const customProvider = this.customProviders.get(name);
    if (customProvider) {
      return customProvider;
    }

    const model = this.config.planner?.model ?? DEFAULT_PROVIDER_MODELS[name] ?? "gpt-4.1-mini";

    const resolvedConfig = this.resolveProviderConfig(name, providerConfig, model);
    const factory = this.providerFactories.get(providerConfig.type);

    if (factory) {
      return factory(resolvedConfig);
    }

    // Fallback to OpenAI-compatible for unknown types
    return this.createOpenAiCompatibleFallback(resolvedConfig);
  }

  hasProvider(providerName?: string): boolean {
    const name = providerName ?? this.config.planner?.provider ?? "openai";
    return this.mergedProviders[name] !== undefined;
  }

  getApiKeyEnv(providerName?: string): string | undefined {
    const name = providerName ?? this.config.planner?.provider ?? "openai";
    const config = this.mergedProviders[name];
    return config?.apiKeyEnv;
  }

  isApiKeyAvailable(providerName?: string): boolean {
    const name = providerName ?? this.config.planner?.provider ?? "openai";
    const providerConfig = this.mergedProviders[name];
    if (!providerConfig) return false;
    const credential = resolveCredentialSync(name, providerConfig);
    return credential.apiKey !== undefined || providerConfig.allowNoApiKey === true;
  }

  listProviders(): ProviderSummary[] {
    return Object.entries(this.mergedProviders).map(([name, config]) => {
      const providerConfig = config;
      const credential = resolveCredentialSync(name, providerConfig);
      return {
        name,
        type: providerConfig.type ?? "unknown",
        configured: true,
        apiKeyAvailable: credential.apiKey !== undefined || providerConfig.allowNoApiKey === true,
        apiKeyEnv: providerConfig.apiKeyEnv,
        needsApiKey: !providerConfig.allowNoApiKey,
      };
    });
  }

  getProviderConfig(name: string): AiProviderConfig | undefined {
    return this.mergedProviders[name];
  }

  private registerBuiltInFactories(): void {
    this.registerProviderType("openai", (resolved) => {
      if (!resolved.apiKey) {
        const env = resolved.apiKey
          ? "OPENAI_API_KEY"
          : (this.getApiKeyEnv(resolved.name) ?? "OPENAI_API_KEY");
        throw new AiProviderError({
          provider: resolved.name,
          kind: "missing_api_key",
          message: `AI planner requires ${env} environment variable.`,
          suggestion: `Set ${env}=your-api-key, or run with --planner simple.`,
        });
      }
      return new OpenAiProvider({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
      });
    });

    this.registerProviderType("openai-compatible", (resolved) => {
      return new OpenAiCompatibleProvider({
        name: resolved.name,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
        customHeaders: resolved.customHeaders,
        allowNoApiKey: resolved.allowNoApiKey,
      });
    });

    this.registerProviderType("anthropic", (resolved) => {
      if (!resolved.apiKey) {
        const env = this.getApiKeyEnv(resolved.name) ?? "ANTHROPIC_API_KEY";
        throw new AiProviderError({
          provider: resolved.name,
          kind: "missing_api_key",
          message: `Anthropic requires ${env} environment variable.`,
          suggestion: `Set ${env}=your-api-key.`,
        });
      }
      return new AnthropicProvider({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
      });
    });

    this.registerProviderType("gemini", (resolved) => {
      if (!resolved.apiKey) {
        const env = this.getApiKeyEnv(resolved.name) ?? "GEMINI_API_KEY";
        throw new AiProviderError({
          provider: resolved.name,
          kind: "missing_api_key",
          message: `Gemini requires ${env} environment variable.`,
          suggestion: `Set ${env}=your-api-key.`,
        });
      }
      return new GeminiProvider({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
      });
    });

    this.registerProviderType("mistral", (resolved) => {
      if (!resolved.apiKey) {
        const env = this.getApiKeyEnv(resolved.name) ?? "MISTRAL_API_KEY";
        throw new AiProviderError({
          provider: resolved.name,
          kind: "missing_api_key",
          message: `Mistral requires ${env} environment variable.`,
          suggestion: `Set ${env}=your-api-key.`,
        });
      }
      return new MistralProvider({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
      });
    });

    this.registerProviderType("azure-openai", (resolved) => {
      if (!resolved.apiKey) {
        const env = this.getApiKeyEnv(resolved.name) ?? "AZURE_OPENAI_API_KEY";
        throw new AiProviderError({
          provider: resolved.name,
          kind: "missing_api_key",
          message: `Azure OpenAI requires ${env} environment variable.`,
          suggestion: `Set ${env}=your-api-key.`,
        });
      }
      const endpoint = resolved.baseUrl ?? process.env.AZURE_OPENAI_ENDPOINT;
      return new AzureOpenAiProvider({
        apiKey: resolved.apiKey,
        endpoint,
        apiVersion: resolved.apiVersion,
        deployment: resolved.model,
      });
    });

    this.registerProviderType("ollama", (resolved) => {
      return new OllamaProvider({
        baseUrl: resolved.baseUrl,
        model: resolved.model,
      });
    });
  }

  private resolveProviderConfig(
    name: string,
    providerConfig: AiProviderConfig,
    model: string,
  ): ResolvedAiProviderConfig {
    const credential = resolveCredentialSync(name, providerConfig);

    let baseUrl = providerConfig.baseUrl;
    if (providerConfig.endpointEnv && !baseUrl) {
      baseUrl = process.env[providerConfig.endpointEnv];
    }

    return {
      name,
      type: providerConfig.type ?? "openai-compatible",
      apiKey: credential.apiKey,
      baseUrl,
      model,
      endpointEnv: providerConfig.endpointEnv,
      apiVersion: providerConfig.apiVersion,
      allowNoApiKey: providerConfig.allowNoApiKey,
      customHeaders: providerConfig.headers,
    };
  }

  private createOpenAiCompatibleFallback(
    resolved: ResolvedAiProviderConfig,
  ): OpenAiCompatibleProvider {
    if (!resolved.apiKey) {
      const env = "OPENAI_API_KEY";
      throw new AiProviderError({
        provider: resolved.name,
        kind: "missing_api_key",
        message: `Provider "${resolved.name}" requires ${env} environment variable.`,
        suggestion: `Set ${env}=your-api-key.`,
      });
    }
    return new OpenAiCompatibleProvider({
      name: resolved.name,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
    });
  }
}
