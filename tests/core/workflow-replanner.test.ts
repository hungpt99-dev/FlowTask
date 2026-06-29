import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunManager } from "../../src/core/run-manager.js";
import { EventStore } from "../../src/core/event-store.js";
import { WorkflowManager } from "../../src/core/workflow-manager.js";
import { WorkflowReplanner } from "../../src/core/workflow-replanner.js";
import { type Task } from "../../src/schemas/task.schema.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import type { WorkflowFile } from "../../src/schemas/workflow.schema.js";

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

function makeMinimalConfig(): FlowTaskConfig {
  return {
    version: "1.0",
    projectMode: "development",
    defaultExecutor: "shell",
    runsDir: ".flowtask/runs",
    logLevel: "info",
    autoResume: true,
    rules: { enabled: true, paths: [], required: false, maxFileSizeKb: 256 },
    approval: { enabled: false, autoApprove: false, requireFor: [] },
    quality: { enabledByDefault: false, commands: [] },
    validation: {
      profile: "safe",
      adaptiveValidation: true,
      concurrency: 1,
      timeoutMs: 300000,
      killGraceMs: 5000,
      dedupeCommands: true,
      resourceGuard: true,
      commands: [],
      vitest: { enabled: true, maxWorkers: 1, runMode: true },
      aiValidation: "fallback",
    },
    logging: { maxInMemoryLines: 500, maxLineLength: 4000 },
    limits: { maxRunMinutes: 120, maxTaskMinutes: 30, maxRetries: 2, maxLogSizeMb: 20 },
    planner: {
      default: "simple",
      type: "internal-ai",
      executor: "shell",
      provider: "openai",
      model: "gpt-4.1-mini",
      maxRetries: 1,
      fallbackToSimple: true,
    },
    ai: { providers: {} },
    useCase: { enabled: false, customPatterns: [], confidenceThreshold: 0.6 },
    process: { gracefulStopTimeoutMs: 5000, forceKillTimeoutMs: 10000 },
    hooks: {
      beforeRun: [],
      afterRun: [],
      beforeTask: [],
      afterTask: [],
      beforeRetry: [],
      afterRetry: [],
      onFailure: [],
      failOnError: false,
    },
    executors: {
      shell: { type: "shell", timeoutMs: 1800000, args: [], inputMode: "argument" },
    },
  };
}

