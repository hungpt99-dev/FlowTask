import {
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResponse,
  type AiProviderStreamChunk,
  type AiProviderHealthResult,
} from "../ai-provider.js";
import { AiProviderError, redactErrorMessage } from "../ai-provider-error.js";
import { generateWithResponseFormatFallback } from "../response-format-fallback.js";

export class OpenAiCompatibleProvider implements AiProvider {
  name: string;
  type = "openai-compatible";
  supportsJsonObject = true;
  supportsStreaming = true;
  private apiKey?: string;
  private baseUrl: string;
  private model: string;
  private customHeaders?: Record<string, string>;
  private allowNoApiKey: boolean;

  constructor(config: {
    name: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    customHeaders?: Record<string, string>;
    allowNoApiKey?: boolean;
  }) {
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.model = config.model ?? "gpt-4.1-mini";
    this.customHeaders = config.customHeaders;
    this.allowNoApiKey = config.allowNoApiKey ?? false;
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    if (request.stream) {
      return this.streamInternal(request, async () => {});
    }
    const { response } = await generateWithResponseFormatFallback(this.name, request, (req) =>
      this.generateOnce(req),
    );
    return response;
  }

  async stream(
    request: AiProviderRequest,
    onChunk: (chunk: AiProviderStreamChunk) => void | Promise<void>,
  ): Promise<AiProviderResponse> {
    return this.streamInternal(request, onChunk);
  }

  async healthCheck(options?: {
    model?: string;
    timeoutMs?: number;
  }): Promise<AiProviderHealthResult> {
    if (!this.apiKey && !this.allowNoApiKey) {
      return {
        provider: this.name,
        ok: false,
        kind: "missing_api_key",
        message: `${this.name.toUpperCase()}_API_KEY environment variable not set`,
        suggestion: `Set ${this.name.toUpperCase()}_API_KEY=your-api-key`,
      };
    }

    const start = Date.now();
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: options?.model ?? this.model,
          messages: [{ role: "user", content: "test" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(options?.timeoutMs ?? 5000),
      });

      const latencyMs = Date.now() - start;

      if (response.ok) {
        return {
          provider: this.name,
          ok: true,
          kind: "ok",
          message: "endpoint reachable, model ok",
          latencyMs,
        };
      }

      if (response.status === 404) {
        return {
          provider: this.name,
          ok: false,
          kind: "model_not_found",
          message: `Model ${options?.model ?? this.model} not found`,
          latencyMs,
        };
      }

      return {
        provider: this.name,
        ok: false,
        kind: "unauthorized",
        message: `HTTP ${response.status}`,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      if (err instanceof Error && err.name === "TimeoutError") {
        return {
          provider: this.name,
          ok: false,
          kind: "timeout",
          message: "Health check timed out",
          latencyMs,
        };
      }
      return {
        provider: this.name,
        ok: false,
        kind: "not_reachable",
        message: `Cannot reach ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs,
      };
    }
  }

  private async streamInternal(
    request: AiProviderRequest,
    onChunk: (chunk: AiProviderStreamChunk) => void | Promise<void>,
  ): Promise<AiProviderResponse> {
    const body = this.buildRequestBody(request, true);
    const headers = this.buildHeaders();

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: request.timeoutMs ? AbortSignal.timeout(request.timeoutMs) : undefined,
      });
    } catch (err) {
      throw this.normalizeFetchError(err, request.timeoutMs);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw this.normalizeHttpError(response.status, errorText);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new AiProviderError({
        provider: this.name,
        kind: "invalid_response",
        message: "Response body is not readable",
      });
    }

    return this.parseSseStream(reader, onChunk);
  }

  private async generateOnce(request: AiProviderRequest): Promise<AiProviderResponse> {
    const body = this.buildRequestBody(request, false);
    const headers = this.buildHeaders();

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: request.timeoutMs ? AbortSignal.timeout(request.timeoutMs) : undefined,
      });
    } catch (err) {
      throw this.normalizeFetchError(err, request.timeoutMs);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw this.normalizeHttpError(response.status, errorText);
    }

    return this.parseResponse(response);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (this.customHeaders) {
      for (const [key, value] of Object.entries(this.customHeaders)) {
        const lower = key.toLowerCase();
        if (lower !== "authorization" && lower !== "content-type") {
          headers[key] = value;
        }
      }
    }
    return headers;
  }

  private buildRequestBody(request: AiProviderRequest, stream: boolean): Record<string, unknown> {
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ];

    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 4096,
    };

    if (request.responseFormat === "json_object" && !stream) {
      body.response_format = { type: "json_object" };
    }

    if (stream) {
      body.stream = true;
    }

    return body;
  }

  private async parseResponse(response: Response): Promise<AiProviderResponse> {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";

    if (!text) {
      throw new AiProviderError({
        provider: this.name,
        kind: "invalid_response",
        message: `Provider "${this.name}" returned empty response. Check your model and API key.`,
        suggestion: `Verify the model "${this.model}" is accessible with your API key.`,
      });
    }

    const result: AiProviderResponse = {
      text,
      raw: { model: data.model, usage: data.usage },
      model: data.model ?? this.model,
      provider: this.name,
    };

    if (data.usage) {
      result.usage = {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      };
    }

    return result;
  }

  private async parseSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onChunk: (chunk: AiProviderStreamChunk) => void | Promise<void>,
  ): Promise<AiProviderResponse> {
    const decoder = new TextDecoder();
    const fullTextParts: string[] = [];
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (!trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
            };

            const delta = parsed.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              fullTextParts.push(delta);
              await onChunk({
                provider: this.name,
                model: this.model,
                textDelta: delta,
                raw: parsed,
              });
            }

            const finishReason = parsed.choices?.[0]?.finish_reason;
            if (finishReason) {
              const fullText = fullTextParts.join("");
              const result: AiProviderResponse = {
                text: fullText,
                model: this.model,
                provider: this.name,
              };
              if (parsed.usage) {
                result.usage = {
                  inputTokens: parsed.usage.prompt_tokens,
                  outputTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens,
                };
              }
              await onChunk({
                provider: this.name,
                model: this.model,
                textDelta: "",
                done: true,
                usage: result.usage,
              });
              return result;
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const fullText = fullTextParts.join("");
    await onChunk({
      provider: this.name,
      model: this.model,
      textDelta: "",
      done: true,
    });
    return { text: fullText, model: this.model, provider: this.name };
  }

  private normalizeFetchError(err: unknown, timeoutMs?: number): AiProviderError {
    if (err instanceof AiProviderError) return err;
    if (err instanceof Error && err.name === "TimeoutError") {
      return new AiProviderError({
        provider: this.name,
        kind: "timeout",
        message: `Provider "${this.name}" timed out after ${timeoutMs}ms`,
        retryable: true,
        suggestion: "Increase planner.timeoutMs in .flowtask/config.json or retry.",
      });
    }
    return new AiProviderError({
      provider: this.name,
      kind: "network_error",
      message: `Network error connecting to ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
      suggestion: "Check your network connection and provider endpoint.",
    });
  }

