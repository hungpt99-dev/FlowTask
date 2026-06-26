import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicProvider } from "../../src/ai/providers/anthropic-provider.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("AnthropicProvider", () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com",
      model: "claude-3-5-sonnet-latest",
    });
  });

  it("maps request to /v1/messages", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello!" }],
        model: "claude-3-5-sonnet-latest",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const result = await provider.generate({
      systemPrompt: "You are Claude",
      userPrompt: "Say hello",
    });

    expect(result.text).toBe("Hello!");
    expect(result.usage?.inputTokens).toBe(10);
    expect(result.usage?.outputTokens).toBe(5);

    const callUrl = mockFetch.mock.calls[0]?.[0];
    expect(callUrl).toContain("/v1/messages");

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(callBody.system).toBe("You are Claude");
    expect(callBody.messages[0].role).toBe("user");
    expect(callBody.messages[0].content).toBe("Say hello");

    const headers = mockFetch.mock.calls[0]?.[1]?.headers;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("parses text content blocks", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "msg_123",
        content: [
          { type: "text", text: "Part 1 " },
          { type: "text", text: "Part 2" },
        ],
        model: "claude-3-5-sonnet-latest",
      }),
    });

    const result = await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
    });

    expect(result.text).toBe("Part 1 Part 2");
  });

  it("does not send OpenAI response_format", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "OK" }],
        model: "claude-3-5-sonnet-latest",
      }),
    });

    await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
      responseFormat: "json_object",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(callBody.response_format).toBeUndefined();
  });

  it("streams content_block_delta text", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n'));
        controller.close();
      },
    });

    const sseResponse = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });
    Object.defineProperty(sseResponse, "json", {
      value: async () => ({}),
    });
    mockFetch.mockResolvedValueOnce(sseResponse);

    const chunks: string[] = [];
    const result = await provider.stream(
      { systemPrompt: "", userPrompt: "test", stream: true },
      (chunk) => {
        if (chunk.textDelta) chunks.push(chunk.textDelta);
      },
    );

    expect(chunks).toEqual(["Hello", " world"]);
    expect(result.text).toBe("Hello world");
  });
});
