import { describe, it, expect } from "vitest";
import {
  LineBuffer,
  stripAnsi,
  parseSseStream,
  parseNdjsonStream,
  extractOpenAiDelta,
  extractOpenAiFinishReason,
  extractOpenAiUsage,
  extractAnthropicDelta,
  extractAnthropicDone,
  extractGeminiDelta,
  extractGeminiUsage,
  extractOllamaDelta,
  extractOllamaDone,
  extractModel,
} from "../src/stream.js";
import type { StreamParseResult } from "../src/stream.js";

describe("stream barrel module", () => {
  it("exports LineBuffer", () => {
    expect(LineBuffer).toBeDefined();
    expect(LineBuffer).toBeInstanceOf(Function);
  });

  it("exports stripAnsi", () => {
    expect(stripAnsi).toBeDefined();
    expect(stripAnsi).toBeInstanceOf(Function);
  });

  it("exports parseSseStream", () => {
    expect(parseSseStream).toBeDefined();
    expect(parseSseStream).toBeInstanceOf(Function);
  });

  it("exports parseNdjsonStream", () => {
    expect(parseNdjsonStream).toBeDefined();
    expect(parseNdjsonStream).toBeInstanceOf(Function);
  });

  it("exports StreamParseResult type", () => {
    const _typeCheck: StreamParseResult | undefined = undefined;
    expect(_typeCheck).toBeUndefined();
  });

  it("exports extractOpenAiDelta", () => {
    expect(extractOpenAiDelta).toBeInstanceOf(Function);
  });

  it("exports extractOpenAiFinishReason", () => {
    expect(extractOpenAiFinishReason).toBeInstanceOf(Function);
  });

  it("exports extractOpenAiUsage", () => {
    expect(extractOpenAiUsage).toBeInstanceOf(Function);
  });

  it("exports extractAnthropicDelta", () => {
    expect(extractAnthropicDelta).toBeInstanceOf(Function);
  });

  it("exports extractAnthropicDone", () => {
    expect(extractAnthropicDone).toBeInstanceOf(Function);
  });

  it("exports extractGeminiDelta", () => {
    expect(extractGeminiDelta).toBeInstanceOf(Function);
  });

  it("exports extractGeminiUsage", () => {
    expect(extractGeminiUsage).toBeInstanceOf(Function);
  });

  it("exports extractOllamaDelta", () => {
    expect(extractOllamaDelta).toBeInstanceOf(Function);
  });

  it("exports extractOllamaDone", () => {
    expect(extractOllamaDone).toBeInstanceOf(Function);
  });

  it("exports extractModel", () => {
    expect(extractModel).toBeInstanceOf(Function);
  });

  it("delegates stripAnsi correctly", () => {
    const input = "\u001b[32mhello\u001b[0m";
    expect(stripAnsi(input)).toBe("hello");
  });

  it("delegates LineBuffer correctly", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((line) => lines.push(line));
    buf.push(Buffer.from("foo\nbar\n"));
    expect(lines).toEqual(["foo", "bar"]);
  });
});
