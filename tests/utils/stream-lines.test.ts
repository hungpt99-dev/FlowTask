import { describe, it, expect, vi } from "vitest";
import { LineBuffer } from "../../src/utils/stream-lines.js";

describe("LineBuffer", () => {
  it("calls onLine for each complete line", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.push(Buffer.from("line1\nline2\nline3\n"));

    expect(onLine).toHaveBeenCalledTimes(3);
    expect(onLine).toHaveBeenNthCalledWith(1, "line1");
    expect(onLine).toHaveBeenNthCalledWith(2, "line2");
    expect(onLine).toHaveBeenNthCalledWith(3, "line3");
  });

  it("buffers partial lines until flush", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.push(Buffer.from("hello "));
    expect(onLine).not.toHaveBeenCalled();

    buf.push(Buffer.from("world\n"));
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith("hello world");
  });

  it("returns remaining partial line on flush", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.push(Buffer.from("partial"));
    expect(onLine).not.toHaveBeenCalled();

    buf.flush();
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith("partial");
  });

  it("does not emit empty flush when buffer is empty", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.flush();
    expect(onLine).not.toHaveBeenCalled();
  });

  it("handles multiple chunks across buffers", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.push(Buffer.from("a\nb\nc"));
    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine).toHaveBeenNthCalledWith(1, "a");
    expect(onLine).toHaveBeenNthCalledWith(2, "b");

    buf.push(Buffer.from("\nd\n"));
    expect(onLine).toHaveBeenCalledTimes(4);
    expect(onLine).toHaveBeenNthCalledWith(3, "c");
    expect(onLine).toHaveBeenNthCalledWith(4, "d");
  });

  it("handles empty buffer push", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.push(Buffer.from(""));
    expect(onLine).not.toHaveBeenCalled();
  });

  it("handles trailing newline", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.push(Buffer.from("only one\n"));
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith("only one");

    buf.flush();
    expect(onLine).toHaveBeenCalledTimes(1);
  });

  it("handles windows-style CRLF line endings", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.push(Buffer.from("a\r\nb\r\nc\r\n"));

    expect(onLine).toHaveBeenCalledTimes(3);
    expect(onLine).toHaveBeenNthCalledWith(1, "a\r");
    expect(onLine).toHaveBeenNthCalledWith(2, "b\r");
    expect(onLine).toHaveBeenNthCalledWith(3, "c\r");
  });

  it("handles many lines efficiently", () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`line${i}`);
    }
    const input = lines.join("\n") + "\n";

    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.push(Buffer.from(input));
    expect(onLine).toHaveBeenCalledTimes(1000);
    expect(onLine).toHaveBeenNthCalledWith(500, "line499");
  });

  it("strips ANSI escape codes when stripAnsi option is true", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine, { stripAnsi: true });

    buf.push(Buffer.from("\u001b[32mhello\u001b[0m\n\u001b[1mworld\u001b[0m\n"));

    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine).toHaveBeenNthCalledWith(1, "hello");
    expect(onLine).toHaveBeenNthCalledWith(2, "world");
  });

  it("does not strip ANSI by default", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine);

    buf.push(Buffer.from("\u001b[32mhello\n"));

    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith("\u001b[32mhello");
  });

  it("flushes ANSI-stripped partial line", () => {
    const onLine = vi.fn();
    const buf = new LineBuffer(onLine, { stripAnsi: true });

    buf.push(Buffer.from("\u001b[32mpar"));
    buf.flush();

    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith("par");
  });
});
