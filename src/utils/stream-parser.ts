import { type AiProviderStreamChunk } from "../ai/ai-provider.js";

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[\d;]*[a-zA-Z]/g, "");
}

export interface StreamParseResult {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export async function parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onData: (
    data: Record<string, unknown>,
    emit: (chunk: Omit<AiProviderStreamChunk, "provider" | "model">) => void | Promise<void>,
  ) =>
    | {
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
        done?: boolean;
      }
    | undefined
    | void
    | Promise<
        | {
            usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
            done?: boolean;
          }
        | undefined
        | void
      >,
  _provider: string,
  _model: string,
): Promise<StreamParseResult> {
  const decoder = new TextDecoder();
  let buffer = "";
  const fullTextParts: string[] = [];
  let finalUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

  const emit = (chunk: Omit<AiProviderStreamChunk, "provider" | "model">): void => {
    if (chunk.textDelta) {
      fullTextParts.push(chunk.textDelta);
    }
    if (chunk.usage) {
      finalUsage = chunk.usage;
    }
  };

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

        const rawData = trimmed.slice(6);
        if (rawData === "[DONE]") continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(rawData) as Record<string, unknown>;
        } catch {
          continue;
        }

        const result = await onData(parsed, emit);
        if (result?.done) {
          return {
            text: fullTextParts.join(""),
            usage: result.usage ?? finalUsage,
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text: fullTextParts.join(""), usage: finalUsage };
}

export async function parseNdjsonStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onData: (
    data: Record<string, unknown>,
    emit: (chunk: Omit<AiProviderStreamChunk, "provider" | "model">) => void | Promise<void>,
  ) =>
    | {
        model?: string;
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
        done?: boolean;
      }
    | undefined
    | void
    | Promise<
        | {
            model?: string;
            usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
            done?: boolean;
          }
        | undefined
        | void
      >,
  _provider: string,
  model: string,
): Promise<StreamParseResult & { model?: string }> {
  const decoder = new TextDecoder();
  let buffer = "";
  const fullTextParts: string[] = [];
  let finalModel = model;
  let finalUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

  const emit = (chunk: Omit<AiProviderStreamChunk, "provider" | "model">): void => {
    if (chunk.textDelta) {
      fullTextParts.push(chunk.textDelta);
    }
    if (chunk.usage) {
      finalUsage = chunk.usage;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        const result = await onData(parsed, emit);
        if (result?.model) {
          finalModel = result.model;
        }
        if (result?.done) {
          return {
            text: fullTextParts.join(""),
            model: finalModel,
            usage: result.usage ?? finalUsage,
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text: fullTextParts.join(""), model: finalModel, usage: finalUsage };
}
