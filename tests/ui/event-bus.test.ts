import { describe, it, expect } from "vitest";
import { EventBus, getEventBus, setEventBus } from "../../src/ui/event-bus.js";

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

describe("EventBus", () => {
  it("emits and receives events", async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on("task_started", (event) => {
      received.push(event.type);
    });

    bus.emit({ type: "task_started", taskId: "task_001", title: "Test", index: 1, total: 3 });
    await flushMicrotasks();
    expect(received).toEqual(["task_started"]);
  });

  it("removes listeners with off()", async () => {
    const bus = new EventBus();
    let count = 0;

    const handler = () => {
      count++;
    };
    bus.on("task_completed", handler);
    bus.emit({ type: "task_completed", taskId: "task_001", title: "Test" });
    await flushMicrotasks();
    expect(count).toBe(1);

    bus.off("task_completed", handler);
    bus.emit({ type: "task_completed", taskId: "task_001", title: "Test" });
    await flushMicrotasks();
    expect(count).toBe(1);
  });

  it("maintains event history", () => {
    const bus = new EventBus();
    bus.emit({ type: "info", message: "test" });
    const history = bus.getHistory();
    expect(history.length).toBe(1);
    expect(history[0]!.type).toBe("info");
  });

  it("clears history", () => {
    const bus = new EventBus();
    bus.emit({ type: "info", message: "test" });
    bus.clear();
    expect(bus.getHistory().length).toBe(0);
  });

  it("supports global event bus singleton", () => {
    const bus1 = getEventBus();
    const bus2 = getEventBus();
    expect(bus1).toBe(bus2);
  });

  it("allows setting custom global bus", () => {
    const custom = new EventBus();
    setEventBus(custom);
    expect(getEventBus()).toBe(custom);

    setEventBus(new EventBus());
  });
});