  private normalizeHttpError(status: number, errorText: string): AiProviderError {
    const secrets = new Set<string>();
    if (this.apiKey) secrets.add(this.apiKey);
    const redacted = redactErrorMessage(errorText, secrets);
    const message = `${this.name} API error (${status}): ${redacted.slice(0, 500)}`;

    if (status === 400 && errorText.includes("response_format")) {
      return new AiProviderError({
        provider: this.name,
        kind: "unsupported_response_format",
        statusCode: status,
        message,
        retryable: true,
      });
    }

    switch (status) {
      case 401:
        return new AiProviderError({
          provider: this.name,
          kind: "unauthorized",
          statusCode: status,
          message,
          suggestion: `Check that your API key is valid and has access to the selected model.`,
        });
      case 429:
        return new AiProviderError({
          provider: this.name,
          kind: "rate_limited",
          statusCode: status,
          message,
          retryable: true,
          suggestion: "Reduce request frequency or upgrade your API tier.",
        });
      case 402:
        return new AiProviderError({
          provider: this.name,
          kind: "quota_exceeded",
          statusCode: status,
          message,
          suggestion: "Your API quota has been exceeded. Check your billing.",
        });
      case 404:
        return new AiProviderError({
          provider: this.name,
          kind: "model_not_found",
          statusCode: status,
          message,
          suggestion: `Check planner.model in config. Model may not exist or may not be accessible.`,
        });
      case 500:
      case 502:
      case 503:
        return new AiProviderError({
          provider: this.name,
          kind: "server_error",
          statusCode: status,
          message,
          retryable: true,
          suggestion: "The provider returned a server error. Retry later.",
        });
      default:
        return new AiProviderError({
          provider: this.name,
          kind: "unknown",
          statusCode: status,
          message,
        });
    }
  }
}
