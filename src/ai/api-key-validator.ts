import { ProviderRegistry, type ProviderSummary } from "./provider-registry.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";

export interface ApiKeyValidationResult {
  provider: string;
  type: string;
  needsApiKey: boolean;
  apiKeyAvailable: boolean;
  apiKeyEnv?: string;
  valid: boolean;
  message: string;
  suggestion?: string;
}

export interface ApiKeyValidationSummary {
  valid: boolean;
  results: ApiKeyValidationResult[];
  errors: ApiKeyValidationResult[];
}

export class ApiKeyValidator {
  private registry: ProviderRegistry;

  constructor(private config: FlowTaskConfig) {
    this.registry = new ProviderRegistry(config);
  }

  validateAll(): ApiKeyValidationResult[] {
    const summaries = this.registry.listProviders();
    return summaries.map((s) => this.validateSummary(s));
  }

  validateDefaultProvider(): ApiKeyValidationResult {
    const providerName = this.config.planner?.provider ?? "openai";
    return this.validateProvider(providerName);
  }

  validateProvider(providerName: string): ApiKeyValidationResult {
    const summaries = this.registry.listProviders();
    const summary = summaries.find((s) => s.name === providerName);
    if (!summary) {
      return {
        provider: providerName,
        type: "unknown",
        needsApiKey: true,
        apiKeyAvailable: false,
        valid: false,
        message: `Provider "${providerName}" is not configured.`,
        suggestion: `Add "${providerName}" to ai.providers in .flowtask/config.json.`,
      };
    }
    return this.validateSummary(summary);
  }

  private validateSummary(summary: ProviderSummary): ApiKeyValidationResult {
    if (!summary.needsApiKey) {
      return {
        provider: summary.name,
        type: summary.type,
        needsApiKey: false,
        apiKeyAvailable: true,
        valid: true,
        message: `Provider "${summary.name}" (${summary.type}) — no API key needed.`,
      };
    }

    if (!summary.apiKeyEnv) {
      return {
        provider: summary.name,
        type: summary.type,
        needsApiKey: true,
        apiKeyAvailable: true,
        valid: true,
        message: `Provider "${summary.name}" (${summary.type}) — API key configured.`,
      };
    }

    if (summary.apiKeyAvailable) {
      return {
        provider: summary.name,
        type: summary.type,
        needsApiKey: true,
        apiKeyAvailable: true,
        apiKeyEnv: summary.apiKeyEnv,
        valid: true,
        message: `Provider "${summary.name}" (${summary.type}) — ${summary.apiKeyEnv} is set.`,
      };
    }

    return {
      provider: summary.name,
      type: summary.type,
      needsApiKey: true,
      apiKeyAvailable: false,
      apiKeyEnv: summary.apiKeyEnv,
      valid: false,
      message: `Provider "${summary.name}" (${summary.type}) — ${summary.apiKeyEnv} is not set.`,
      suggestion: `Set ${summary.apiKeyEnv}=your-api-key in .env, or run: flowtask setup --provider ${summary.name}`,
    };
  }

  summarize(results: ApiKeyValidationResult[]): ApiKeyValidationSummary {
    const errors = results.filter((r) => !r.valid);
    return {
      valid: errors.length === 0,
      results,
      errors,
    };
  }
}

export async function validateApiKeysForRun(
  rootPath: string,
  config: FlowTaskConfig,
): Promise<ApiKeyValidationSummary> {
  const validator = new ApiKeyValidator(config);
  const results = validator.validateAll();
  return validator.summarize(results);
}
