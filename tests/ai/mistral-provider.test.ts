import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { MistralProvider } from "../../src/ai/providers/mistral-provider.js";

const originalFetch = global.fetch;
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("MistralProvider", () => {
  let provider: MistralProvider;

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MistralProvider({
      apiKey: "test-key",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-large-latest",
    });
  });

  it("maps request correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello from Mistral" } }],
        model: "mistral-large-latest",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const result = await provider.generate({
      systemPrompt: "You are Mistral",
      userPrompt: "Say hello",
    });

    expect(result.text).toBe("Hello from Mistral");
    expect(result.usage?.totalTokens).toBe(15);

    const callUrl = mockFetch.mock.calls[0]?.[0];
    expect(callUrl).toContain("/chat/completions");

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(callBody.model).toBe("mistral-large-latest");
    expect(callBody.messages[0].role).toBe("system");
  });

  it("parses response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Response text" } }],
        model: "mistral-large-latest",
      }),
    });

    const result = await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
    });

    expect(result.text).toBe("Response text");
  });

  it("handles JSON fallback", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "response_format not supported",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "fallback response" } }],
        }),
      });

    const result = await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
      responseFormat: "json_object",
    });

    expect(result.text).toBe("fallback response");
  });

  it("parses SSE stream with finish_reason and usage", async () => {
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
            'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n',
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
        systemPrompt: "",
        userPrompt: "test",
        stream: true,
      },
      (chunk) => {
        if (chunk.textDelta) chunks.push(chunk.textDelta);
      },
    );

    expect(chunks).toEqual(["Hello", " world"]);
    expect(result.text).toBe("Hello world");
    expect(result.usage?.totalTokens).toBe(7);
  });

  it("handles streaming via generate with stream flag", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"test"},"finish_reason":null}]}\n'),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n',
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

    const result = await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
      stream: true,
    });

    expect(result.text).toBe("test");
    expect(result.usage?.totalTokens).toBe(2);
  });
});
