import { describe, it, expect } from "vitest";
import { LineBuffer } from "../../src/utils/stream-lines.js";

describe("LineBuffer", () => {
  it("emits complete lines", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((line) => lines.push(line));
    buf.push("hello\nworld\n");
    expect(lines).toEqual(["hello", "world"]);
  });

  it("handles partial chunks", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((line) => lines.push(line));
    buf.push("hel");
    buf.push("lo\nwo");
    buf.push("rld\n");
    expect(lines).toEqual(["hello", "world"]);
  });

  it("flushes final partial line", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((line) => lines.push(line));
    buf.push("hello\nworld");
    buf.flush();
    expect(lines).toEqual(["hello", "world"]);
  });

  it("handles empty chunks", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((line) => lines.push(line));
    buf.push("");
    expect(lines).toEqual([]);
  });

  it("handles single line without newline", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((line) => lines.push(line));
    buf.push("hello");
    buf.flush();
    expect(lines).toEqual(["hello"]);
  });

  it("handles multiple newlines", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((line) => lines.push(line));
    buf.push("a\n\nb\n");
    expect(lines).toEqual(["a", "b"]);
  });
});
