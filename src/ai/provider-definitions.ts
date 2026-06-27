export interface ProviderDefinition {
  name: string;
  type: string;
  label: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  allowNoApiKey: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
  apiKeyEnv?: string;
}

export const SKIP_OPTION = { name: "__skip__", label: "Skip for now" };

export const SETUP_PROVIDERS: ProviderDefinition[] = [
  {
    name: "openai",
    type: "openai",
    label: "OpenAI",
    needsApiKey: true,
    needsBaseUrl: false,
    allowNoApiKey: false,
    defaultModel: "gpt-4.1-mini",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    name: "anthropic",
    type: "anthropic",
    label: "Anthropic",
    needsApiKey: true,
    needsBaseUrl: false,
    allowNoApiKey: false,
    defaultModel: "claude-3-5-sonnet-latest",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    name: "gemini",
    type: "gemini",
    label: "Gemini",
    needsApiKey: true,
    needsBaseUrl: false,
    allowNoApiKey: false,
    defaultModel: "gemini-1.5-pro",
    apiKeyEnv: "GEMINI_API_KEY",
  },
  {
    name: "openrouter",
    type: "openai-compatible",
    label: "OpenRouter",
    needsApiKey: true,
    needsBaseUrl: true,
    allowNoApiKey: false,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  {
    name: "deepseek",
    type: "openai-compatible",
    label: "DeepSeek",
    needsApiKey: true,
    needsBaseUrl: true,
    allowNoApiKey: false,
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  {
    name: "groq",
    type: "openai-compatible",
    label: "Groq",
    needsApiKey: true,
    needsBaseUrl: true,
    allowNoApiKey: false,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
  },
  {
    name: "ollama",
    type: "ollama",
    label: "Local Ollama",
    needsApiKey: false,
    needsBaseUrl: false,
    allowNoApiKey: true,
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
  },
  {
    name: "lmstudio",
    type: "openai-compatible",
    label: "LM Studio local",
    needsApiKey: false,
    needsBaseUrl: false,
    allowNoApiKey: true,
    defaultBaseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
  },
];
