import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { PlainRenderer } from "../../src/ui/renderers/plain-renderer.js";
import { EventBus } from "../../src/ui/event-bus.js";

describe("PlainRenderer", () => {
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

  it("writes executor output text to stdout with newline", () => {
    const renderer = new PlainRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "run_001",
      taskId: "task_001",
      executor: "shell",
      stream: "stdout",
      text: "hello world",
    });

    expect(writeSpy()).toHaveBeenCalledTimes(1);
    expect(writeSpy()).toHaveBeenCalledWith("hello world\n");
  });

  it("writes stderr output to stdout too", () => {
    const renderer = new PlainRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "run_001",
      taskId: "task_001",
      executor: "shell",
      stream: "stderr",
      text: "error message",
    });

    expect(writeSpy()).toHaveBeenCalledWith("error message\n");
  });

  it("renders task_started as separator", () => {
    const renderer = new PlainRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({ type: "task_started", taskId: "t1", title: "My Task", index: 2, total: 5 });

    expect(writeSpy()).toHaveBeenCalledTimes(1);
    expect(writeSpy()).toHaveBeenCalledWith("--- [2/5] My Task ---\n");
  });

  it("ignores info and completion events", () => {
    const renderer = new PlainRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({ type: "info", message: "test" });
    bus.emit({ type: "run_completed", success: true });

    expect(writeSpy()).not.toHaveBeenCalled();
  });

  it("renders timestamp when showTimestamp is enabled", () => {
    const renderer = new PlainRenderer({ showTimestamp: true });
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "timestamped",
    });

    const output = writeSpy().mock.calls[0]![0] as string;
    expect(output).toContain("timestamped");
    expect(output).toMatch(/^\[.*\] timestamped\n$/);
  });

  it("strips ANSI escape codes from output", () => {
    const renderer = new PlainRenderer();
    const bus = new EventBus();

    renderer.subscribe(bus);

    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "\u001b[32mgreen\u001b[0m",
    });

    const output = writeSpy().mock.calls[0]![0] as string;
    expect(output).toBe("green\n");
  });

  it("returns unsubscribe function from subscribe", () => {
    const renderer = new PlainRenderer();
    const bus = new EventBus();

    const unsubscribe = renderer.subscribe(bus);
    expect(typeof unsubscribe).toBe("function");

    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "first",
    });
    expect(writeSpy()).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.emit({
      type: "executor_output",
      runId: "r1",
      taskId: "t1",
      executor: "shell",
      stream: "stdout",
      text: "second",
    });
    expect(writeSpy()).toHaveBeenCalledTimes(1);
  });
});
