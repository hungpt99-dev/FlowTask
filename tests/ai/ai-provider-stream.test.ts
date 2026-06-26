import { describe, it, expect, vi } from "vitest";
import {
  streamToEventBus,
  type AiProvider,
  type AiProviderRequest,
} from "../../src/ai/ai-provider.js";

describe("streamToEventBus", () => {
  it("calls generate when provider has no stream method", async () => {
    const provider: AiProvider = {
      name: "test",
      async generate(_request: AiProviderRequest) {
        return { text: "result" };
      },
    };

    const bus = { emit: vi.fn() };
    const result = await streamToEventBus(provider, { systemPrompt: "", userPrompt: "hi" }, bus);

    expect(result.text).toBe("result");
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("emits stream started and delta events", async () => {
    const provider: AiProvider = {
      name: "test",
      supportsStreaming: true,
      async generate(_request: AiProviderRequest) {
        return { text: "" };
      },
      async stream(_request, onChunk) {
        await onChunk({ provider: "test", model: "m", textDelta: "Hello" });
        await onChunk({ provider: "test", model: "m", textDelta: " world" });
        await onChunk({ provider: "test", model: "m", textDelta: "", done: true });
        return { text: "Hello world", model: "m", provider: "test" };
      },
    };

    const bus = { emit: vi.fn() };
    const result = await streamToEventBus(
      provider,
      { systemPrompt: "", userPrompt: "hi", stream: true },
      bus,
    );

    expect(result.text).toBe("Hello world");
    expect(bus.emit).toHaveBeenCalledTimes(3);
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai_provider_stream_started", provider: "test" }),
    );
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai_provider_stream_delta", textDelta: "Hello" }),
    );
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai_provider_stream_delta", textDelta: " world" }),
    );
  });

  it("does not emit delta for done chunks", async () => {
    const provider: AiProvider = {
      name: "test",
      supportsStreaming: true,
      async generate(_request: AiProviderRequest) {
        return { text: "" };
      },
      async stream(_request, onChunk) {
        await onChunk({ provider: "test", model: "m", textDelta: "only" });
        await onChunk({ provider: "test", model: "m", textDelta: "", done: true });
        return { text: "only", model: "m", provider: "test" };
      },
    };

    const bus = { emit: vi.fn() };
    const result = await streamToEventBus(provider, { systemPrompt: "", userPrompt: "hi" }, bus, {
      runId: "run_1",
      taskId: "task_1",
    });

    expect(result.text).toBe("only");
    const deltas = bus.emit.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "ai_provider_stream_delta",
    );
    expect(deltas).toHaveLength(1);
    const startedArg = bus.emit.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "ai_provider_stream_started",
    )?.[0] as Record<string, unknown>;
    expect(startedArg.runId).toBe("run_1");
    expect(startedArg.taskId).toBe("task_1");
  });

  it("propagates error when provider.stream throws", async () => {
    const provider: AiProvider = {
      name: "test",
      async generate(_request: AiProviderRequest) {
        return { text: "" };
      },
      async stream() {
        throw new Error("stream failed");
      },
    };

    const bus = { emit: vi.fn() };
    await expect(
      streamToEventBus(provider, { systemPrompt: "", userPrompt: "hi", stream: true }, bus),
    ).rejects.toThrow("stream failed");
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ai_provider_stream_started" }),
    );
  });

  it("passes usage from stream result to bus events", async () => {
    const provider: AiProvider = {
      name: "test",
      supportsStreaming: true,
      async generate(_request: AiProviderRequest) {
        return { text: "" };
      },
      async stream(_request, onChunk) {
        await onChunk({ provider: "test", model: "m", textDelta: "data" });
        await onChunk({
          provider: "test",
          model: "m",
          textDelta: "",
          done: true,
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        });
        return {
          text: "data",
          model: "m",
          provider: "test",
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        };
      },
    };

    const bus = { emit: vi.fn() };
    const result = await streamToEventBus(
      provider,
      { systemPrompt: "", userPrompt: "hi", stream: true },
      bus,
    );

    expect(result.usage?.totalTokens).toBe(8);
    // Only delta events emitted, not the done/usage chunk
    const deltas = bus.emit.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "ai_provider_stream_delta",
    );
    expect(deltas).toHaveLength(1);
  });

  it("includes timestamps in all events", async () => {
    const provider: AiProvider = {
      name: "test",
      supportsStreaming: true,
      async generate(_request: AiProviderRequest) {
        return { text: "" };
      },
      async stream(_request, onChunk) {
        await onChunk({ provider: "test", model: "m", textDelta: "hello" });
        return { text: "hello", model: "m", provider: "test" };
      },
    };

    const bus = { emit: vi.fn() };
    await streamToEventBus(provider, { systemPrompt: "", userPrompt: "hi" }, bus);

    const calls = bus.emit.mock.calls as Array<[{ timestamp?: string }]>;
    for (const [event] of calls) {
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe("string");
      expect(() => new Date(event.timestamp as string)).not.toThrow();
    }
  });

  it("propagates runId and taskId to all delta events", async () => {
    const provider: AiProvider = {
      name: "test",
      supportsStreaming: true,
      async generate(_request: AiProviderRequest) {
        return { text: "" };
      },
      async stream(_request, onChunk) {
        await onChunk({ provider: "test", model: "m", textDelta: "a" });
        await onChunk({ provider: "test", model: "m", textDelta: "b" });
        return { text: "ab", model: "m", provider: "test" };
      },
    };

    const bus = { emit: vi.fn() };
    await streamToEventBus(provider, { systemPrompt: "", userPrompt: "hi" }, bus, {
      runId: "run_1",
      taskId: "task_1",
    });

    const deltas = bus.emit.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "ai_provider_stream_delta",
    );
    for (const [event] of deltas) {
      expect((event as Record<string, unknown>).runId).toBe("run_1");
      expect((event as Record<string, unknown>).taskId).toBe("task_1");
    }
  });

  it("uses 'unknown' model when model not in request", async () => {
    const provider: AiProvider = {
      name: "test",
      supportsStreaming: true,
      async generate(_request: AiProviderRequest) {
        return { text: "" };
      },
      async stream() {
        return { text: "", model: "m", provider: "test" };
      },
    };

    const bus = { emit: vi.fn() };
    await streamToEventBus(
      provider,
      // request with no model field
      { systemPrompt: "", userPrompt: "hi" },
      bus,
    );

    const startedArg = bus.emit.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "ai_provider_stream_started",
    )?.[0] as Record<string, unknown>;
    expect(startedArg.model).toBe("unknown");
  });
});
