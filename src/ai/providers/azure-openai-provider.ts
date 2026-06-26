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
import {
  extractOpenAiDelta,
  extractOpenAiFinishReason,
  extractOpenAiUsage,
} from "../../utils/provider-stream.js";

export class AzureOpenAiProvider implements AiProvider {
  name = "azure-openai";
  type = "azure-openai";
  supportsJsonObject = true;
  supportsStreaming = true;
  private apiKey?: string;
  private endpoint: string;
  private apiVersion: string;
  private deployment: string;

  constructor(config: {
    apiKey?: string;
    endpoint?: string;
    apiVersion?: string;
    deployment?: string;
    model?: string;
  }) {
    this.apiKey = config.apiKey;
    this.endpoint = (config.endpoint ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.apiVersion = config.apiVersion ?? "2024-02-15-preview";
    this.deployment = config.deployment ?? config.model ?? "gpt-4o-mini";
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
        message: "AZURE_OPENAI_API_KEY environment variable not set",
        suggestion: "Set AZURE_OPENAI_API_KEY=your-api-key",
      };
    }

    if (this.endpoint === "https://api.openai.com/v1") {
      return {
        provider: this.name,
        ok: false,
        kind: "invalid_config",
        message: "AZURE_OPENAI_ENDPOINT not configured",
        suggestion: "Set AZURE_OPENAI_ENDPOINT to your Azure OpenAI endpoint",
      };
    }

    const start = Date.now();
    try {
      const deployment = options?.model ?? this.deployment;
      const url = `${this.endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${this.apiVersion}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify({
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
          message: "endpoint reachable, deployment ok",
          latencyMs,
        };
      }

      if (response.status === 404) {
        return {
          provider: this.name,
          ok: false,
          kind: "model_not_found",
          message: `Deployment ${deployment} not found`,
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
        message: `Cannot reach ${this.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
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
      "api-key": this.apiKey ?? "",
    };

    let response: Response;
    try {
      response = await fetch(this.buildUrl(), {
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
      "api-key": this.apiKey ?? "",
    };

    let response: Response;
    try {
      response = await fetch(this.buildUrl(), {
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

  private buildUrl(): string {
    return `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;
  }

  private buildRequestBody(request: AiProviderRequest, stream: boolean): Record<string, unknown> {
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ];

    const body: Record<string, unknown> = {
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
        message: "Provider returned empty response",
      });
    }

    const result: AiProviderResponse = {
      text,
      raw: data,
      model: this.deployment,
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
    const { text, usage } = await parseSseStream(
      reader,
      async (data, emit) => {
        const delta = extractOpenAiDelta(data);
        if (delta) {
          await onChunk({
            provider: this.name,
            model: this.deployment,
            textDelta: delta,
            raw: data,
          });
          emit({ textDelta: delta });
        }
        const finishReason = extractOpenAiFinishReason(data);
        if (finishReason) {
          const streamUsage = extractOpenAiUsage(data);
          await onChunk({
            provider: this.name,
            model: this.deployment,
            textDelta: "",
            done: true,
            usage: streamUsage,
          });
          return { done: true, usage: streamUsage };
        }
      },
      this.name,
      this.deployment,
    );

    return { text, model: this.deployment, provider: this.name, usage };
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
    const message = `Azure OpenAI API error (${status}): ${redacted.slice(0, 500)}`;

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
