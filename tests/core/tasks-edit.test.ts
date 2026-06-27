import { describe, it, expect, beforeAll } from "vitest";
import { ProjectManager } from "../../src/core/project-manager.js";
import { RunManager } from "../../src/core/run-manager.js";
import { testDir } from "../setup.js";
import { join } from "node:path";

describe("Task Editing (updateTask)", () => {
  let projectDir: string;
  let projectId: string;
  let runId: string;
  let runManager: RunManager;

  beforeAll(async () => {
    projectDir = join(testDir, "tasks-edit-test");
    const manager = new ProjectManager();
    const project = await manager.init(projectDir, "Tasks Edit Test");
    projectId = project.projectId;
    runManager = new RunManager(projectDir);
    const run = await runManager.createRun(projectId, "Edit test run", "auto");
    runId = run.runId;
    await runManager.savePrompt(runId, "test prompt");

    const tasks = [
      {
        id: "task_edit_001",
        runId,
        title: "Original title",
        description: "Original description",
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
        id: "task_edit_002",
        runId,
        title: "Task with validation",
        description: "Has validation config",
        status: "pending" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["AC1", "AC2"],
        validation: {
          commands: ["pnpm lint"],
          requiredFiles: ["dist/index.js"],
        },
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    await runManager.saveTasks(runId, tasks);
  });

  it("should update task title", async () => {
    const updated = await runManager.updateTask(runId, "task_edit_001", {
      title: "Updated title",
    });
    expect(updated.title).toBe("Updated title");
    expect(updated.description).toBe("Original description");
  });

  it("should update task description", async () => {
    const updated = await runManager.updateTask(runId, "task_edit_001", {
      description: "New description",
    });
    expect(updated.description).toBe("New description");
  });

  it("should update task executor", async () => {
    const updated = await runManager.updateTask(runId, "task_edit_001", {
      executor: "opencode",
    });
    expect(updated.executor).toBe("opencode");
  });

  it("should update acceptance criteria", async () => {
    const updated = await runManager.updateTask(runId, "task_edit_001", {
      acceptanceCriteria: ["Criterion A", "Criterion B", "Criterion C"],
    });
    expect(updated.acceptanceCriteria).toEqual(["Criterion A", "Criterion B", "Criterion C"]);
  });

  it("should update validation commands and required files", async () => {
    const updated = await runManager.updateTask(runId, "task_edit_001", {
      validation: {
        commands: ["pnpm typecheck", "pnpm lint"],
        requiredFiles: ["dist/index.js", "dist/types.d.ts"],
      },
    });
    expect(updated.validation?.commands).toEqual(["pnpm typecheck", "pnpm lint"]);
    expect(updated.validation?.requiredFiles).toEqual(["dist/index.js", "dist/types.d.ts"]);
  });

  it("should update all fields at once", async () => {
    const updated = await runManager.updateTask(runId, "task_edit_001", {
      title: "Full update title",
      description: "Full update description",
      executor: "manual",
      acceptanceCriteria: ["New AC"],
      validation: {
        commands: ["npm test"],
        requiredFiles: ["coverage/lcov.info"],
      },
    });
    expect(updated.title).toBe("Full update title");
    expect(updated.description).toBe("Full update description");
    expect(updated.executor).toBe("manual");
    expect(updated.acceptanceCriteria).toEqual(["New AC"]);
    expect(updated.validation?.commands).toEqual(["npm test"]);
    expect(updated.validation?.requiredFiles).toEqual(["coverage/lcov.info"]);
  });

  it("should preserve unmodified fields when updating", async () => {
    const updated = await runManager.updateTask(runId, "task_edit_002", {
      title: "Only title changed",
    });
    expect(updated.title).toBe("Only title changed");
    expect(updated.description).toBe("Has validation config");
    expect(updated.acceptanceCriteria).toEqual(["AC1", "AC2"]);
    expect(updated.validation?.commands).toEqual(["pnpm lint"]);
    expect(updated.validation?.requiredFiles).toEqual(["dist/index.js"]);
  });

  it("should persist edits to disk", async () => {
    await runManager.updateTask(runId, "task_edit_002", {
      title: "Persisted title",
      description: "Persisted description",
    });
    const loaded = await runManager.loadTasks(runId);
    const task = loaded.find((t) => t.id === "task_edit_002");
    expect(task).toBeDefined();
    expect(task!.title).toBe("Persisted title");
    expect(task!.description).toBe("Persisted description");
  });

  it("should throw when updating a non-existent task", async () => {
    await expect(
      runManager.updateTask(runId, "nonexistent_task", { title: "New" }),
    ).rejects.toThrow("Task not found");
  });

  it("should update task with empty acceptance criteria", async () => {
    const updated = await runManager.updateTask(runId, "task_edit_002", {
      acceptanceCriteria: [],
    });
    expect(updated.acceptanceCriteria).toEqual([]);
  });

  it("should update validation to undefined", async () => {
    const updated = await runManager.updateTask(runId, "task_edit_002", {
      validation: undefined,
    });
    expect(updated.validation).toBeUndefined();
  });
});