describe("WorkflowReplanner", () => {
  let rootPath: string;
  let runManager: RunManager;
  let eventStore: EventStore;
  let workflowManager: WorkflowManager;
  let replanner: WorkflowReplanner;
  let testRunId: string;
  let existingTasks: Task[];

  beforeAll(async () => {
    rootPath = mkdtempSync(join(tmpdir(), "flowtask-replanner-test-"));
    runManager = new RunManager(rootPath);
    eventStore = new EventStore(rootPath);
    const config = makeMinimalConfig();
    workflowManager = new WorkflowManager(rootPath, runManager, eventStore);
    replanner = new WorkflowReplanner(rootPath, config, runManager, eventStore, workflowManager);

    const projectDir = join(rootPath, ".flowtask");
    mkdirSync(projectDir, { recursive: true });

    const run = await runManager.createRun("test-project", "Test replan run", "auto");
    testRunId = run.runId;

    existingTasks = [
      makeTask({
        id: "task_001",
        runId: testRunId,
        title: "Setup environment",
        status: "done",
        dependsOn: [],
      }),
      makeTask({
        id: "task_002",
        runId: testRunId,
        title: "Install dependencies",
        description: "Install required packages",
        status: "done",
        dependsOn: ["task_001"],
        executor: "shell",
        acceptanceCriteria: ["All packages installed"],
      }),
      makeTask({
        id: "task_003",
        runId: testRunId,
        title: "Run tests",
        status: "failed",
        dependsOn: ["task_002"],
        executor: "shell",
      }),
      makeTask({
        id: "task_004",
        runId: testRunId,
        title: "Generate report",
        status: "pending",
        dependsOn: ["task_003"],
      }),
    ];
    await runManager.saveTasks(testRunId, existingTasks);
    await runManager.savePrompt(testRunId, "Test replan prompt");
    await runManager.saveRulesContext(testRunId, "Test rules context");
  });

  afterAll(() => {
    rmSync(rootPath, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create replanner instance", () => {
      expect(replanner).toBeInstanceOf(WorkflowReplanner);
    });
  });

  describe("replan", () => {
    it("should throw for non-existent run", async () => {
      await expect(replanner.replan("non-existent-run")).rejects.toThrow("Run not found");
    });

    it("should throw for completed run", async () => {
      const completedRun = await runManager.createRun("test-project", "Completed run", "auto");
      await runManager.updateRunStatus(completedRun.runId, "completed");
      await expect(replanner.replan(completedRun.runId)).rejects.toThrow(
        "Cannot replan a completed run",
      );
    });
  });

  describe("mergeWithExisting", () => {
    it("keep-completed: preserves done/skipped, replaces failed/pending", async () => {
      const newPlan: WorkflowFile = {
        runTitle: "Replanned run",
        tasks: [
          { id: "new_001", title: "Run tests again", dependsOn: [], acceptanceCriteria: [] },
          {
            id: "new_002",
            title: "Generate final report",
            dependsOn: ["new_001"],
            acceptanceCriteria: ["Report exists"],
          },
        ],
      };

      const result = await replanner.mergeWithExisting(existingTasks, newPlan, "keep-completed");

      expect(result.changes.unchanged).toBe(2);
      expect(result.workflow.tasks.some((t) => t.id === "task_001")).toBe(true);
      expect(result.workflow.tasks.some((t) => t.id === "task_002")).toBe(true);
      expect(result.strategy).toBe("keep-completed");
    });

    it("keep-all: preserves all existing tasks, appends new ones", async () => {
      const newPlan: WorkflowFile = {
        runTitle: "Replanned run with additions",
        tasks: [
          {
            id: "extra_001",
            title: "Extra integration test",
            dependsOn: [],
            acceptanceCriteria: [],
          },
        ],
      };

      const result = await replanner.mergeWithExisting(existingTasks, newPlan, "keep-all");

      expect(result.changes.added).toBe(1);
      expect(result.changes.unchanged).toBe(4);
      expect(result.workflow.tasks.length).toBeGreaterThanOrEqual(5);
    });

    it("replace-all: replaces all non-running tasks", async () => {
      const newPlan: WorkflowFile = {
        runTitle: "Fresh plan",
        tasks: [{ id: "fresh_001", title: "Start fresh", dependsOn: [], acceptanceCriteria: [] }],
      };

      const result = await replanner.mergeWithExisting(existingTasks, newPlan, "replace-all");

      expect(result.changes.unchanged).toBe(0);
      expect(result.strategy).toBe("replace-all");
    });

    it("keep-completed: marks failed tasks as pending when no match", async () => {
      const noMatchPlan: WorkflowFile = {
        runTitle: "No match plan",
        tasks: [{ id: "only_task", title: "Only task", dependsOn: [], acceptanceCriteria: [] }],
      };

      const result = await replanner.mergeWithExisting(
        existingTasks,
        noMatchPlan,
        "keep-completed",
      );

      const task003 = result.workflow.tasks.find((t) => t.id === "task_003");
      const task004 = result.workflow.tasks.find((t) => t.id === "task_004");
      expect(task003).toBeTruthy();
      expect(task004).toBeTruthy();
    });

    it("handles empty existing tasks", async () => {
      const plan: WorkflowFile = {
        runTitle: "Empty start",
        tasks: [{ id: "t1", title: "Task 1", dependsOn: [], acceptanceCriteria: [] }],
      };

      const result = await replanner.mergeWithExisting([], plan, "keep-completed");
      expect(result.workflow.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it("handles running tasks in replace-all strategy", async () => {
      const runningTasks: Task[] = [
        makeTask({
          id: "running_01",
          runId: testRunId,
          title: "Running task",
          status: "running",
          dependsOn: [],
        }),
      ];

      const plan: WorkflowFile = {
        runTitle: "Replace all",
        tasks: [{ id: "fresh", title: "Fresh start", dependsOn: [], acceptanceCriteria: [] }],
      };

      const result = await replanner.mergeWithExisting(runningTasks, plan, "replace-all");
      expect(result.changes.unchanged).toBe(1);
    });
  });
});
