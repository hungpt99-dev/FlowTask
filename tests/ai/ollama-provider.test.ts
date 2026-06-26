import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaProvider } from "../../src/ai/providers/ollama-provider.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OllamaProvider", () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
    });
  });

  it("maps request to /api/chat", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: "llama3.1",
        message: { role: "assistant", content: "Hello from Ollama" },
      }),
    });

    const result = await provider.generate({
      systemPrompt: "You are a helpful assistant",
      userPrompt: "Say hello",
    });

    expect(result.text).toBe("Hello from Ollama");
    expect(result.model).toBe("llama3.1");

    const callUrl = mockFetch.mock.calls[0]?.[0];
    expect(callUrl).toContain("/api/chat");

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(callBody.model).toBe("llama3.1");
    expect(callBody.messages[0].role).toBe("system");
    expect(callBody.messages[1].role).toBe("user");
    expect(callBody.stream).toBe(false);
  });

  it("uses format json when JSON requested", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: "llama3.1",
        message: { role: "assistant", content: '{"key": "value"}' },
      }),
    });

    await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
      responseFormat: "json_object",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(callBody.format).toBe("json");
  });

  it("retries without format when unsupported", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "format not supported",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "llama3.1",
          message: { role: "assistant", content: "plain text" },
        }),
      });

    const result = await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
      responseFormat: "json_object",
    });

    expect(result.text).toBe("plain text");
  });

  it("parses NDJSON streaming", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              model: "llama3.1",
              message: { role: "assistant", content: "Hello" },
              done: false,
            }) + "\n",
          ),
        );
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              model: "llama3.1",
              message: { role: "assistant", content: " World" },
              done: false,
            }) + "\n",
          ),
        );
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              model: "llama3.1",
              message: { role: "assistant", content: "" },
              done: true,
            }) + "\n",
          ),
        );
        controller.close();
      },
    });

    const response = new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson" },
    });
    // Override to prevent json parsing issues
    Object.defineProperty(response, "json", {
      value: async () => ({}),
    });
    mockFetch.mockResolvedValueOnce(response);

    const chunks: string[] = [];
    const result = await provider.stream(
      { systemPrompt: "", userPrompt: "test", stream: true },
      (chunk) => {
        if (chunk.textDelta) chunks.push(chunk.textDelta);
      },
    );

    expect(chunks).toEqual(["Hello", " World"]);
    expect(result.text).toBe("Hello World");
  });

  it("health checks /api/tags", async () => {
    const response = new Response(
      JSON.stringify({ models: [{ name: "llama3.1" }, { name: "mistral:latest" }] }),
      { status: 200 },
    );
    mockFetch.mockResolvedValueOnce(response);

    const result = await provider.healthCheck({ model: "llama3.1" });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("ok");

    const callUrl = mockFetch.mock.calls[0]?.[0];
    expect(callUrl).toContain("/api/tags");
  });

  it("health check reports model_not_found", async () => {
    const response = new Response(JSON.stringify({ models: [{ name: "llama3.1" }] }), {
      status: 200,
    });
    mockFetch.mockResolvedValueOnce(response);

    const result = await provider.healthCheck({ model: "nonexistent-model" });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("model_not_found");
  });
});
