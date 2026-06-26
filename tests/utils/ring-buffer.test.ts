import { describe, it, expect } from "vitest";
import { RingBuffer } from "../../src/utils/ring-buffer.js";

describe("RingBuffer", () => {
  it("should store and retrieve lines", () => {
    const buf = new RingBuffer(3, 100);
    buf.push("line1");
    buf.push("line2");
    buf.push("line3");
    expect(buf.getLines()).toEqual(["line1", "line2", "line3"]);
    expect(buf.length).toBe(3);
  });

  it("should drop oldest lines when exceeding max lines", () => {
    const buf = new RingBuffer(3, 100);
    buf.push("line1");
    buf.push("line2");
    buf.push("line3");
    buf.push("line4");
    expect(buf.getLines()).toEqual(["line2", "line3", "line4"]);
    expect(buf.length).toBe(3);
  });

  it("should truncate long lines", () => {
    const buf = new RingBuffer(10, 5);
    buf.push("hello world this is long");
    expect(buf.getLines()[0]).toBe("hello...");
  });

  it("should return joined text", () => {
    const buf = new RingBuffer(3, 100);
    buf.push("a");
    buf.push("b");
    expect(buf.getText(", ")).toBe("a, b");
  });

  it("should clear", () => {
    const buf = new RingBuffer(3, 100);
    buf.push("line1");
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.getLines()).toEqual([]);
  });

  it("default max lines should be 500", () => {
    const buf = new RingBuffer();
    for (let i = 0; i < 600; i++) {
      buf.push(`line${i}`);
    }
    expect(buf.length).toBe(500);
  });

  it("should not grow beyond max lines", () => {
    const buf = new RingBuffer(2, 100);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    expect(buf.getLines()).toEqual(["b", "c"]);
  });
});
