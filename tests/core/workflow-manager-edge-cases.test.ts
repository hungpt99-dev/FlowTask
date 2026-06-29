import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunManager } from "../../src/core/run-manager.js";
import { EventStore } from "../../src/core/event-store.js";
import { WorkflowManager } from "../../src/core/workflow-manager.js";
import { type Task } from "../../src/schemas/task.schema.js";

function makeTask(overrides: Partial<Task> & { id: string; runId: string }): Task {
  const now = new Date().toISOString();
  return {
    title: "Test task",
    status: "pending",
    executor: "shell",
    dependsOn: [],
    acceptanceCriteria: [],
    retryCount: 0,
    maxRetries: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("WorkflowManager edge cases", () => {
  let rootPath: string;
  let runManager: RunManager;
  let eventStore: EventStore;
  let workflowManager: WorkflowManager;
  let testRunId: string;

  beforeAll(async () => {
    rootPath = mkdtempSync(join(tmpdir(), "flowtask-wf-edge-"));
    runManager = new RunManager(rootPath);
    eventStore = new EventStore(rootPath);
    workflowManager = new WorkflowManager(rootPath, runManager, eventStore);

    const projectDir = join(rootPath, ".flowtask");
    mkdirSync(projectDir, { recursive: true });

    const run = await runManager.createRun("test-project", "Edge case workflow", "auto");
    testRunId = run.runId;

    const tasks: Task[] = [
      makeTask({
        id: "task_a",
        runId: testRunId,
        title: "Task A",
        status: "done",
        dependsOn: [],
        maxRetries: 2,
      }),
      makeTask({
        id: "task_b",
        runId: testRunId,
        title: "Task B",
        status: "pending",
        dependsOn: ["task_a"],
        executor: "opencode",
        acceptanceCriteria: ["B must pass"],
        maxRetries: 3,
      }),
      makeTask({
        id: "task_c",
        runId: testRunId,
        title: "Task C",
        status: "pending",
        dependsOn: ["task_b"],
      }),
      makeTask({
        id: "task_d",
        runId: testRunId,
        title: "Task D",
        status: "pending",
        dependsOn: ["task_c"],
      }),
    ];
    await runManager.saveTasks(testRunId, tasks);
  });

  afterAll(() => {
    rmSync(rootPath, { recursive: true, force: true });
  });

  describe("reorderTask (single task move)", () => {
    let reorderRunId: string;

    beforeAll(async () => {
      const run = await runManager.createRun("test-project", "Reorder test", "auto");
      reorderRunId = run.runId;
      // Independent tasks with no dependencies - any order is valid
      await runManager.saveTasks(reorderRunId, [
        makeTask({ id: "r_a", runId: reorderRunId, title: "Alpha", dependsOn: [] }),
        makeTask({ id: "r_b", runId: reorderRunId, title: "Beta", dependsOn: [] }),
        makeTask({ id: "r_c", runId: reorderRunId, title: "Gamma", dependsOn: [] }),
      ]);
    });

    it("should move a task to a new position", async () => {
      await workflowManager.reorderTask(reorderRunId, "r_c", 0);

      const tasks = await runManager.loadTasks(reorderRunId);
      expect(tasks[0]!.id).toBe("r_c");
      expect(tasks[1]!.id).toBe("r_a");
      expect(tasks[2]!.id).toBe("r_b");
    });

    it("should throw when moving to invalid position (dependency after dependent)", async () => {
      const run = await runManager.createRun("test-project", "Reorder dep test", "auto");
      await runManager.saveTasks(run.runId, [
        makeTask({ id: "d_a", runId: run.runId, title: "Parent", dependsOn: [] }),
        makeTask({ id: "d_b", runId: run.runId, title: "Child", dependsOn: ["d_a"] }),
      ]);
      // Moving parent after child violates ordering
      await expect(workflowManager.reorderTask(run.runId, "d_a", 1)).rejects.toThrow(
        /Invalid ordering/,
      );
    });

    it("should throw for non-existent task", async () => {
      await expect(workflowManager.reorderTask(testRunId, "nonexistent", 0)).rejects.toThrow(
        "Task not found",
      );
    });
  });

  describe("saveSnapshot", () => {
    it("should save a workflow snapshot to disk", async () => {
      const snapPath = await workflowManager.saveSnapshot(testRunId);
      expect(snapPath).toBeTruthy();
      expect(existsSync(snapPath)).toBe(true);
      const content = await import("node:fs").then((fs) => fs.readFileSync(snapPath, "utf-8"));
      expect(content).toContain("task_a");
    });
  });

  describe("validateWorkflow edge cases", () => {
    it("should warn about running tasks when tasks are provided", async () => {
      // Change task_b to running
      await runManager.updateTaskStatus(testRunId, "task_b", "running");
      const currentTasks = await runManager.loadTasks(testRunId);

      const { workflow } = await workflowManager.exportWorkflow(testRunId);
      const result = workflowManager.validateWorkflow(workflow, currentTasks);
      expect(result.warnings.some((w) => w.includes("currently running"))).toBe(true);

      // Restore
      await runManager.updateTaskStatus(testRunId, "task_b", "pending");
    });

    it("should fail on empty task list", () => {
      const result = workflowManager.validateWorkflow({
        runTitle: "Empty",
        tasks: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("at least one task"))).toBe(true);
    });

    it("should detect orphans", () => {
      const result = workflowManager.validateWorkflow({
        runTitle: "Orphan test",
        tasks: [
          { id: "t1", title: "Root", dependsOn: [], acceptanceCriteria: [] },
          { id: "t2", title: "Orphan", dependsOn: [], acceptanceCriteria: [] },
        ],
      });
      // Both have no deps, so neither is an orphan - they're both roots
      expect(result.orphans).toHaveLength(0);
    });

    it("should detect orphans not reachable from root tasks", () => {
      const result = workflowManager.validateWorkflow({
        runTitle: "Graph test",
        tasks: [
          { id: "t1", title: "Root", dependsOn: [], acceptanceCriteria: [] },
          { id: "t2", title: "Depends on t1", dependsOn: ["t1"], acceptanceCriteria: [] },
          { id: "t3", title: "Orphan", dependsOn: ["t1", "t2"], acceptanceCriteria: [] },
        ],
      });
      // Orphans are tasks not reachable following dependency chains from roots
      // t2 and t3 are orphans because we can't traverse forward from t1
      expect(result.orphans).toHaveLength(2);
    });
  });

  describe("applyWorkflow edge cases", () => {
    it("should perform dry run without applying", async () => {
      const workflow = {
        runTitle: "Dry run test",
        tasks: [
          { id: "task_a", title: "Task A", dependsOn: [], acceptanceCriteria: [] },
          { id: "task_b", title: "Task B", dependsOn: ["task_a"], acceptanceCriteria: [] },
          { id: "task_c", title: "Task C", dependsOn: ["task_b"], acceptanceCriteria: [] },
          { id: "task_d", title: "Task D", dependsOn: ["task_c"], acceptanceCriteria: [] },
          { id: "task_e", title: "Task E", dependsOn: ["task_d"], acceptanceCriteria: [] },
        ],
      };

      const result = await workflowManager.applyWorkflow(testRunId, workflow, { dryRun: true });
      expect(result.applied).toBe(false);
    });

    it("should warn when modifying non-modifiable task", async () => {
      // task_a is "done" - not modifiable without force
      const workflow = {
        runTitle: "Modify locked task",
        tasks: [
          { id: "task_a", title: "Task A Modified", dependsOn: [], acceptanceCriteria: [] },
          { id: "task_b", title: "Task B", dependsOn: ["task_a"], acceptanceCriteria: [] },
          { id: "task_c", title: "Task C", dependsOn: ["task_b"], acceptanceCriteria: [] },
          { id: "task_d", title: "Task D", dependsOn: ["task_c"], acceptanceCriteria: [] },
        ],
      };

      const result = await workflowManager.applyWorkflow(testRunId, workflow, { noConfirm: true });
      expect(result.warnings.some((w) => w.includes("Cannot modify"))).toBe(true);
    });

    it("should force modify a locked task with --force", async () => {
      const workflow = {
        runTitle: "Force modify",
        tasks: [
          { id: "task_a", title: "Task A Forced", dependsOn: [], acceptanceCriteria: [] },
          { id: "task_b", title: "Task B", dependsOn: ["task_a"], acceptanceCriteria: [] },
          { id: "task_c", title: "Task C", dependsOn: ["task_b"], acceptanceCriteria: [] },
          { id: "task_d", title: "Task D", dependsOn: ["task_c"], acceptanceCriteria: [] },
        ],
      };

      const result = await workflowManager.applyWorkflow(testRunId, workflow, {
        force: true,
        noConfirm: true,
      });
      expect(result.applied).toBe(true);
      expect(result.modified).toBeGreaterThanOrEqual(1);

      const tasks = await runManager.loadTasks(testRunId);
      const taskA = tasks.find((t) => t.id === "task_a");
      expect(taskA!.title).toBe("Task A Forced");
    });
  });

  describe("buildDiff edge cases", () => {
    it("should return unchanged for identical workflow", async () => {
      const { workflow } = await workflowManager.exportWorkflow(testRunId);
      const diff = await workflowManager.buildDiff(testRunId, workflow);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
    });

    it("should detect title changes in diff", async () => {
      // Create a fresh run with simple tasks to avoid state contamination
      const freshRun = await runManager.createRun("test-project", "Diff fresh run", "auto");
      await runManager.saveTasks(freshRun.runId, [
        makeTask({ id: "x_a", runId: freshRun.runId, title: "Original title", dependsOn: [] }),
        makeTask({ id: "x_b", runId: freshRun.runId, title: "Unchanged", dependsOn: ["x_a"] }),
      ]);

      const workflow = {
        runTitle: "Diff title change",
        tasks: [
          { id: "x_a", title: "Changed Title", dependsOn: [], acceptanceCriteria: [] },
          { id: "x_b", title: "Unchanged", dependsOn: ["x_a"], acceptanceCriteria: [] },
        ],
      };

      const diff = await workflowManager.buildDiff(freshRun.runId, workflow);
      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0]!.title).toBeDefined();
      expect(diff.modified[0]!.title!.new).toBe("Changed Title");
    });
  });

  describe("addTask edge cases", () => {
    it("should add task with full definition", async () => {
      const task = await workflowManager.addTask(testRunId, {
        title: "Full task",
        description: "A fully defined task",
        executor: "opencode",
        dependsOn: ["task_a"],
        acceptanceCriteria: ["AC1", "AC2"],
        maxRetries: 5,
      });

      expect(task.title).toBe("Full task");
      expect(task.description).toBe("A fully defined task");
      expect(task.executor).toBe("opencode");
      expect(task.dependsOn).toEqual(["task_a"]);
      expect(task.acceptanceCriteria).toEqual(["AC1", "AC2"]);
      expect(task.maxRetries).toBe(5);
    });

    it("should add task with default values when minimal definition", async () => {
      const task = await workflowManager.addTask(testRunId, {});
      expect(task.title).toBe("New task");
      expect(task.executor).toBe("shell");
      expect(task.maxRetries).toBe(2);
    });

    it("should add task after a specific task", async () => {
      const task = await workflowManager.addTask(
        testRunId,
        { title: "After A" },
        { after: "task_a" },
      );

      const tasks = await runManager.loadTasks(testRunId);
      const idx = tasks.findIndex((t) => t.id === task.id);
      expect(tasks[idx - 1]!.id).toBe("task_a");
    });

    it("should add to end when after task does not exist", async () => {
      const task = await workflowManager.addTask(
        testRunId,
        { title: "After Nonexistent" },
        { after: "nonexistent" },
      );

      const tasks = await runManager.loadTasks(testRunId);
      expect(tasks[tasks.length - 1]!.id).toBe(task.id);
    });
  });

  describe("removeTask edge cases", () => {
    it("should throw when removing non-existent task", async () => {
      await expect(workflowManager.removeTask(testRunId, "nonexistent")).rejects.toThrow(
        "Task not found",
      );
    });

    it("should handle force removal without delete option", async () => {
      const t1 = await workflowManager.addTask(testRunId, { title: "Dep target" });
      const t2 = await workflowManager.addTask(testRunId, {
        title: "Dependent",
        dependsOn: [t1.id],
      });

      // Force remove t1 (should clear deps from t2)
      await workflowManager.removeTask(testRunId, t1.id, { force: true });

      const tasks = await runManager.loadTasks(testRunId);
      const depTask = tasks.find((t) => t.id === t2.id);
      expect(depTask!.dependsOn).not.toContain(t1.id);
    });
  });

  describe("exportWorkflow edge cases", () => {
    it("should export with validation config", async () => {
      const run = await runManager.createRun("test-project", "Validation task", "auto");
      await runManager.saveTasks(run.runId, [
        makeTask({
          id: "task_val",
          runId: run.runId,
          title: "Validated task",
          status: "pending",
          validation: {
            commands: ["npm test"],
            requireGitDiff: true,
          },
        }),
      ]);

      const { workflow, yaml, json } = await workflowManager.exportWorkflow(run.runId);
      expect(workflow.tasks[0]!.validation).toBeDefined();
      expect(workflow.tasks[0]!.validation!.commands).toContain("npm test");
      expect(yaml).toContain("requireGitDiff");
      expect(json).toContain("requireGitDiff");
    });

    it("should produce valid JSON output", async () => {
      const { json } = await workflowManager.exportWorkflow(testRunId);
      const parsed = JSON.parse(json);
      expect(parsed.tasks).toBeDefined();
      expect(Array.isArray(parsed.tasks)).toBe(true);
    });
  });

  describe("loadWorkflowFromFile edge cases", () => {
    it("should reject invalid YAML", async () => {
      const filePath = join(rootPath, "bad.yaml");
      writeFileSync(filePath, "invalid: [unclosed", "utf-8");
      await expect(workflowManager.loadWorkflowFromFile(filePath)).rejects.toThrow();
    });

    it("should reject valid YAML but invalid workflow schema", async () => {
      const filePath = join(rootPath, "bad-schema.yaml");
      writeFileSync(filePath, "runTitle: Test\ntasks: invalid", "utf-8");
      await expect(workflowManager.loadWorkflowFromFile(filePath)).rejects.toThrow();
    });

    it("should handle .json extension", async () => {
      const filePath = join(rootPath, "workflow.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          runTitle: "JSON workflow",
          tasks: [{ id: "t1", title: "Task 1", dependsOn: [] }],
        }),
        "utf-8",
      );
      const workflow = await workflowManager.loadWorkflowFromFile(filePath);
      expect(workflow.tasks).toHaveLength(1);
    });
  });
});
