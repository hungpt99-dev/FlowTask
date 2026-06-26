export interface AiProviderRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
}

export interface AiProviderResponse {
  text: string;
  raw?: unknown;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface AiProvider {
  name: string;
  generate(request: AiProviderRequest): Promise<AiProviderResponse>;
}
