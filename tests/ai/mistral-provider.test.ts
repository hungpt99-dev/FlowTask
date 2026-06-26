import { describe, it, expect, vi, beforeEach } from "vitest";
import { MistralProvider } from "../../src/ai/providers/mistral-provider.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("MistralProvider", () => {
  let provider: MistralProvider;

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
});
