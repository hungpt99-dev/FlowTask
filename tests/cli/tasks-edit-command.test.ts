import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { tasksEditCommand } from "../../src/cli/commands/tasks-edit.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("tasksEditCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `tasks-edit-cmd-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
    process.stdin.isTTY = false as unknown as boolean;

    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    output = "";
    const originalLog = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    await initCommand({ name: "TasksEditTest" });

    console.log = originalLog;
    output = "";
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Edit test", "auto");
    runId = run.runId;

    await runManager.saveTasks(runId, [
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
        id: "task_done_001",
        runId,
        title: "Done task",
        description: "Cannot edit this",
        status: "done" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should update task title", async () => {
    await tasksEditCommand("task_edit_001", { run: runId, title: "Updated title" });

    expect(output).toContain("Task task_edit_001 updated");
    expect(output).toContain("Updated title");

    const tasks = await runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === "task_edit_001");
    expect(task!.title).toBe("Updated title");
  });

  it("should update task description", async () => {
    await tasksEditCommand("task_edit_001", { run: runId, description: "New description" });

    expect(output).toContain("Task task_edit_001 updated");
    expect(output).toContain("New description");
  });

  it("should update task executor", async () => {
    await tasksEditCommand("task_edit_001", { run: runId, executor: "opencode" });

    expect(output).toContain("Task task_edit_001 updated");
    expect(output).toContain("opencode");
  });

  it("should update acceptance criteria from pipe-separated string", async () => {
    await tasksEditCommand("task_edit_001", {
      run: runId,
      "acceptance-criteria": "AC1|AC2|AC3",
    });

    const tasks = await runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === "task_edit_001");
    expect(task!.acceptanceCriteria).toEqual(["AC1", "AC2", "AC3"]);
  });

  it("should update validation commands from pipe-separated string", async () => {
    await tasksEditCommand("task_edit_001", {
      run: runId,
      "validation-commands": "pnpm test|pnpm lint",
    });

    const tasks = await runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === "task_edit_001");
    expect(task!.validation?.commands).toEqual(["pnpm test", "pnpm lint"]);
  });

  it("should update required files from pipe-separated string", async () => {
    await tasksEditCommand("task_edit_001", {
      run: runId,
      "required-files": "dist/index.js|dist/types.d.ts",
    });

    const tasks = await runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === "task_edit_001");
    expect(task!.validation?.requiredFiles).toEqual(["dist/index.js", "dist/types.d.ts"]);
  });

  it("should fail when editing a done task", async () => {
    try {
      await tasksEditCommand("task_done_001", { run: runId, title: "New title" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
  });

  it("should fail when no changes specified", async () => {
    try {
      await tasksEditCommand("task_edit_001", { run: runId });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
  });

  it("should fail for non-existent task", async () => {
    try {
      await tasksEditCommand("nonexistent", { run: runId, title: "New" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
  });

  it("should update all fields at once", async () => {
    await tasksEditCommand("task_edit_001", {
      run: runId,
      title: "Full update",
      description: "Full description",
      executor: "manual",
      "acceptance-criteria": "AC1|AC2",
      "validation-commands": "npm test",
      "required-files": "dist/index.js",
    });

    const tasks = await runManager.loadTasks(runId);
    const task = tasks.find((t) => t.id === "task_edit_001");
    expect(task!.title).toBe("Full update");
    expect(task!.description).toBe("Full description");
    expect(task!.executor).toBe("manual");
    expect(task!.acceptanceCriteria).toEqual(["AC1", "AC2"]);
    expect(task!.validation?.commands).toEqual(["npm test"]);
    expect(task!.validation?.requiredFiles).toEqual(["dist/index.js"]);
  });

  it("should persist edits to disk", async () => {
    await tasksEditCommand("task_edit_001", {
      run: runId,
      title: "Persisted title",
    });

    const loaded = await runManager.loadTasks(runId);
    const task = loaded.find((t) => t.id === "task_edit_001");
    expect(task!.title).toBe("Persisted title");
  });
});
