export type AiResponseFormat = "text" | "json_object";

export interface AiProviderRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: AiResponseFormat;
  timeoutMs?: number;
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AiProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiProviderResponse {
  text: string;
  model?: string;
  provider?: string;
  usage?: AiProviderUsage;
  raw?: unknown;
}

export interface AiProviderStreamChunk {
  provider: string;
  model: string;
  textDelta: string;
  done?: boolean;
  usage?: AiProviderUsage;
  raw?: unknown;
}

export interface AiProviderHealthResult {
  provider: string;
  ok: boolean;
  kind:
    | "ok"
    | "missing_api_key"
    | "unauthorized"
    | "not_reachable"
    | "model_not_found"
    | "invalid_config"
    | "timeout"
    | "unknown";
  message: string;
  latencyMs?: number;
  suggestion?: string;
}

export interface AiProvider {
  name: string;
  type?: string;
  supportsJsonObject?: boolean;
  supportsStreaming?: boolean;

  generate(request: AiProviderRequest): Promise<AiProviderResponse>;

  stream?(
    request: AiProviderRequest,
    onChunk: (chunk: AiProviderStreamChunk) => void | Promise<void>,
  ): Promise<AiProviderResponse>;

  healthCheck?(options?: { model?: string; timeoutMs?: number }): Promise<AiProviderHealthResult>;
}
