import { describe, it, expect, beforeAll } from "vitest";
import { EventStore } from "../../src/core/event-store.js";
import { testDir } from "../setup.js";

describe("EventStore", () => {
  let store: EventStore;

  beforeAll(() => {
    store = new EventStore(testDir);
  });

  it("should create an instance", () => {
    expect(store).toBeInstanceOf(EventStore);
  });

  it("should read empty run events when no events exist", async () => {
    const events = await store.readRunEvents("non-existent-run");
    expect(events).toEqual([]);
  });

  it("should append and read events for a run", async () => {
    const runId = "test-run-events";
    await store.appendToRun(runId, {
      type: "run_created",
      runId,
      message: "Test run created",
    });
    await store.appendToRun(runId, {
      type: "run_started",
      runId,
      message: "Test run started",
    });
    await store.appendToRun(runId, {
      type: "task_started",
      runId,
      taskId: "task_001",
      message: "First task",
    });

    const events = await store.readRunEvents(runId);
    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe("run_created");
    expect(events[1]!.type).toBe("run_started");
    expect(events[2]!.type).toBe("task_started");
  });

  it("should include timestamps on events", async () => {
    const runId = "test-timestamps";
    await store.appendToRun(runId, {
      type: "run_created",
      runId,
    });
    const events = await store.readRunEvents(runId);
    expect(events[0]!.time).toBeDefined();
    expect(() => new Date(events[0]!.time)).not.toThrow();
  });

  it("should handle many events", async () => {
    const runId = "test-many-events";
    for (let i = 0; i < 20; i++) {
      await store.appendToRun(runId, {
        type: "task_completed",
        runId,
        taskId: `task_${i}`,
      });
    }
    const events = await store.readRunEvents(runId);
    expect(events).toHaveLength(20);
  });
});
