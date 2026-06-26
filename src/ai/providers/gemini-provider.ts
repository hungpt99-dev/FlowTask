import {
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResponse,
  type AiProviderStreamChunk,
  type AiProviderHealthResult,
} from "../ai-provider.js";
import { AiProviderError, redactErrorMessage } from "../ai-provider-error.js";
import { generateWithResponseFormatFallback } from "../response-format-fallback.js";
import { parseSseStream } from "../../utils/stream-parser.js";
import { extractGeminiDelta, extractGeminiUsage } from "../../utils/provider-stream.js";

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  role?: string;
  parts?: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class GeminiProvider implements AiProvider {
  name = "gemini";
  type = "gemini";
  supportsJsonObject = true;
  supportsStreaming = true;
  private apiKey?: string;
  private baseUrl: string;
  private model: string;

  constructor(config: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com").replace(
      /\/+$/,
      "",
    );
    this.model = config.model ?? "gemini-1.5-pro";
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
    if (!this.apiKey) {
      return {
        provider: this.name,
        ok: false,
        kind: "missing_api_key",
        message: "GEMINI_API_KEY environment variable not set",
        suggestion: "Set GEMINI_API_KEY=your-api-key",
      };
    }

    const start = Date.now();
    try {
      const model = options?.model ?? this.model;
      const url = `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "test" }] }],
          generationConfig: { maxOutputTokens: 1 },
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
          message: `Model ${model} not found`,
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
    const { url, body } = this.buildRequestBody(request, true);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let response: Response;
    try {
      response = await fetch(url, {
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
    const { url, body } = this.buildRequestBody(request, false);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let response: Response;
    try {
      response = await fetch(url, {
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

  private buildRequestBody(
    request: AiProviderRequest,
    stream: boolean,
  ): { url: string; body: Record<string, unknown> } {
    const model = request.model ?? this.model;
    const useStream = stream ? "streamGenerateContent" : "generateContent";
    const url = `${this.baseUrl}/v1beta/models/${model}:${useStream}?key=${this.apiKey}`;

    const contents: GeminiContent[] = [
      {
        role: "user",
        parts: [{ text: request.userPrompt }],
      },
    ];

    const generationConfig: Record<string, unknown> = {
      temperature: request.temperature ?? 0.1,
      maxOutputTokens: request.maxTokens ?? 4096,
    };

    if (request.responseFormat === "json_object" && !stream) {
      generationConfig.responseMimeType = "application/json";
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (request.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    return { url, body };
  }

  private async parseResponse(response: Response): Promise<AiProviderResponse> {
    const data = (await response.json()) as GeminiResponse;

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

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
      model: this.model,
      provider: this.name,
    };

    if (data.usageMetadata) {
      result.usage = {
        inputTokens: data.usageMetadata.promptTokenCount,
        outputTokens: data.usageMetadata.candidatesTokenCount,
        totalTokens: data.usageMetadata.totalTokenCount,
      };
    }

    return result;
  }

  private async parseSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onChunk: (chunk: AiProviderStreamChunk) => void | Promise<void>,
  ): Promise<AiProviderResponse> {
    const { text, usage } = await parseSseStream(
      reader,
      async (data, emit) => {
        const delta = extractGeminiDelta(data);
        if (delta) {
          await onChunk({
            provider: this.name,
            model: this.model,
            textDelta: delta,
            raw: data,
          });
          emit({ textDelta: delta });
        }
        const streamUsage = extractGeminiUsage(data);
        if (streamUsage) {
          return { done: true, usage: streamUsage };
        }
      },
      this.name,
      this.model,
    );

    return { text, model: this.model, provider: this.name, usage };
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
    const message = `Gemini API error (${status}): ${redacted.slice(0, 500)}`;

    if (
      status === 400 &&
      (errorText.includes("responseMimeType") ||
        errorText.includes("response_mime_type") ||
        errorText.includes("UNSUPPORTED"))
    ) {
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
