import { type AiProviderUsage } from "../ai/ai-provider.js";

export function extractOpenAiDelta(data: Record<string, unknown>): string | null {
  const choices = data.choices as
    | Array<{ delta?: { content?: string }; finish_reason?: string | null }>
    | undefined;
  return choices?.[0]?.delta?.content ?? null;
}

export function extractOpenAiFinishReason(data: Record<string, unknown>): string | null {
  const choices = data.choices as Array<{ finish_reason?: string | null }> | undefined;
  return choices?.[0]?.finish_reason ?? null;
}

export function extractOpenAiUsage(data: Record<string, unknown>): AiProviderUsage | undefined {
  const usage = data.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export function extractAnthropicDelta(data: Record<string, unknown>): string | null {
  const eventType = data.type as string | undefined;
  if (eventType !== "content_block_delta") return null;
  const delta = data.delta as { type?: string; text?: string } | undefined;
  if (delta?.type !== "text_delta") return null;
  return delta.text ?? null;
}

export function extractAnthropicDone(data: Record<string, unknown>): boolean {
  const eventType = data.type as string | undefined;
  return eventType === "message_stop" || eventType === "message_delta";
}

export function extractGeminiDelta(data: Record<string, unknown>): string | null {
  const candidates = data.candidates as
    | Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
    | undefined;
  if (!candidates?.[0]?.content?.parts) return null;
  const texts = candidates[0].content.parts
    .map((p) => p.text ?? "")
    .filter(Boolean)
    .join("");
  return texts || null;
}

export function extractGeminiUsage(data: Record<string, unknown>): AiProviderUsage | undefined {
  const meta = data.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined;
  if (!meta) return undefined;
  return {
    inputTokens: meta.promptTokenCount,
    outputTokens: meta.candidatesTokenCount,
    totalTokens: meta.totalTokenCount,
  };
}

export function extractOllamaDelta(data: Record<string, unknown>): string | null {
  const message = data.message as { role?: string; content?: string } | undefined;
  return message?.content ?? null;
}

export function extractOllamaDone(data: Record<string, unknown>): boolean {
  return data.done === true;
}

export function extractModel(data: Record<string, unknown>): string | undefined {
  return data.model as string | undefined;
}
