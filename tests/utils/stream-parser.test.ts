import { describe, it, expect } from "vitest";
import { parseSseStream, parseNdjsonStream } from "../../src/utils/stream-parser.js";
import { stripAnsi } from "../../src/utils/stream-lines.js";
import { mockReadableStream } from "../../src/utils/test-streams.js";

describe("parseSseStream", () => {
  it("parses basic SSE data lines", async () => {
    const stream = mockReadableStream(['data: {"text":"Hello"}\n', 'data: {"text":" world"}\n']);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["Hello", " world"]);
    expect(result.text).toBe("Hello world");
  });

  it("stops early when done is returned", async () => {
    const stream = mockReadableStream([
      'data: {"text":"first"}\n',
      'data: {"text":"second","done":true}\n',
      'data: {"text":"third"}\n',
    ]);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseSseStream(
      reader,
      async (data, emit) => {
        const text = data.text as string;
        const done = data.done === true;
        if (text && !done) {
          texts.push(text);
          emit({ textDelta: text });
        }
        if (done) return { done: true };
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["first"]);
    expect(result.text).toBe("first");
  });

  it("skips comment lines and empty lines", async () => {
    const stream = mockReadableStream([":comment\n", "\n", 'data: {"text":"only"}\n']);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["only"]);
    expect(result.text).toBe("only");
  });

  it("skips [DONE] sentinel", async () => {
    const stream = mockReadableStream(['data: {"text":"hello"}\n', "data: [DONE]\n"]);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["hello"]);
    expect(result.text).toBe("hello");
  });

  it("skips malformed JSON lines", async () => {
    const stream = mockReadableStream(["data: not-json\n", 'data: {"text":"ok"}\n']);
    const reader = stream.getReader();

    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(result.text).toBe("ok");
  });
});

describe("parseNdjsonStream", () => {
  it("parses NDJSON lines", async () => {
    const stream = mockReadableStream(['{"text":"Hello"}\n', '{"text":" world"}\n']);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseNdjsonStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["Hello", " world"]);
    expect(result.text).toBe("Hello world");
  });

  it("stops on done and tracks model", async () => {
    const stream = mockReadableStream([
      '{"text":"first","model":"llama3"}\n',
      '{"text":" done","done":true,"model":"llama3"}\n',
    ]);
    const reader = stream.getReader();

    const result = await parseNdjsonStream(
      reader,
      async (data, emit) => {
        const text = data.text as string;
        const done = data.done === true;
        const model = data.model as string | undefined;
        if (text) {
          emit({ textDelta: text });
        }
        if (done) return { done: true, model };
      },
      "test",
      "model",
    );

    expect(result.text).toBe("first done");
    expect(result.model).toBe("llama3");
  });
});

describe("parseSseStream edge cases", () => {
  it("handles data split across chunk boundaries", async () => {
    const stream = mockReadableStream(['data: {"text":"Hel', 'lo"}\n']);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["Hello"]);
    expect(result.text).toBe("Hello");
  });

  it("handles multiple data lines in one chunk", async () => {
    const stream = mockReadableStream([
      'data: {"text":"Hello"}\ndata: {"text":" "}\ndata: {"text":"world"}\n',
    ]);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["Hello", " ", "world"]);
    expect(result.text).toBe("Hello world");
  });

  it("tracks usage from emit calls", async () => {
    const stream = mockReadableStream(['data: {"text":"Hello"}\n', 'data: {"text":" world"}\n']);
    const reader = stream.getReader();

    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(result.text).toBe("Hello world");
  });

  it("tracks usage returned from onData", async () => {
    const stream = mockReadableStream([
      'data: {"text":"Hello"}\n',
      'data: {"text":" world","done":true}\n',
    ]);
    const reader = stream.getReader();

    const result = await parseSseStream(
      reader,
      async (data, emit) => {
        const text = data.text as string;
        const done = data.done === true;
        if (text) {
          emit({ textDelta: text });
        }
        if (done) {
          return { done: true, usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
        }
      },
      "test",
      "model",
    );

    expect(result.text).toBe("Hello world");
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  });

  it("returns empty text for empty stream", async () => {
    const stream = mockReadableStream([]);
    const reader = stream.getReader();

    const result = await parseSseStream(reader, () => {}, "test", "model");

    expect(result.text).toBe("");
    expect(result.usage).toBeUndefined();
  });

  it("skips lines without data: prefix", async () => {
    const stream = mockReadableStream(["event: custom\n", 'data: {"text":"valid"}\n']);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["valid"]);
    expect(result.text).toBe("valid");
  });

  it("handles UTF-8 characters split across chunks", async () => {
    const encoder = new TextEncoder();
    const chunk1 = encoder.encode('data: {"text":"');
    const chunk2 = encoder.encode("Hello 💎");
    const chunk3 = encoder.encode('"}\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.enqueue(chunk3);
        controller.close();
      },
    });
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseSseStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["Hello 💎"]);
    expect(result.text).toBe("Hello 💎");
  });

  it("uses usage from emit when onData also returns", async () => {
    const stream = mockReadableStream(['data: {"text":"done","done":true}\n']);
    const reader = stream.getReader();

    const result = await parseSseStream(
      reader,
      async (data, emit) => {
        emit({ textDelta: "done", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } });
        if (data.done === true) {
          return { done: true };
        }
      },
      "test",
      "model",
    );

    expect(result.text).toBe("done");
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
  });
});

