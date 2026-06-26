import { describe, it, expect, vi } from "vitest";
import { generateWithResponseFormatFallback } from "../../src/ai/response-format-fallback.js";
import { AiProviderError } from "../../src/ai/ai-provider-error.js";

describe("generateWithResponseFormatFallback", () => {
  it("calls generateOnce normally when responseFormat is not json_object", async () => {
    const generateOnce = vi.fn().mockResolvedValue({ text: "hello" });

    const result = await generateWithResponseFormatFallback(
      "openai",
      { systemPrompt: "", userPrompt: "test" },
      generateOnce,
    );

    expect(result.response.text).toBe("hello");
    expect(result.fallbackOccurred).toBe(false);
    expect(generateOnce).toHaveBeenCalledTimes(1);
  });

  it("calls generateOnce with json_object when supported", async () => {
    const generateOnce = vi.fn().mockResolvedValue({ text: '{"key":"val"}' });

    const result = await generateWithResponseFormatFallback(
      "openai",
      { systemPrompt: "", userPrompt: "test", responseFormat: "json_object" },
      generateOnce,
    );

    expect(result.response.text).toBe('{"key":"val"}');
    expect(result.fallbackOccurred).toBe(false);
  });

  it("retries without response_format on unsupported_response_format error", async () => {
    const generateOnce = vi
      .fn()
      .mockRejectedValueOnce(
        new AiProviderError({
          provider: "openai",
          kind: "unsupported_response_format",
          message: "response_format not supported",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce({ text: "fallback text" });

    const result = await generateWithResponseFormatFallback(
      "openai",
      { systemPrompt: "test", userPrompt: "test", responseFormat: "json_object" },
      generateOnce,
    );

    expect(result.response.text).toBe("fallback text");
    expect(result.fallbackOccurred).toBe(true);
    expect(generateOnce).toHaveBeenCalledTimes(2);

    // Second call should not have response_format
    const secondRequest = generateOnce.mock.calls[1]?.[0];
    expect(secondRequest.responseFormat).toBe("text");
  });

  it("does not retry on non-response-format errors", async () => {
    const generateOnce = vi.fn().mockRejectedValueOnce(
      new AiProviderError({
        provider: "openai",
        kind: "unauthorized",
        message: "401 Unauthorized",
      }),
    );

    await expect(
      generateWithResponseFormatFallback(
        "openai",
        { systemPrompt: "", userPrompt: "test", responseFormat: "json_object" },
        generateOnce,
      ),
    ).rejects.toThrow(AiProviderError);

    expect(generateOnce).toHaveBeenCalledTimes(1);
  });

  it("retries on invalid_request caused by response_format", async () => {
    const generateOnce = vi
      .fn()
      .mockRejectedValueOnce(
        new AiProviderError({
          provider: "openai",
          kind: "invalid_request",
          message: "response_mime_type not supported",
        }),
      )
      .mockResolvedValueOnce({ text: "ok" });

    const result = await generateWithResponseFormatFallback(
      "gemini",
      { systemPrompt: "", userPrompt: "test", responseFormat: "json_object" },
      generateOnce,
    );

    expect(result.response.text).toBe("ok");
    expect(result.fallbackOccurred).toBe(true);
  });

  it("appends strict JSON instruction when retrying", async () => {
    const generateOnce = vi
      .fn()
      .mockRejectedValueOnce(
        new AiProviderError({
          provider: "openai",
          kind: "unsupported_response_format",
          message: "not supported",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce({ text: "ok" });

    const result = await generateWithResponseFormatFallback(
      "openai",
      {
        systemPrompt: "You are a planner.",
        userPrompt: "test",
        responseFormat: "json_object",
      },
      generateOnce,
    );

    expect(result.fallbackOccurred).toBe(true);
    const secondRequest = generateOnce.mock.calls[1]?.[0];
    expect(secondRequest.systemPrompt).toContain("ONLY valid JSON");
  });
});
