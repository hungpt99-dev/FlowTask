import { describe, it, expect } from "vitest";
import {
  mockReadableStream,
  makeSseChunk,
  makeSseChunks,
  makeNdjsonChunk,
  makeNdjsonChunks,
  mockSseResponse,
  mockNdjsonResponse,
} from "../../src/utils/test-streams.js";

describe("test-streams", () => {
  it("mockReadableStream produces encoded chunks", async () => {
    const stream = mockReadableStream(["hello", " world"]);
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe("hello");

    const second = await reader.read();
    expect(decoder.decode(second.value)).toBe(" world");

    const done = await reader.read();
    expect(done.done).toBe(true);
  });

  it("makeSseChunk formats data correctly", () => {
    const result = makeSseChunk({ text: "hi" });
    expect(result).toBe('data: {"text":"hi"}\n\n');
  });

  it("makeSseChunks returns array of formatted chunks", () => {
    const result = makeSseChunks([{ a: 1 }, { b: 2 }]);
    expect(result).toEqual(['data: {"a":1}\n\n', 'data: {"b":2}\n\n']);
  });

  it("makeNdjsonChunk formats data correctly", () => {
    const result = makeNdjsonChunk({ text: "hi" });
    expect(result).toBe('{"text":"hi"}\n');
  });

  it("makeNdjsonChunks returns array of formatted chunks", () => {
    const result = makeNdjsonChunks([{ a: 1 }, { b: 2 }]);
    expect(result).toEqual(['{"a":1}\n', '{"b":2}\n']);
  });

  it("mockSseResponse creates response with event-stream content type", () => {
    const chunks = makeSseChunks([{ text: "hello" }]);
    const response = mockSseResponse(chunks);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("mockNdjsonResponse creates response with ndjson content type", () => {
    const chunks = makeNdjsonChunks([{ text: "hello" }]);
    const response = mockNdjsonResponse(chunks);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
  });
});
