import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiProvider } from "../../src/ai/providers/gemini-provider.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GeminiProvider", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GeminiProvider({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com",
      model: "gemini-1.5-pro",
    });
  });

  it("maps request to generateContent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Hello from Gemini" }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }),
    });

    const result = await provider.generate({
      systemPrompt: "You are Gemini",
      userPrompt: "Say hello",
    });

    expect(result.text).toBe("Hello from Gemini");
    expect(result.usage?.inputTokens).toBe(10);
    expect(result.usage?.outputTokens).toBe(5);

    const callUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain("generateContent");
    expect(callUrl).toContain("key=test-key");

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(callBody.systemInstruction?.parts[0].text).toBe("You are Gemini");
    expect(callBody.contents[0].parts[0].text).toBe("Say hello");
  });

  it("uses responseMimeType for JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"key": "value"}' }],
            },
          },
        ],
      }),
    });

    await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
      responseFormat: "json_object",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? "{}");
    expect(callBody.generationConfig.responseMimeType).toBe("application/json");
  });

  it("retries without responseMimeType when unsupported", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "responseMimeType not supported",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "plain text" }] } }],
        }),
      });

    const result = await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
      responseFormat: "json_object",
    });

    expect(result.text).toBe("plain text");
  });

  it("parses candidates text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Part 1" }, { text: " Part 2" }],
            },
          },
        ],
      }),
    });

    const result = await provider.generate({
      systemPrompt: "",
      userPrompt: "test",
    });

    expect(result.text).toBe("Part 1 Part 2");
  });

  it("parses streaming chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n'),
        );
        controller.enqueue(
          encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"World"}]}}]}\n'),
        );
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

    expect(chunks).toEqual(["Hello ", "World"]);
    expect(result.text).toBe("Hello World");
  });
});
