import { describe, it, expect } from "vitest";
import {
  extractOpenAiDelta,
  extractOpenAiFinishReason,
  extractOpenAiUsage,
  extractAnthropicDelta,
  extractAnthropicDone,
  extractGeminiDelta,
  extractGeminiUsage,
  extractOllamaDelta,
  extractOllamaDone,
  extractModel,
} from "../../src/utils/provider-stream.js";

describe("extractOpenAiDelta", () => {
  it("extracts content delta from choice", () => {
    const result = extractOpenAiDelta({
      choices: [{ delta: { content: "Hello" }, finish_reason: null }],
    });
    expect(result).toBe("Hello");
  });

  it("returns null for missing choices", () => {
    expect(extractOpenAiDelta({})).toBeNull();
  });

  it("returns null for empty choices", () => {
    expect(extractOpenAiDelta({ choices: [] })).toBeNull();
  });

  it("returns null when no delta.content", () => {
    expect(extractOpenAiDelta({ choices: [{ delta: {} }] })).toBeNull();
  });

  it("returns null when delta is missing", () => {
    expect(extractOpenAiDelta({ choices: [{}] })).toBeNull();
  });
});

describe("extractOpenAiFinishReason", () => {
  it("extracts finish_reason from choice", () => {
    const result = extractOpenAiFinishReason({
      choices: [{ delta: { content: "a" }, finish_reason: "stop" }],
    });
    expect(result).toBe("stop");
  });

  it("returns null when no finish_reason", () => {
    expect(extractOpenAiFinishReason({ choices: [{ delta: { content: "a" } }] })).toBeNull();
  });

  it("returns null for empty choices", () => {
    expect(extractOpenAiFinishReason({ choices: [] })).toBeNull();
  });
});

describe("extractOpenAiUsage", () => {
  it("extracts usage tokens", () => {
    const result = extractOpenAiUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(result).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it("returns undefined when usage is absent", () => {
    expect(extractOpenAiUsage({})).toBeUndefined();
  });

  it("handles partial usage data", () => {
    const result = extractOpenAiUsage({ usage: { prompt_tokens: 10 } });
    expect(result).toEqual({ inputTokens: 10, outputTokens: undefined, totalTokens: undefined });
  });
});

describe("extractAnthropicDelta", () => {
  it("extracts text from content_block_delta", () => {
    const result = extractAnthropicDelta({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    });
    expect(result).toBe("Hello");
  });

  it("returns null for non-content_block_delta events", () => {
    expect(extractAnthropicDelta({ type: "message_start" })).toBeNull();
  });

  it("returns null for missing delta", () => {
    expect(extractAnthropicDelta({ type: "content_block_delta" })).toBeNull();
  });

  it("returns null for non-text_delta subtypes", () => {
    expect(
      extractAnthropicDelta({
        type: "content_block_delta",
        delta: { type: "input_json_delta" },
      }),
    ).toBeNull();
  });

  it("returns null for empty data", () => {
    expect(extractAnthropicDelta({})).toBeNull();
  });
});

describe("extractAnthropicDone", () => {
  it("returns true for message_stop", () => {
    expect(extractAnthropicDone({ type: "message_stop" })).toBe(true);
  });

  it("returns true for message_delta", () => {
    expect(extractAnthropicDone({ type: "message_delta" })).toBe(true);
  });

  it("returns false for content_block_delta", () => {
    expect(extractAnthropicDone({ type: "content_block_delta" })).toBe(false);
  });

  it("returns false for unknown types", () => {
    expect(extractAnthropicDone({ type: "ping" })).toBe(false);
  });

  it("returns false for empty data", () => {
    expect(extractAnthropicDone({})).toBe(false);
  });
});

describe("extractGeminiDelta", () => {
  it("extracts text from candidates parts", () => {
    const result = extractGeminiDelta({
      candidates: [{ content: { parts: [{ text: "Hello " }, { text: "World" }] } }],
    });
    expect(result).toBe("Hello World");
  });

  it("returns null when no candidates", () => {
    expect(extractGeminiDelta({})).toBeNull();
  });

  it("returns null when candidate has no content", () => {
    expect(extractGeminiDelta({ candidates: [{}] })).toBeNull();
  });

  it("returns null when parts array is empty", () => {
    expect(extractGeminiDelta({ candidates: [{ content: { parts: [] } }] })).toBeNull();
  });

  it("returns null when all parts have empty text", () => {
    expect(extractGeminiDelta({ candidates: [{ content: { parts: [{ text: "" }] } }] })).toBeNull();
  });
});

describe("extractGeminiUsage", () => {
  it("extracts usage from usageMetadata", () => {
    const result = extractGeminiUsage({
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    });
    expect(result).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it("returns undefined when usageMetadata absent", () => {
    expect(extractGeminiUsage({})).toBeUndefined();
  });

  it("handles partial usage data", () => {
    const result = extractGeminiUsage({ usageMetadata: { promptTokenCount: 10 } });
    expect(result).toEqual({ inputTokens: 10, outputTokens: undefined, totalTokens: undefined });
  });
});

describe("extractOllamaDelta", () => {
  it("extracts content from message", () => {
    const result = extractOllamaDelta({
      message: { role: "assistant", content: "Hello" },
    });
    expect(result).toBe("Hello");
  });

  it("returns null when no message", () => {
    expect(extractOllamaDelta({})).toBeNull();
  });

  it("returns null when message has no content", () => {
    expect(extractOllamaDelta({ message: { role: "assistant" } })).toBeNull();
  });

  it("returns empty string content", () => {
    const result = extractOllamaDelta({
      message: { role: "assistant", content: "" },
    });
    expect(result).toBe("");
  });
});

describe("extractOllamaDone", () => {
  it("returns true when done is true", () => {
    expect(extractOllamaDone({ done: true })).toBe(true);
  });

  it("returns false when done is false", () => {
    expect(extractOllamaDone({ done: false })).toBe(false);
  });

  it("returns false when no done field", () => {
    expect(extractOllamaDone({})).toBe(false);
  });
});

describe("extractModel", () => {
  it("extracts model from data", () => {
    expect(extractModel({ model: "llama3.1" })).toBe("llama3.1");
  });

  it("returns undefined when no model field", () => {
    expect(extractModel({})).toBeUndefined();
  });
});
