import { describe, it, expect } from "vitest";
import {
  AiProviderError,
  redactErrorMessage,
  getSuggestionForError,
} from "../../src/ai/ai-provider-error.js";

describe("AiProviderError", () => {
  it("normalizes missing_api_key", () => {
    const err = new AiProviderError({
      provider: "openai",
      kind: "missing_api_key",
      message: "Missing API key",
    });
    expect(err.kind).toBe("missing_api_key");
    expect(err.provider).toBe("openai");
    expect(err.retryable).toBe(false);
  });

  it("normalizes unauthorized (401)", () => {
    const err = new AiProviderError({
      provider: "openai",
      kind: "unauthorized",
      message: "Unauthorized",
      statusCode: 401,
    });
    expect(err.kind).toBe("unauthorized");
    expect(err.statusCode).toBe(401);
    expect(err.retryable).toBe(false);
  });

  it("normalizes rate_limited (429)", () => {
    const err = new AiProviderError({
      provider: "openai",
      kind: "rate_limited",
      message: "Rate limited",
      statusCode: 429,
      retryable: true,
    });
    expect(err.kind).toBe("rate_limited");
    expect(err.statusCode).toBe(429);
    expect(err.retryable).toBe(true);
  });

  it("normalizes unsupported_response_format", () => {
    const err = new AiProviderError({
      provider: "gemini",
      kind: "unsupported_response_format",
      message: "response_format not supported",
      retryable: true,
    });
    expect(err.kind).toBe("unsupported_response_format");
    expect(err.retryable).toBe(true);
  });

  it("normalizes model_not_found (404)", () => {
    const err = new AiProviderError({
      provider: "anthropic",
      kind: "model_not_found",
      message: "Model not found",
      statusCode: 404,
    });
    expect(err.kind).toBe("model_not_found");
    expect(err.statusCode).toBe(404);
  });

  it("normalizes server_error (5xx)", () => {
    const err = new AiProviderError({
      provider: "openai",
      kind: "server_error",
      message: "Server error",
      statusCode: 503,
      retryable: true,
    });
    expect(err.kind).toBe("server_error");
    expect(err.retryable).toBe(true);
  });

  it("normalizes timeout", () => {
    const err = new AiProviderError({
      provider: "openai",
      kind: "timeout",
      message: "Timed out",
      retryable: true,
    });
    expect(err.kind).toBe("timeout");
    expect(err.retryable).toBe(true);
  });

  it("normalizes network_error", () => {
    const err = new AiProviderError({
      provider: "ollama",
      kind: "network_error",
      message: "Connection refused",
      retryable: true,
    });
    expect(err.kind).toBe("network_error");
    expect(err.retryable).toBe(true);
  });

  it("errors redact secrets", () => {
    const message = "Error: sk-proj-my-secret-key not valid";
    const secrets = new Set(["sk-proj-my-secret-key"]);
    const redacted = redactErrorMessage(message, secrets);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("sk-proj-my-secret-key");
  });

  it("redactErrorMessage handles empty secrets set", () => {
    const message = "Some error message";
    const redacted = redactErrorMessage(message, new Set());
    expect(redacted).toBe(message);
  });

  it("getSuggestionForError returns appropriate suggestion", () => {
    expect(getSuggestionForError("missing_api_key", "openai")).toContain("OPENAI_API_KEY");
    expect(getSuggestionForError("unauthorized", "openai")).toContain("API key is valid");
    expect(getSuggestionForError("rate_limited", "openai")).toContain("retried");
    expect(getSuggestionForError("unsupported_response_format", "gemini")).toContain(
      "retry without it",
    );
    expect(getSuggestionForError("model_not_found", "openai")).toContain("planner.model");
    expect(getSuggestionForError("timeout", "openai")).toContain("increase planner timeout");
    expect(getSuggestionForError("server_error", "openai")).toContain("Retry later");
  });
});