describe("parseNdjsonStream edge cases", () => {
  it("handles data split across chunk boundaries", async () => {
    const stream = mockReadableStream(['{"text":"Hel', 'lo"}\n']);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseNdjsonStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["Hello"]);
    expect(result.text).toBe("Hello");
  });

  it("returns empty text for empty stream", async () => {
    const stream = mockReadableStream([]);
    const reader = stream.getReader();

    const result = await parseNdjsonStream(reader, () => {}, "test", "model");

    expect(result.text).toBe("");
    expect(result.model).toBe("model");
    expect(result.usage).toBeUndefined();
  });

  it("skips malformed JSON lines and continues", async () => {
    const stream = mockReadableStream(["not-json\n", '{"text":"ok"}\n']);
    const reader = stream.getReader();

    const result = await parseNdjsonStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(result.text).toBe("ok");
  });

  it("skips empty lines", async () => {
    const stream = mockReadableStream(["\n", '{"text":"only"}\n', "\n"]);
    const reader = stream.getReader();

    const texts: string[] = [];
    const result = await parseNdjsonStream(
      reader,
      (data, emit) => {
        const text = data.text as string;
        if (text) {
          texts.push(text);
          emit({ textDelta: text });
        }
      },
      "test",
      "model",
    );

    expect(texts).toEqual(["only"]);
    expect(result.text).toBe("only");
  });

  it("updates model from onData return on done", async () => {
    const stream = mockReadableStream([
      '{"text":"Hello"}\n',
      '{"text":" world","done":true,"model":"llama3"}\n',
    ]);
    const reader = stream.getReader();

    const result = await parseNdjsonStream(
      reader,
      async (data, emit) => {
        const text = data.text as string;
        const done = data.done === true;
        const model = data.model as string | undefined;
        if (text) {
          emit({ textDelta: text });
        }
        if (done) return { done: true, model };
      },
      "test",
      "initial-model",
    );

    expect(result.text).toBe("Hello world");
    expect(result.model).toBe("llama3");
  });

  it("tracks usage from emit calls", async () => {
    const stream = mockReadableStream(['{"text":"Hello"}\n', '{"text":" world","done":true}\n']);
    const reader = stream.getReader();

    const result = await parseNdjsonStream(
      reader,
      async (data, emit) => {
        const text = data.text as string;
        const done = data.done === true;
        if (text) {
          emit({ textDelta: text });
        }
        if (done) {
          return { done: true, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        }
      },
      "test",
      "model",
    );

    expect(result.text).toBe("Hello world");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it("uses emit usage when onData does not return usage", async () => {
    const stream = mockReadableStream(['{"text":"only","done":true}\n']);
    const reader = stream.getReader();

    const result = await parseNdjsonStream(
      reader,
      async (data, emit) => {
        emit({ textDelta: "only", usage: { inputTokens: 3, outputTokens: 7, totalTokens: 10 } });
        if (data.done === true) {
          return { done: true };
        }
      },
      "test",
      "model",
    );

    expect(result.text).toBe("only");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 7, totalTokens: 10 });
  });

  it("preserves default model when no model returned", async () => {
    const stream = mockReadableStream(['{"text":"Hello"}\n', '{"text":" world","done":true}\n']);
    const reader = stream.getReader();

    const result = await parseNdjsonStream(
      reader,
      async (data, emit) => {
        const text = data.text as string;
        const done = data.done === true;
        if (text) {
          emit({ textDelta: text });
        }
        if (done) return { done: true };
      },
      "test",
      "default-model",
    );

    expect(result.text).toBe("Hello world");
    expect(result.model).toBe("default-model");
  });
});

describe("stripAnsi", () => {
  it("strips ANSI escape codes", () => {
    expect(stripAnsi("\u001b[32mgreen\u001b[0m")).toBe("green");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("strips multiple ANSI sequences", () => {
    expect(stripAnsi("\u001b[1m\u001b[31mbold red\u001b[0m")).toBe("bold red");
  });

  it("strips complex ANSI sequences", () => {
    expect(stripAnsi("\u001b[38;2;255;255;255mwhite\u001b[0m")).toBe("white");
  });

  it("handles text with no ANSI codes", () => {
    expect(stripAnsi("plain text withno special chars")).toBe("plain text withno special chars");
  });
});
