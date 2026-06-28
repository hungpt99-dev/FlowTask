import { describe, it, expect } from "vitest";
import {
  LineBuffer,
  stripAnsi,
  parseSseStream,
  parseNdjsonStream,
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
} from "../src/stream.js";

describe("stream barrel module", () => {
  it("extracts OpenAI delta from choices", () => {
    expect(extractOpenAiDelta({ choices: [{ delta: { content: "hello" } }] })).toBe("hello");
    expect(extractOpenAiDelta({})).toBeNull();
    expect(extractOpenAiDelta({ choices: [{ delta: {} }] })).toBeNull();
  });

  it("extracts OpenAI finish reason", () => {
    expect(extractOpenAiFinishReason({ choices: [{ finish_reason: "stop" }] })).toBe("stop");
    expect(extractOpenAiFinishReason({})).toBeNull();
  });

  it("extracts OpenAI usage", () => {
    const result = extractOpenAiUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(result).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(extractOpenAiUsage({})).toBeUndefined();
  });

  it("extracts Anthropic delta from content_block_delta", () => {
    expect(
      extractAnthropicDelta({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hi" },
      }),
    ).toBe("hi");
    expect(extractAnthropicDelta({ type: "ping" })).toBeNull();
    expect(
      extractAnthropicDelta({ type: "content_block_delta", delta: { type: "other" } }),
    ).toBeNull();
  });

  it("detects Anthropic done from message_stop or message_delta", () => {
    expect(extractAnthropicDone({ type: "message_stop" })).toBe(true);
    expect(extractAnthropicDone({ type: "message_delta" })).toBe(true);
    expect(extractAnthropicDone({ type: "content_block_delta" })).toBe(false);
  });

  it("extracts Gemini delta from candidates parts", () => {
    expect(
      extractGeminiDelta({
        candidates: [{ content: { parts: [{ text: "Hello " }, { text: "World" }] } }],
      }),
    ).toBe("Hello World");
    expect(extractGeminiDelta({})).toBeNull();
  });

  it("extracts Gemini usage from usageMetadata", () => {
    const result = extractGeminiUsage({
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
    });
    expect(result).toEqual({ inputTokens: 5, outputTokens: 10, totalTokens: 15 });
    expect(extractGeminiUsage({})).toBeUndefined();
  });

  it("extracts Ollama delta from message content", () => {
    expect(extractOllamaDelta({ message: { content: "hello" } })).toBe("hello");
    expect(extractOllamaDelta({})).toBeNull();
  });

  it("detects Ollama done from done flag", () => {
    expect(extractOllamaDone({ done: true })).toBe(true);
    expect(extractOllamaDone({ done: false })).toBe(false);
    expect(extractOllamaDone({})).toBe(false);
  });

  it("extracts model from data", () => {
    expect(extractModel({ model: "gpt-4" })).toBe("gpt-4");
    expect(extractModel({})).toBeUndefined();
  });

  it("parses SSE stream with parseSseStream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"A"}}]}\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"B"}}]}\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n"));
        controller.close();
      },
    });
    const reader = stream.getReader();
    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const delta = extractOpenAiDelta(data);
        if (delta) emit({ textDelta: delta });
        const reason = extractOpenAiFinishReason(data);
        if (reason) emit({ textDelta: "" });
        return {};
      },
      "openai",
      "gpt-4",
    );
    expect(result.text).toBe("AB");
  });

  it("parses NDJSON stream with parseNdjsonStream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(JSON.stringify({ message: { content: "X" }, done: false }) + "\n"),
        );
        controller.enqueue(
          encoder.encode(JSON.stringify({ message: { content: "Y" }, done: true }) + "\n"),
        );
        controller.close();
      },
    });
    const reader = stream.getReader();
    const result = await parseNdjsonStream(
      reader,
      (data, emit) => {
        const content = extractOllamaDelta(data);
        if (content) emit({ textDelta: content });
        return { done: extractOllamaDone(data) };
      },
      "ollama",
      "llama3.1",
    );
    expect(result.text).toBe("XY");
    expect(result.model).toBe("llama3.1");
  });

  it("delegates stripAnsi correctly", () => {
    const input = "\u001b[32mhello\u001b[0m";
    expect(stripAnsi(input)).toBe("hello");
  });

  it("delegates LineBuffer correctly", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((line) => lines.push(line));
    buf.push(Buffer.from("foo\nbar\n"));
    expect(lines).toEqual(["foo", "bar"]);
  });
});
