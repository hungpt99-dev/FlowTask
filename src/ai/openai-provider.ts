import { type AiProvider, type AiProviderRequest, type AiProviderResponse } from "./ai-provider.js";
import { extractJsonObject } from "../utils/json-extractor.js";

export class OpenAiProvider implements AiProvider {
  name = "openai";
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: { apiKey: string; baseUrl?: string; model?: string }) {
    if (!config.apiKey) {
      throw new Error(
        "OpenAI API key is missing. Set the OPENAI_API_KEY environment variable or configure ai.providers.openai.apiKeyEnv in .flowtask/config.json.",
      );
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.model = config.model ?? "gpt-4.1-mini";
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ];

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 4096,
    };

    if (request.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      const redacted = errorText.replace(
        new RegExp(this.apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        "[REDACTED]",
      );
      throw new Error(`OpenAI API error (${response.status}): ${redacted.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";

    if (!text) {
      throw new Error("OpenAI returned empty response. Check your API key and model access.");
    }

    const result: AiProviderResponse = {
      text,
      raw: data,
      model: data.model ?? this.model,
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
}

export function parseJsonFromAi(text: string): unknown {
  const extraction = extractJsonObject(text);
  return JSON.parse(extraction.jsonText);
}
