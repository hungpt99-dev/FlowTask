import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { JsonRenderer } from "../../src/ui/renderers/json-renderer.js";
import { EventBus } from "../../src/ui/event-bus.js";
import type { UiEvent } from "../../src/ui/event-bus.js";

describe("JsonRenderer", () => {
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    originalWrite = process.stdout.write;
    process.stdout.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stdout.write;
  });

  afterAll(() => {
    process.stdout.write = originalWrite;
  });

  function writeSpy(): ReturnType<typeof vi.fn> {
    return process.stdout.write as unknown as ReturnType<typeof vi.fn>;
  }

  it("writes executor output as JSON line", () => {
    const renderer = new JsonRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    const event: UiEvent = {
      type: "executor_output",
      runId: "run_001",
      taskId: "task_001",
      executor: "shell",
      stream: "stdout",
      text: "hello",
    };

    bus.emit(event);

    expect(writeSpy()).toHaveBeenCalledTimes(1);
    const output = writeSpy().mock.calls[0]![0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed).toMatchObject({
      type: "executor_output",
      runId: "run_001",
      taskId: "task_001",
      executor: "shell",
      stream: "stdout",
      text: "hello",
    });
  });

  it("writes all event types as JSON", () => {
    const renderer = new JsonRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    const events: UiEvent[] = [
      { type: "info", message: "start" },
      {
        type: "executor_started",
        runId: "r1",
        taskId: "t1",
        executor: "shell",
        command: "ls",
        args: [],
      },
      { type: "task_started", taskId: "t1", title: "Task 1", index: 1, total: 2 },
    ];

    for (const event of events) {
      bus.emit(event);
    }

    expect(writeSpy()).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const output = writeSpy().mock.calls[i]![0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.type).toBe(events[i]!.type);
    }
  });

  it("returns unsubscribe function from subscribe", () => {
    const renderer = new JsonRenderer();
    const bus = new EventBus();

    const unsubscribe = renderer.subscribe(bus);
    expect(typeof unsubscribe).toBe("function");

    bus.emit({ type: "info", message: "before" });
    expect(writeSpy()).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.emit({ type: "info", message: "after" });
    expect(writeSpy()).toHaveBeenCalledTimes(1);
  });

  describe("write method", () => {
    it("writes a single event as JSON", () => {
      const renderer = new JsonRenderer();

      renderer.write({
        type: "executor_output",
        runId: "r1",
        taskId: "t1",
        executor: "shell",
        stream: "stdout",
        text: "direct write",
      });

      expect(writeSpy()).toHaveBeenCalledTimes(1);
      const output = writeSpy().mock.calls[0]![0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.text).toBe("direct write");
    });
  });

  describe("writeEvents method", () => {
    it("writes multiple events as JSON lines", () => {
      const renderer = new JsonRenderer();

      renderer.writeEvents([
        { type: "info", message: "first" },
        { type: "info", message: "second" },
      ]);

      expect(writeSpy()).toHaveBeenCalledTimes(2);
      const first = JSON.parse((writeSpy().mock.calls[0]![0] as string).trim());
      const second = JSON.parse((writeSpy().mock.calls[1]![0] as string).trim());
      expect(first.message).toBe("first");
      expect(second.message).toBe("second");
    });
  });
});
