import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { EventStore } from "../../src/core/event-store.js";
import { DatabaseManager } from "../../src/core/database-manager.js";

function makeTestDir(): string {
  const dir = path.join(os.tmpdir(), `flowtask-event-db-test-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("EventStore with DB dual-write", () => {
  let testDir: string;
  let db: DatabaseManager;
  let eventStore: EventStore;

  beforeEach(async () => {
    testDir = makeTestDir();
    db = await DatabaseManager.create(path.join(testDir, "flowtask.db"));
    eventStore = new EventStore(testDir, db);

    const now = new Date().toISOString();
    db.insertRun({
      runId: "run_evt_db",
      projectId: "test-project",
      title: "Event DB Test",
      status: "running",
      mode: "auto",
      taskCount: 0,
      completedTaskCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Insert tasks for FK references
    for (let i = 1; i <= 3; i++) {
      db.insertTask({
        id: `task_evt_00${i}`,
        runId: "run_evt_db",
        title: `Event Task ${i}`,
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("writes event to both JSONL and DB", async () => {
    await eventStore.appendToRun("run_evt_db", {
      type: "task_started",
      runId: "run_evt_db",
      taskId: "task_evt_001",
      message: "Task 1 started",
    });

    const jsonlEvents = await eventStore.readRunEvents("run_evt_db");
    expect(jsonlEvents).toHaveLength(1);
    expect(jsonlEvents[0]!.type).toBe("task_started");

    const dbEvents = eventStore.queryEvents("run_evt_db");
    expect(dbEvents).toHaveLength(1);
    expect(dbEvents[0]!.type).toBe("task_started");
  });

  it("writes multiple events to both stores", async () => {
    for (let i = 1; i <= 3; i++) {
      await eventStore.appendToRun("run_evt_db", {
        type: "task_completed",
        runId: "run_evt_db",
        taskId: `task_evt_00${i}`,
        message: `Task ${i} completed`,
      });
    }

    const jsonlEvents = await eventStore.readRunEvents("run_evt_db");
    expect(jsonlEvents).toHaveLength(3);

    const dbEvents = eventStore.queryEvents("run_evt_db");
    expect(dbEvents).toHaveLength(3);
  });

  it("queries events by type from DB", async () => {
    await eventStore.appendToRun("run_evt_db", { type: "run_started", runId: "run_evt_db" });
    await eventStore.appendToRun("run_evt_db", { type: "task_started", runId: "run_evt_db" });
    await eventStore.appendToRun("run_evt_db", { type: "task_completed", runId: "run_evt_db" });

    const taskEvents = eventStore.queryEvents("run_evt_db", "task_started");
    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0]!.type).toBe("task_started");
  });

  it("gracefully handles missing DB", async () => {
    const localEventStore = new EventStore(testDir);

    await localEventStore.appendToRun("run_evt_db", {
      type: "run_created",
      runId: "run_evt_db",
      message: "Created without DB",
    });

    const jsonlEvents = await localEventStore.readRunEvents("run_evt_db");
    expect(jsonlEvents).toHaveLength(1);
    expect(jsonlEvents[0]!.message).toBe("Created without DB");
  });
});
