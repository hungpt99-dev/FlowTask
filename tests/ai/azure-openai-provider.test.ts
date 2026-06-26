import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureOpenAiProvider } from "../../src/ai/providers/azure-openai-provider.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("AzureOpenAiProvider", () => {
  let provider: AzureOpenAiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AzureOpenAiProvider({
      apiKey: "azure-key",
      endpoint: "https://my-resource.openai.azure.com",
      apiVersion: "2024-02-15-preview",
      deployment: "gpt-4o-mini",
    });
  });

  it("builds deployment URL", async () => {
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

    const callUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain("my-resource.openai.azure.com");
    expect(callUrl).toContain("/openai/deployments/gpt-4o-mini/chat/completions");
    expect(callUrl).toContain("api-version=2024-02-15-preview");
    expect(result.text).toBe("Hello");
  });

  it("treats model as deployment", async () => {
    const p = new AzureOpenAiProvider({
      apiKey: "key",
      endpoint: "https://test.openai.azure.com",
      model: "gpt-35-turbo",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "OK" } }],
      }),
    });

    await p.generate({
      systemPrompt: "",
      userPrompt: "test",
    });

    const callUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain("deployments/gpt-35-turbo");
  });

  it("handles deployment not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Deployment not found",
    });

    try {
      await provider.generate({
        systemPrompt: "",
        userPrompt: "test",
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      if (err instanceof Error) {
        expect(err.message).toContain("404");
      }
    }
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
    expect(result.usage?.totalTokens).toBe(12);
  });

  it("handles streaming via generate with stream flag", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"azure"},"finish_reason":null}]}\n',
          ),
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

    expect(result.text).toBe("azure");
  });

  it("uses api-key header not Bearer", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "OK" } }],
      }),
    });

    await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
    });

    const headers = mockFetch.mock.calls[0]?.[1]?.headers;
    expect(headers["api-key"]).toBe("azure-key");
    expect(headers["Authorization"]).toBeUndefined();
  });
});
