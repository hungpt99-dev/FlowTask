import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { RichRenderer } from "../../src/ui/renderers/rich-renderer.js";
import { EventBus } from "../../src/ui/event-bus.js";

describe("RichRenderer", () => {
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

  it("writes stdout output with dim > prefix", () => {
    const renderer = new RichRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "run_001",
      taskId: "task_001",
      executor: "shell",
      stream: "stdout",
      text: "building...",
    });

    expect(writeSpy()).toHaveBeenCalledTimes(1);
    const output = writeSpy().mock.calls[0]![0] as string;
    expect(output).toContain("building...");
    expect(output).toContain(">");
    expect(output).toMatch(/^\s{2}.*\n$/);
  });

  it("writes stderr output with yellow ! prefix", () => {
    const renderer = new RichRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "run_001",
      taskId: "task_001",
      executor: "shell",
      stream: "stderr",
      text: "warning: something",
    });

    expect(writeSpy()).toHaveBeenCalledTimes(1);
    const output = writeSpy().mock.calls[0]![0] as string;
    expect(output).toContain("warning: something");
    expect(output).toContain("!");
  });

  it("ignores non-output events", () => {
    const renderer = new RichRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({ type: "info", message: "test" });
    bus.emit({
      type: "executor_started",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      command: "ls",
      args: [],
    });

    expect(writeSpy()).not.toHaveBeenCalled();
  });

  it("returns unsubscribe function", () => {
    const renderer = new RichRenderer();
    const bus = new EventBus();

    const unsubscribe = renderer.subscribe(bus);
    expect(typeof unsubscribe).toBe("function");

    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "before",
    });
    expect(writeSpy()).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "after",
    });
    expect(writeSpy()).toHaveBeenCalledTimes(1);
  });

  it("handles empty text output", () => {
    const renderer = new RichRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "",
    });

    expect(writeSpy()).toHaveBeenCalledTimes(1);
  });

  it("handles multi-line text output", () => {
    const renderer = new RichRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "line1\nline2\nline3",
    });

    expect(writeSpy()).toHaveBeenCalledTimes(1);
    const output = writeSpy().mock.calls[0]![0] as string;
    expect(output).toContain("line1\nline2\nline3");
  });

  it("renders task_started as separator header", () => {
    const renderer = new RichRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "task_started",
      taskId: "t1",
      title: "Build",
      index: 2,
      total: 5,
    });

    expect(writeSpy()).toHaveBeenCalledTimes(1);
    const output = writeSpy().mock.calls[0]![0] as string;
    expect(output).toContain("Build");
    expect(output).toContain("[2/5]");
  });

  it("renders timestamp when showTimestamp is enabled", () => {
    const renderer = new RichRenderer({ showTimestamp: true });
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "with time",
    });

    const output = writeSpy().mock.calls[0]![0] as string;
    expect(output).toContain("with time");
    expect(output).toMatch(/\[.*\]/);
  });

  it("truncates long lines", () => {
    const renderer = new RichRenderer({ maxLineLength: 10 });
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "this is a very long line that should be truncated",
    });

    const output = writeSpy().mock.calls[0]![0] as string;
    expect(output).toContain("\u2026");
    expect(output!.length).toBeLessThan("this is a very long line that should be truncated".length);
  });
});
