import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAiProvider } from "../../src/ai/openai-provider.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OpenAiProvider", () => {
  let provider: OpenAiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAiProvider({
      apiKey: "sk-test-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
    });
  });

  it("maps request correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello" } }],
        model: "gpt-4.1-mini",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const result = await provider.generate({
      systemPrompt: "You are a helper",
      userPrompt: "Say hello",
    });

    expect(result.text).toBe("Hello");
    expect(result.model).toBe("gpt-4.1-mini");
    expect(result.usage?.totalTokens).toBe(15);

    const callUrl = mockFetch.mock.calls[0]?.[0];
    expect(callUrl).toContain("/chat/completions");

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(callBody.model).toBe("gpt-4.1-mini");
    expect(callBody.messages[0].role).toBe("system");
    expect(callBody.messages[1].role).toBe("user");
  });

  it("supports response_format json_object", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"key": "value"}' } }],
        model: "gpt-4.1-mini",
      }),
    });

    await provider.generate({
      systemPrompt: "test",
      userPrompt: "test",
      responseFormat: "json_object",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(callBody.response_format).toEqual({ type: "json_object" });
  });

  it("retries without response_format when unsupported", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "response_format not supported",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"title":"test","summary":"s","tasks":[]}' } }],
          model: "gpt-4.1-mini",
        }),
      });

    const result = await provider.generate({
      systemPrompt: "test",
      userPrompt: "test",
      responseFormat: "json_object",
    });

    expect(result.text).toContain("title");

    const secondBody = JSON.parse(mockFetch.mock.calls[1]?.[1]?.body ?? "{}");
    expect(secondBody.response_format).toBeUndefined();
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
            'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n',
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
      {
        systemPrompt: "test",
        userPrompt: "test",
        stream: true,
      },
      (chunk) => {
        if (chunk.textDelta) chunks.push(chunk.textDelta);
      },
    );

    expect(chunks).toEqual(["Hello", " world"]);
    expect(result.text).toBe("Hello world");
  });

  it("health check returns missing_api_key when no key", async () => {
    const p = new OpenAiProvider({});
    const result = await p.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("missing_api_key");
  });
});
