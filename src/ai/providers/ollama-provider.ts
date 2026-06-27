import {
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResponse,
  type AiProviderStreamChunk,
  type AiProviderHealthResult,
} from "../ai-provider.js";
import { AiProviderError, redactErrorMessage, checkResponseSize } from "../ai-provider-error.js";
import { generateWithResponseFormatFallback } from "../response-format-fallback.js";
import { parseNdjsonStream } from "../../utils/stream-parser.js";
import { extractOllamaDelta, extractOllamaDone } from "../../utils/provider-stream.js";

interface OllamaMessage {
  role: string;
  content: string;
}

interface OllamaResponse {
  model?: string;
  message?: OllamaMessage;
  created_at?: string;
  done?: boolean;
}

interface OllamaModel {
  name: string;
}

interface OllamaTagsResponse {
  models?: OllamaModel[];
}

export class OllamaProvider implements AiProvider {
  name = "ollama";
  type = "ollama";
  supportsJsonObject = true;
  supportsStreaming = true;
  private baseUrl: string;
  private model: string;

  constructor(config: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    this.model = config.model ?? "llama3.1";
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
    const start = Date.now();

    try {
      const tagsResponse = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(options?.timeoutMs ?? 5000),
      });

      const latencyMs = Date.now() - start;

      if (!tagsResponse.ok) {
        return {
          provider: this.name,
          ok: false,
          kind: "not_reachable",
          message: `Ollama returned HTTP ${tagsResponse.status}`,
          latencyMs,
          suggestion: "Ensure Ollama is running on the configured baseUrl",
        };
      }

      const model = options?.model ?? this.model;
      const tags = (await tagsResponse.json()) as OllamaTagsResponse;
      const availableModels = tags.models?.map((m) => m.name) ?? [];

      const modelFound = availableModels.some((m) => m === model || m.startsWith(`${model}:`));

      if (modelFound) {
        return {
          provider: this.name,
          ok: true,
          kind: "ok",
          message: `${this.baseUrl} reachable, model ${model} found`,
          latencyMs,
        };
      }

      const suggestion =
        availableModels.length > 0
          ? `Available models: ${availableModels.slice(0, 5).join(", ")}${availableModels.length > 5 ? "..." : ""}`
          : "Pull the model with: ollama pull " + model;
      return {
        provider: this.name,
        ok: true,
        kind: "model_not_found",
        message: `${this.baseUrl} reachable, model ${model} not found`,
        latencyMs,
        suggestion,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      if (err instanceof AiProviderError) throw err;
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
        suggestion: "Ensure Ollama is running (ollama serve) and the baseUrl is correct",
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
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
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

    return this.parseNdjsonStream(reader, onChunk);
  }

  private async generateOnce(request: AiProviderRequest): Promise<AiProviderResponse> {
    const body = this.buildRequestBody(request, false);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
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
    const messages: OllamaMessage[] = [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ];

    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages,
      stream,
      options: {
        temperature: request.temperature ?? 0.1,
      },
    };

    if (request.responseFormat === "json_object" && !stream) {
      body.format = "json";
    }

    return body;
  }

  private async parseResponse(response: Response): Promise<AiProviderResponse> {
    checkResponseSize(response, this.name);
    const data = (await response.json()) as OllamaResponse;
    const text = data.message?.content ?? "";

    if (!text) {
      throw new AiProviderError({
        provider: this.name,
        kind: "invalid_response",
        message: "Provider returned empty response",
      });
    }

    const result: AiProviderResponse = {
      text,
      raw: data,
      model: data.model ?? this.model,
      provider: this.name,
    };

    return result;
  }

  private async parseNdjsonStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onChunk: (chunk: AiProviderStreamChunk) => void | Promise<void>,
  ): Promise<AiProviderResponse> {
    const { text, model: resultModel } = await parseNdjsonStream(
      reader,
      async (data, emit) => {
        const delta = extractOllamaDelta(data);
        const chunkModel = (data.model as string) ?? undefined;
        if (delta) {
          await onChunk({
            provider: this.name,
            model: chunkModel ?? this.model,
            textDelta: delta,
            raw: data,
          });
          emit({ textDelta: delta });
        }
        if (extractOllamaDone(data)) {
          await onChunk({
            provider: this.name,
            model: chunkModel ?? this.model,
            textDelta: "",
            done: true,
          });
          return { done: true, model: chunkModel };
        }
      },
      this.name,
      this.model,
    );

    return { text, model: resultModel ?? this.model, provider: this.name };
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
    const redacted = redactErrorMessage(errorText, secrets);
    const message = `Ollama API error (${status}): ${redacted.slice(0, 500)}`;

    if (status === 400 && errorText.includes("format")) {
      return new AiProviderError({
        provider: this.name,
        kind: "unsupported_response_format",
        statusCode: status,
        message,
        retryable: true,
      });
    }

    if (status === 400) {
      return new AiProviderError({
        provider: this.name,
        kind: "invalid_request",
        statusCode: status,
        message,
        retryable: true,
      });
    }

    switch (status) {
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
