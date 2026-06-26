import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAiCompatibleProvider } from "../../src/ai/providers/openai-compatible-provider.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OpenAiCompatibleProvider", () => {
  let provider: OpenAiCompatibleProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAiCompatibleProvider({
      name: "deepseek",
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    });
  });

  it("maps request correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello" } }],
        model: "deepseek-chat",
      }),
    });

    const result = await provider.generate({
      systemPrompt: "test",
      userPrompt: "test",
    });

    expect(result.text).toBe("Hello");
    const callUrl = mockFetch.mock.calls[0]?.[0];
    expect(callUrl).toContain("/chat/completions");
  });

  it("supports custom headers", async () => {
    provider = new OpenAiCompatibleProvider({
      name: "openrouter",
      apiKey: "sk-test",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      customHeaders: {
        "HTTP-Referer": "https://example.com",
        "X-Title": "FlowTask",
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello" } }],
      }),
    });

    await provider.generate({
      systemPrompt: "test",
      userPrompt: "test",
    });

    const headers = mockFetch.mock.calls[0]?.[1]?.headers;
    expect(headers["HTTP-Referer"]).toBe("https://example.com");
    expect(headers["X-Title"]).toBe("FlowTask");
  });

  it("supports local no-api-key provider", async () => {
    provider = new OpenAiCompatibleProvider({
      name: "lmstudio",
      baseUrl: "http://localhost:1234/v1",
      model: "local-model",
      allowNoApiKey: true,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello" } }],
      }),
    });

    const result = await provider.generate({
      systemPrompt: "test",
      userPrompt: "test",
    });

    expect(result.text).toBe("Hello");
    const headers = mockFetch.mock.calls[0]?.[1]?.headers;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("parses SSE stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n"));
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
      { systemPrompt: "test", userPrompt: "test", stream: true },
      (chunk) => {
        if (chunk.textDelta) chunks.push(chunk.textDelta);
      },
    );

    expect(chunks).toEqual(["Hello", " world"]);
    expect(result.text).toBe("Hello world");
  });
});
