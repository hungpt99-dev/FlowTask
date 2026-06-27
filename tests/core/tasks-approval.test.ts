import { describe, it, expect, beforeAll } from "vitest";
import { ProjectManager } from "../../src/core/project-manager.js";
import { RunManager } from "../../src/core/run-manager.js";
import { RunLifecycle } from "../../src/core/run-lifecycle.js";
import { testDir } from "../setup.js";
import { join } from "node:path";

describe("Task Approval and Denial", () => {
  let projectDir: string;
  let projectId: string;
  let runId: string;
  let runManager: RunManager;

  beforeAll(async () => {
    projectDir = join(testDir, "tasks-approval-test");
    const manager = new ProjectManager();
    const project = await manager.init(projectDir, "Tasks Approval Test");
    projectId = project.projectId;
    runManager = new RunManager(projectDir);
    const run = await runManager.createRun(projectId, "Approval test run", "manual");
    runId = run.runId;
    await runManager.savePrompt(runId, "test prompt");

    const tasks = [
      {
        id: "task_app_001",
        runId,
        title: "Task awaiting approval",
        status: "waiting_approval" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task_app_002",
        runId,
        title: "Pending task",
        status: "pending" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task_app_003",
        runId,
        title: "Done task",
        status: "done" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    await runManager.saveTasks(runId, tasks);
  });

  it("should approve a waiting_approval task (set to pending)", async () => {
    const updated = await runManager.updateTaskStatus(runId, "task_app_001", "pending");
    expect(updated.status).toBe("pending");
    expect(updated.id).toBe("task_app_001");
  });

  it("should deny a waiting_approval task (set to skipped)", async () => {
    const statusCheck = await runManager.loadTasks(runId);
    const task = statusCheck.find((t) => t.id === "task_app_001");
    expect(task).toBeDefined();
    if (task) {
      const denied = await runManager.updateTaskStatus(runId, task.id, "skipped");
      expect(denied.status).toBe("skipped");
    }
  });

  it("should throw when approving a non-existent task", async () => {
    await expect(runManager.updateTaskStatus(runId, "nonexistent", "pending")).rejects.toThrow(
      "Task not found",
    );
  });

  it("should throw when denying a non-existent task", async () => {
    await expect(runManager.updateTaskStatus(runId, "nonexistent", "skipped")).rejects.toThrow(
      "Task not found",
    );
  });

  it("should persist approve status change to disk", async () => {
    const loaded = await runManager.loadTasks(runId);
    const task = loaded.find((t) => t.id === "task_app_002");
    expect(task).toBeDefined();
    expect(task!.status).toBe("pending");

    await runManager.updateTaskStatus(runId, "task_app_002", "waiting_approval");
    const reloaded = await runManager.loadTasks(runId);
    const updated = reloaded.find((t) => t.id === "task_app_002");
    expect(updated!.status).toBe("waiting_approval");

    await runManager.updateTaskStatus(runId, "task_app_002", "pending");
    const final = await runManager.loadTasks(runId);
    const approved = final.find((t) => t.id === "task_app_002");
    expect(approved!.status).toBe("pending");
  });

  it("should persist deny status change to disk", async () => {
    await runManager.updateTaskStatus(runId, "task_app_002", "waiting_approval");
    await runManager.updateTaskStatus(runId, "task_app_002", "skipped");

    const loaded = await runManager.loadTasks(runId);
    const task = loaded.find((t) => t.id === "task_app_002");
    expect(task!.status).toBe("skipped");
  });

  it("should allow status transitions from waiting_approval to pending", async () => {
    const { TaskStatusSchema } = await import("../../src/schemas/task.schema.js");
    const pending = TaskStatusSchema.parse("pending");
    expect(pending).toBe("pending");
  });

  it("should allow status transitions from waiting_approval to skipped", async () => {
    const { TaskStatusSchema } = await import("../../src/schemas/task.schema.js");
    const skipped = TaskStatusSchema.parse("skipped");
    expect(skipped).toBe("skipped");
  });
});

describe("Approval Flow via RunLifecycle", () => {
  let projectDir: string;
  let projectId: string;
  let runManager: RunManager;

  beforeAll(async () => {
    projectDir = join(testDir, "tasks-approval-lifecycle-test");
    const manager = new ProjectManager();
    const project = await manager.init(projectDir, "Approval Lifecycle Test");
    projectId = project.projectId;
    runManager = new RunManager(projectDir);
  });

  it("should not execute waiting_approval tasks on continueRun", async () => {
    const run = await runManager.createRun(projectId, "Manual run", "manual");
    await runManager.savePrompt(run.runId, "test prompt");

    const tasks = [
      {
        id: "task_waiting",
        runId: run.runId,
        title: "Waiting for approval",
        status: "waiting_approval" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    await runManager.saveTasks(run.runId, tasks);

    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.continueRun(run.runId);

    expect(result.paused).toBe(false);
    expect(result.success).toBe(true);

    const loaded = await runManager.loadTasks(run.runId);
    const task = loaded.find((t) => t.id === "task_waiting");
    expect(task!.status).toBe("waiting_approval");
  });

  it("should execute pending tasks after approval", async () => {
    const run = await runManager.createRun(projectId, "Approve then run", "auto");
    await runManager.savePrompt(run.runId, "test prompt");

    const tasks = [
      {
        id: "task_approved",
        runId: run.runId,
        title: "Approved task",
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
    await runManager.saveTasks(run.runId, tasks);

    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.continueRun(run.runId);

    expect(result.paused).toBe(false);

    const loaded = await runManager.loadTasks(run.runId);
    const task = loaded.find((t) => t.id === "task_approved");
    expect(task).toBeDefined();
    expect(task!.status).not.toBe("waiting_approval");
  });
});
