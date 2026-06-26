import type { AiProviderConfig } from "./ai.schema.js";

export const DEFAULT_AI_PROVIDERS: Record<string, AiProviderConfig> = {
  openai: {
    type: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
  },
  openrouter: {
    type: "openai-compatible",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  deepseek: {
    type: "openai-compatible",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/v1",
  },
  groq: {
    type: "openai-compatible",
    apiKeyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  anthropic: {
    type: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com",
  },
  gemini: {
    type: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com",
  },
  mistral: {
    type: "mistral",
    apiKeyEnv: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
  },
  "azure-openai": {
    type: "azure-openai",
    apiKeyEnv: "AZURE_OPENAI_API_KEY",
    endpointEnv: "AZURE_OPENAI_ENDPOINT",
  },
  ollama: {
    type: "ollama",
    baseUrl: "http://localhost:11434",
    allowNoApiKey: true,
  },
  lmstudio: {
    type: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    allowNoApiKey: true,
  },
  "byteplus-modelark": {
    type: "openai-compatible",
    apiKeyEnv: "ARK_API_KEY",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
  },
  together: {
    type: "openai-compatible",
    apiKeyEnv: "TOGETHER_API_KEY",
    baseUrl: "https://api.together.xyz/v1",
  },
  fireworks: {
    type: "openai-compatible",
    apiKeyEnv: "FIREWORKS_API_KEY",
    baseUrl: "https://api.fireworks.ai/inference/v1",
  },
};

export const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
  gemini: "gemini-1.5-pro",
  openrouter: "openai/gpt-4o-mini",
  deepseek: "deepseek-chat",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
  "azure-openai": "gpt-4o-mini",
  ollama: "llama3.1",
  lmstudio: "local-model",
  "byteplus-modelark": "deepseek-v3",
  together: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  fireworks: "accounts/fireworks/models/llama-v3p1-70b-instruct",
};

export function mergeProviderConfigs(
  userConfig: Record<string, AiProviderConfig> | undefined,
): Record<string, AiProviderConfig> {
  const merged: Record<string, AiProviderConfig> = { ...DEFAULT_AI_PROVIDERS };
  if (userConfig) {
    for (const [key, val] of Object.entries(userConfig)) {
      merged[key] = { ...merged[key], ...val };
    }
  }
  return merged;
}
