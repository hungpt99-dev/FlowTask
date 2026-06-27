import { describe, it, expect, beforeAll } from "vitest";
import { RunManager } from "../../src/core/run-manager.js";
import { testDir } from "../setup.js";

describe("RunManager", () => {
  let manager: RunManager;

  beforeAll(() => {
    manager = new RunManager(testDir);
  });

  it("should create a run with correct structure", async () => {
    const run = await manager.createRun("test-project", "Test implementation", "auto");
    expect(run.runId).toBeTruthy();
    expect(run.projectId).toBe("test-project");
    expect(run.title).toBe("Test implementation");
    expect(run.status).toBe("created");
    expect(run.mode).toBe("auto");
  });

  it("should load a created run", async () => {
    const run = await manager.createRun("test-project", "Load test", "auto");
    const loaded = await manager.loadRun(run.runId);
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe(run.runId);
    expect(loaded!.title).toBe("Load test");
  });

  it("should return null for non-existent run", async () => {
    const loaded = await manager.loadRun("non-existent-run-id");
    expect(loaded).toBeNull();
  });

  it("should save and update a run", async () => {
    const run = await manager.createRun("test-project", "Update test", "auto");
    const updated = { ...run, status: "running" as const, updatedAt: new Date().toISOString() };
    await manager.saveRun(updated);
    const loaded = await manager.loadRun(run.runId);
    expect(loaded!.status).toBe("running");
  });

  it("should save and load tasks", async () => {
    const run = await manager.createRun("test-project", "Task test", "auto");
    const tasks = [
      {
        id: "task_001",
        runId: run.runId,
        title: "First task",
        status: "pending" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    await manager.saveTasks(run.runId, tasks);
    const loaded = await manager.loadTasks(run.runId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.title).toBe("First task");
  });

  it("should update a task with partial fields", async () => {
    const run = await manager.createRun("test-project", "Update task test", "auto");
    const tasks = [
      {
        id: "task_001",
        runId: run.runId,
        title: "Original title",
        status: "pending" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    await manager.saveTasks(run.runId, tasks);

    const updated = await manager.updateTask(run.runId, "task_001", {
      title: "Updated title",
      description: "New description",
      executor: "opencode",
      acceptanceCriteria: ["AC1", "AC2"],
    });

    expect(updated.title).toBe("Updated title");
    expect(updated.description).toBe("New description");
    expect(updated.executor).toBe("opencode");
    expect(updated.acceptanceCriteria).toEqual(["AC1", "AC2"]);

    const loaded = await manager.loadTasks(run.runId);
    expect(loaded[0]!.title).toBe("Updated title");
    expect(loaded[0]!.description).toBe("New description");
  });

  it("should throw when updating a non-existent task", async () => {
    const run = await manager.createRun("test-project", "Update non-existent", "auto");
    await expect(manager.updateTask(run.runId, "nonexistent", { title: "New" })).rejects.toThrow(
      "Task not found",
    );
  });

  it("should get next pending task", async () => {
    const run = await manager.createRun("test-project", "Next task test", "auto");
    const tasks = [
      {
        id: "task_001",
        runId: run.runId,
        title: "Task one",
        status: "done" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task_002",
        runId: run.runId,
        title: "Task two",
        status: "pending" as const,
        executor: "shell",
        dependsOn: ["task_001"],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    await manager.saveTasks(run.runId, tasks);
    const loaded = await manager.loadTasks(run.runId);
    const next = manager.getNextTask(loaded);
    expect(next).not.toBeNull();
    expect(next!.title).toBe("Task two");
  });
});
