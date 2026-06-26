import {
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResponse,
  type AiProviderStreamChunk,
  type AiProviderHealthResult,
} from "../ai-provider.js";
import { AiProviderError, redactErrorMessage } from "../ai-provider-error.js";

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  id?: string;
  type?: string;
  role?: string;
  content?: AnthropicContentBlock[];
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: {
    type?: string;
    text?: string;
  };
  content_block?: AnthropicContentBlock;
  message?: AnthropicResponse;
}

export class AnthropicProvider implements AiProvider {
  name = "anthropic";
  type = "anthropic";
  supportsJsonObject = false;
  supportsStreaming = true;
  private apiKey?: string;
  private baseUrl: string;
  private model: string;

  constructor(config: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
    this.model = config.model ?? "claude-3-5-sonnet-latest";
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    if (request.stream) {
      return this.streamInternal(request, async () => {});
    }
    return this.generateOnce(request);
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
    if (!this.apiKey) {
      return {
        provider: this.name,
        ok: false,
        kind: "missing_api_key",
        message: "ANTHROPIC_API_KEY environment variable not set",
        suggestion: "Set ANTHROPIC_API_KEY=your-api-key",
      };
    }

    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: options?.model ?? this.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
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

  private buildRequestBody(request: AiProviderRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 4096,
    };

    if (stream) {
      body.stream = true;
    }

    return body;
  }

  private async parseResponse(response: Response): Promise<AiProviderResponse> {
    const data = (await response.json()) as AnthropicResponse;

    const textBlocks =
      data.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("") ?? "";

    if (!textBlocks) {
      throw new AiProviderError({
        provider: this.name,
        kind: "invalid_response",
        message: "Provider returned empty response",
      });
    }

    const result: AiProviderResponse = {
      text: textBlocks,
      raw: data,
      model: data.model ?? this.model,
      provider: this.name,
    };

    if (data.usage) {
      result.usage = {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
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
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);

          try {
            const event = JSON.parse(data) as AnthropicStreamEvent;

            if (
              event.type === "content_block_delta" &&
              event.delta?.type === "text_delta" &&
              event.delta.text
            ) {
              fullTextParts.push(event.delta.text);
              await onChunk({
                provider: this.name,
                model: this.model,
                textDelta: event.delta.text,
                raw: event,
              });
            }

            if (event.type === "message_stop" || event.type === "message_delta") {
              const fullText = fullTextParts.join("");
              await onChunk({
                provider: this.name,
                model: this.model,
                textDelta: "",
                done: true,
              });
              return { text: fullText, model: this.model, provider: this.name };
            }
          } catch {
            // skip malformed SSE data
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
      });
    }
    return new AiProviderError({
      provider: this.name,
      kind: "network_error",
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
    });
  }

  private normalizeHttpError(status: number, errorText: string): AiProviderError {
    const secrets = new Set<string>();
    if (this.apiKey) secrets.add(this.apiKey);
    const redacted = redactErrorMessage(errorText, secrets);
    const message = `Anthropic API error (${status}): ${redacted.slice(0, 500)}`;

    switch (status) {
      case 401:
      case 403:
        return new AiProviderError({
          provider: this.name,
          kind: "unauthorized",
          statusCode: status,
          message,
        });
      case 429:
        return new AiProviderError({
          provider: this.name,
          kind: "rate_limited",
          statusCode: status,
          message,
          retryable: true,
        });
      case 400:
        return new AiProviderError({
          provider: this.name,
          kind: "invalid_request",
          statusCode: status,
          message,
        });
      case 404:
        return new AiProviderError({
          provider: this.name,
          kind: "model_not_found",
          statusCode: status,
          message,
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
