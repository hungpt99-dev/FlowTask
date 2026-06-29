import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
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

describe("WorkflowManager", () => {
  let rootPath: string;
  let runManager: RunManager;
  let eventStore: EventStore;
  let workflowManager: WorkflowManager;
  let testRunId: string;

  beforeAll(async () => {
    rootPath = mkdtempSync(join(tmpdir(), "flowtask-test-"));
    runManager = new RunManager(rootPath);
    eventStore = new EventStore(rootPath);
    workflowManager = new WorkflowManager(rootPath, runManager, eventStore);

    const projectDir = join(rootPath, ".flowtask");
    mkdirSync(projectDir, { recursive: true });

    const run = await runManager.createRun("test-project", "Test workflow run", "auto");
    testRunId = run.runId;

    const tasks: Task[] = [
      makeTask({
        id: "task_001",
        runId: testRunId,
        title: "Setup environment",
        status: "done",
        dependsOn: [],
        maxRetries: 2,
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
        maxRetries: 2,
      }),
      makeTask({
        id: "task_003",
        runId: testRunId,
        title: "Run tests",
        status: "pending",
        dependsOn: ["task_002"],
        executor: "opencode",
        maxRetries: 3,
      }),
      makeTask({
        id: "task_004",
        runId: testRunId,
        title: "Generate report",
        status: "pending",
        dependsOn: ["task_003"],
      }),
    ];
    await runManager.saveTasks(testRunId, tasks);
  });

  afterAll(() => {
    rmSync(rootPath, { recursive: true, force: true });
  });

  describe("exportWorkflow", () => {
    it("should export all tasks as workflow file", async () => {
      const { workflow, yaml } = await workflowManager.exportWorkflow(testRunId);
      expect(workflow.tasks).toHaveLength(4);
      expect(workflow.runTitle).toBe("Test workflow run");
      expect(workflow.tasks[0]!.id).toBe("task_001");
      expect(workflow.tasks[0]!.title).toBe("Setup environment");
      expect(yaml).toContain("task_001");
      expect(yaml).toContain("Setup environment");
    });

    it("should skip completed tasks when requested", async () => {
      const { workflow } = await workflowManager.exportWorkflow(testRunId, { skipCompleted: true });
      expect(workflow.tasks).toHaveLength(2);
      expect(workflow.tasks.every((t) => t.id === "task_003" || t.id === "task_004")).toBe(true);
    });

    it("should handle empty task list", async () => {
      const emptyRun = await runManager.createRun("test-project", "Empty run", "auto");
      const { workflow } = await workflowManager.exportWorkflow(emptyRun.runId);
      expect(workflow.tasks).toHaveLength(0);
    });
  });

  describe("validateWorkflow", () => {
    it("should pass valid workflow", async () => {
      const { workflow } = await workflowManager.exportWorkflow(testRunId);
      const result = workflowManager.validateWorkflow(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.cycles).toHaveLength(0);
      expect(result.deadRefs).toHaveLength(0);
    });

    it("should detect duplicates", () => {
      const workflow = {
        runTitle: "Test",
        tasks: [
          { id: "task_001", title: "Task 1", dependsOn: [], acceptanceCriteria: [] },
          { id: "task_001", title: "Task 1 again", dependsOn: [], acceptanceCriteria: [] },
        ],
      } as never;
      const result = workflowManager.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Duplicate"))).toBe(true);
    });

    it("should detect dead references", () => {
      const workflow = {
        runTitle: "Test",
        tasks: [
          { id: "task_001", title: "Task 1", dependsOn: ["task_999"], acceptanceCriteria: [] },
        ],
      } as never;
      const result = workflowManager.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.deadRefs).toHaveLength(1);
    });

    it("should detect cycles", () => {
      const workflow = {
        runTitle: "Test",
        tasks: [
          { id: "task_001", title: "Task 1", dependsOn: ["task_003"], acceptanceCriteria: [] },
          { id: "task_002", title: "Task 2", dependsOn: ["task_001"], acceptanceCriteria: [] },
          { id: "task_003", title: "Task 3", dependsOn: ["task_002"], acceptanceCriteria: [] },
        ],
      } as never;
      const result = workflowManager.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
    });
  });

  describe("buildDiff", () => {
    it("should detect added tasks", async () => {
      const workflow = {
        runTitle: "Test",
        tasks: [
          { id: "task_001", title: "Setup environment", dependsOn: [], acceptanceCriteria: [] },
          {
            id: "task_002",
            title: "Install dependencies",
            dependsOn: ["task_001"],
            acceptanceCriteria: [],
          },
          { id: "task_003", title: "Run tests", dependsOn: ["task_002"], acceptanceCriteria: [] },
          {
            id: "task_004",
            title: "Generate report",
            dependsOn: ["task_003"],
            acceptanceCriteria: [],
          },
          { id: "task_005", title: "Deploy", dependsOn: ["task_004"], acceptanceCriteria: [] },
        ],
      };
      const diff = await workflowManager.buildDiff(testRunId, workflow);
      expect(diff.added).toHaveLength(1);
      expect(diff.added[0]!.id).toBe("task_005");
    });

    it("should detect removed tasks", async () => {
      const workflow = {
        runTitle: "Test",
        tasks: [
          { id: "task_001", title: "Setup environment", dependsOn: [], acceptanceCriteria: [] },
          {
            id: "task_002",
            title: "Install dependencies",
            dependsOn: ["task_001"],
            acceptanceCriteria: [],
          },
          { id: "task_003", title: "Run tests", dependsOn: ["task_002"], acceptanceCriteria: [] },
        ],
      };
      const diff = await workflowManager.buildDiff(testRunId, workflow);
      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0]!.id).toBe("task_004");
    });

    it("should detect modified tasks", async () => {
      const workflow = {
        runTitle: "Test",
        tasks: [
          { id: "task_001", title: "Setup environment", dependsOn: [], acceptanceCriteria: [] },
          {
            id: "task_002",
            title: "Install dependencies",
            description: "Install required packages",
            dependsOn: ["task_001"],
            acceptanceCriteria: ["All packages installed"],
          },
          {
            id: "task_003",
            title: "Run all tests",
            dependsOn: ["task_002"],
            acceptanceCriteria: [],
          },
          {
            id: "task_004",
            title: "Generate report",
            dependsOn: ["task_003"],
            acceptanceCriteria: [],
          },
        ],
      };
      const diff = await workflowManager.buildDiff(testRunId, workflow);
      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0]!.id).toBe("task_003");
      expect(diff.modified[0]!.changes.some((c) => c.includes("Run tests"))).toBe(true);
    });
  });

  describe("applyWorkflow", () => {
    it("should apply additions", async () => {
      const workflow = {
        runTitle: "Test",
        tasks: [
          { id: "task_001", title: "Setup environment", dependsOn: [], acceptanceCriteria: [] },
          {
            id: "task_002",
            title: "Install dependencies",
            description: "Install required packages",
            dependsOn: ["task_001"],
            acceptanceCriteria: ["All packages installed"],
          },
          { id: "task_003", title: "Run tests", dependsOn: ["task_002"], acceptanceCriteria: [] },
          {
            id: "task_004",
            title: "Generate report",
            dependsOn: ["task_003"],
            acceptanceCriteria: [],
          },
          { id: "task_005", title: "Deploy", dependsOn: ["task_004"], acceptanceCriteria: [] },
        ],
      };

      const result = await workflowManager.applyWorkflow(testRunId, workflow, { noConfirm: true });
      expect(result.applied).toBe(true);
      expect(result.added).toBe(1);
      expect(result.snapshotPath).toBeTruthy();

      const tasks = await runManager.loadTasks(testRunId);
      expect(tasks).toHaveLength(5);
      expect(tasks.some((t) => t.id === "task_005")).toBe(true);
    });

    it("should remove tasks as skipped by default", async () => {
      const workflow = {
        runTitle: "Test",
        tasks: [
          { id: "task_001", title: "Setup environment", dependsOn: [], acceptanceCriteria: [] },
          {
            id: "task_002",
            title: "Install dependencies",
            description: "Install required packages",
            dependsOn: ["task_001"],
            acceptanceCriteria: ["All packages installed"],
          },
          { id: "task_003", title: "Run tests", dependsOn: ["task_002"], acceptanceCriteria: [] },
          { id: "task_005", title: "Deploy", dependsOn: ["task_003"], acceptanceCriteria: [] },
        ],
      };

      const result = await workflowManager.applyWorkflow(testRunId, workflow, { noConfirm: true });
      expect(result.applied).toBe(true);
      expect(result.removed).toBe(1);

      const tasks = await runManager.loadTasks(testRunId);
      expect(tasks).toHaveLength(5);
      const removed = tasks.find((t) => t.id === "task_004");
      expect(removed).toBeTruthy();
      expect(removed!.status).toBe("skipped");
    });

    it("should reject workflow with invalid dependencies", async () => {
      const workflow = {
        runTitle: "Test",
        tasks: [
          {
            id: "task_001",
            title: "Setup environment",
            dependsOn: ["task_999"],
            acceptanceCriteria: [],
          },
        ],
      };

      const result = await workflowManager.applyWorkflow(testRunId, workflow, { noConfirm: true });
      expect(result.applied).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("addTask", () => {
    it("should add a task to the end", async () => {
      const task = await workflowManager.addTask(testRunId, { title: "New task" });
      expect(task.id).toBeTruthy();
      expect(task.title).toBe("New task");
      expect(task.status).toBe("pending");

      const tasks = await runManager.loadTasks(testRunId);
      expect(tasks.some((t) => t.id === task.id)).toBe(true);
    });

    it("should add a task after a specific position", async () => {
      const task = await workflowManager.addTask(
        testRunId,
        { title: "After task 003" },
        { after: "task_003" },
      );

      const tasks = await runManager.loadTasks(testRunId);
      const idx = tasks.findIndex((t) => t.id === task.id);
      const before = tasks[idx - 1];
      expect(before?.id).toBe("task_003");
    });
  });

  describe("removeTask", () => {
    it("should skip a task", async () => {
      const tasksBefore = await runManager.loadTasks(testRunId);
      const lastTask = tasksBefore[tasksBefore.length - 1]!;

      await workflowManager.removeTask(testRunId, lastTask.id);

      const tasksAfter = await runManager.loadTasks(testRunId);
      const removed = tasksAfter.find((t) => t.id === lastTask.id);
      expect(removed).toBeTruthy();
      expect(removed!.status).toBe("skipped");
    });

    it("should delete a task with --delete", async () => {
      const task = await workflowManager.addTask(testRunId, { title: "Temp task" });

      await workflowManager.removeTask(testRunId, task.id, { delete: true });

      const tasks = await runManager.loadTasks(testRunId);
      expect(tasks.find((t) => t.id === task.id)).toBeUndefined();
    });

    it("should throw when removing a task others depend on", async () => {
      await expect(workflowManager.removeTask(testRunId, "task_003")).rejects.toThrow();
    });

    it("should force remove with dependencies", async () => {
      await workflowManager.removeTask(testRunId, "task_003", { force: true });

      const tasks = await runManager.loadTasks(testRunId);
      const task4 = tasks.find((t) => t.id === "task_004");
      expect(task4?.dependsOn).not.toContain("task_003");
    });
  });

  describe("reorderTasks", () => {
    it("should reorder tasks preserving dependencies", async () => {
      const tasksBefore = await runManager.loadTasks(testRunId);
      const allIds = tasksBefore.map((t) => t.id);

      await expect(workflowManager.reorderTasks(testRunId, allIds)).resolves.not.toThrow();

      const tasksAfter = await runManager.loadTasks(testRunId);
      const afterIds = tasksAfter.map((t) => t.id);
      expect(afterIds.slice(0, allIds.length)).toEqual(allIds);
    });

    it("should throw on invalid ordering (task before dependency)", async () => {
      const ids = ["task_004", "task_003", "task_002", "task_001"];
      await expect(workflowManager.reorderTasks(testRunId, ids)).rejects.toThrow(
        "Invalid ordering",
      );
    });
  });

  describe("loadWorkflowFromFile", () => {
    it("should load YAML workflow file", async () => {
      const filePath = join(rootPath, "test-workflow.yaml");
      writeFileSync(
        filePath,
        `
runTitle: "Test"
tasks:
  - id: task_001
    title: "Task 1"
    dependsOn: []
`,
        "utf-8",
      );

      const workflow = await workflowManager.loadWorkflowFromFile(filePath);
      expect(workflow.tasks).toHaveLength(1);
      expect(workflow.tasks[0]!.title).toBe("Task 1");
    });

    it("should load JSON workflow file", async () => {
      const filePath = join(rootPath, "test-workflow.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          runTitle: "Test",
          tasks: [{ id: "task_001", title: "Task 1", dependsOn: [] }],
        }),
        "utf-8",
      );

      const workflow = await workflowManager.loadWorkflowFromFile(filePath);
      expect(workflow.tasks).toHaveLength(1);
    });

    it("should throw on invalid workflow file", async () => {
      const filePath = join(rootPath, "invalid-workflow.yaml");
      writeFileSync(filePath, "invalid: [content", "utf-8");

      await expect(workflowManager.loadWorkflowFromFile(filePath)).rejects.toThrow();
    });
  });

  describe("approval gates", () => {
    describe("checkStepRequiresApproval", () => {
      it("should require approval for delete step", () => {
        const result = workflowManager.checkStepRequiresApproval(
          "Delete temporary files",
          "rm -rf temp",
        );
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("high");
        expect(result.actionType).toBe("delete_file");
      });

      it("should require approval for install dependency step", () => {
        const result = workflowManager.checkStepRequiresApproval(
          "Install dependencies",
          "pnpm install",
        );
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("medium");
        expect(result.actionType).toBe("install_dependency");
      });

      it("should require approval for git push step", () => {
        const result = workflowManager.checkStepRequiresApproval(
          "Push to remote",
          "git push origin main",
        );
        expect(result.requiresApproval).toBe(true);
        expect(result.actionType).toBe("git_push");
      });

      it("should require approval for git commit step", () => {
        const result = workflowManager.checkStepRequiresApproval(
          "Commit changes",
          "git commit -m 'feat: add'",
        );
        expect(result.requiresApproval).toBe(true);
        expect(result.actionType).toBe("git_commit");
      });

      it("should require approval for deploy step with critical risk", () => {
        const result = workflowManager.checkStepRequiresApproval("Deploy to production");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("critical");
        expect(result.actionType).toBe("deploy");
      });

      it("should require approval for database migration step", () => {
        const result = workflowManager.checkStepRequiresApproval("Run database migration");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("critical");
        expect(result.actionType).toBe("database_migration");
      });

      it("should require approval for env config change step", () => {
        const result = workflowManager.checkStepRequiresApproval("Change environment config");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("high");
        expect(result.actionType).toBe("env_config_change");
      });

      it("should require approval for external API call step", () => {
        const result = workflowManager.checkStepRequiresApproval("Call external API");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("medium");
        expect(result.actionType).toBe("external_api_call");
      });

      it("should require approval for network operation step", () => {
        const result = workflowManager.checkStepRequiresApproval("Establish network connection");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("medium");
        expect(result.actionType).toBe("network_operation");
      });

      it("should require approval for plan execution step", () => {
        const result = workflowManager.checkStepRequiresApproval("Plan execution approval");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("medium");
        expect(result.actionType).toBe("plan_execution");
      });

      it("should require approval for high cost AI usage step", () => {
        const result = workflowManager.checkStepRequiresApproval("High cost AI call");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("high");
        expect(result.actionType).toBe("high_cost_ai_usage");
      });

      it("should require approval for override validation step", () => {
        const result = workflowManager.checkStepRequiresApproval("Override validation failure");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("critical");
        expect(result.actionType).toBe("override_validation_failure");
      });

      it("should require approval for skip validation step", () => {
        const result = workflowManager.checkStepRequiresApproval("Skip failed validation");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("critical");
        expect(result.actionType).toBe("override_validation_failure");
      });

      it("should require approval for continue after repeated failure step", () => {
        const result = workflowManager.checkStepRequiresApproval("Continue after failure");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("medium");
        expect(result.actionType).toBe("continue_after_repeated_failure");
      });

      it("should require approval for read sensitive file step", () => {
        const result = workflowManager.checkStepRequiresApproval("Read sensitive config");
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("high");
        expect(result.actionType).toBe("read_sensitive_file");
      });

      it("should auto-run safe steps without approval", () => {
        const safeSteps = [
          { title: "Run tests", command: "pnpm test" },
          { title: "Build project", command: "pnpm build" },
          { title: "Lint codebase", command: "pnpm lint" },
          { title: "Generate documentation", command: "npx typedoc" },
        ];
        for (const step of safeSteps) {
          const result = workflowManager.checkStepRequiresApproval(step.title, step.command);
          expect(result.requiresApproval).toBe(false);
        }
      });

      it("should auto-run command_execution as safe", () => {
        const result = workflowManager.checkStepRequiresApproval("Run custom script", "./build.sh");
        expect(result.requiresApproval).toBe(false);
        expect(result.actionType).toBe("command_execution");
        expect(result.autoApprove).toBe(true);
      });

      it("should auto-run file_write as safe", () => {
        const result = workflowManager.checkStepRequiresApproval("Write output file");
        expect(result.requiresApproval).toBe(false);
        expect(result.actionType).toBe("command_execution");
        expect(result.autoApprove).toBe(true);
      });

      it("should handle high cost threshold context", () => {
        const under = workflowManager.checkStepRequiresApproval(
          "Expensive model inference",
          undefined,
          { estimatedCost: 0.1 },
        );
        expect(under.requiresApproval).toBe(false);

        const over = workflowManager.checkStepRequiresApproval(
          "Expensive model inference",
          undefined,
          { estimatedCost: 1.0 },
        );
        expect(over.requiresApproval).toBe(true);
      });

      it("should handle failure count context", () => {
        const low = workflowManager.checkStepRequiresApproval("Continue after failure", undefined, {
          failureCount: 0,
        });
        expect(low.requiresApproval).toBe(false);

        const high = workflowManager.checkStepRequiresApproval(
          "Continue after failure",
          undefined,
          { failureCount: 3 },
        );
        expect(high.requiresApproval).toBe(true);
      });
    });

    describe("requireGateApproval and resolveGateApproval", () => {
      let gateTestRunId: string;

      beforeAll(async () => {
        const run = await runManager.createRun("test-project", "Gate test run", "auto");
        gateTestRunId = run.runId;
        await workflowManager.initWorkflowState(gateTestRunId);
      });

      it("should register a pending gate approval", async () => {
        const gateId = await workflowManager.requireGateApproval(
          gateTestRunId,
          "task_001",
          "delete_file",
          "high",
          "Deleting sensitive files requires approval",
          "rm -rf /tmp/test",
        );

        expect(gateId).toBeDefined();
        expect(gateId.startsWith("gate_")).toBe(true);

        const state = await workflowManager.loadWorkflowState(gateTestRunId);
        expect(state).not.toBeNull();
        expect(state!.pendingGates).toHaveLength(1);
        expect(state!.pendingGates![0]!.id).toBe(gateId);
        expect(state!.pendingGates![0]!.status).toBe("pending");
        expect(state!.pendingGates![0]!.actionType).toBe("delete_file");
        expect(state!.pendingGates![0]!.riskLevel).toBe("high");
        expect(state!.status).toBe("waiting_approval");
      });

      it("should list pending gates", async () => {
        const pending = await workflowManager.getPendingGates(gateTestRunId);
        expect(pending).toHaveLength(1);
        expect(pending[0]!.actionType).toBe("delete_file");
      });

      it("should resolve a pending gate as approved", async () => {
        const pending = await workflowManager.getPendingGates(gateTestRunId);
        expect(pending).toHaveLength(1);

        const resolved = await workflowManager.resolveGateApproval(
          gateTestRunId,
          pending[0]!.id,
          "approved",
          "test-user",
        );
        expect(resolved).toBe(true);

        const state = await workflowManager.loadWorkflowState(gateTestRunId);
        expect(state!.pendingGates![0]!.status).toBe("approved");
        expect(state!.pendingGates![0]!.resolvedBy).toBe("test-user");
        expect(state!.status).toBe("running");
      });

      it("should record gate decision in approval history", async () => {
        const state = await workflowManager.loadWorkflowState(gateTestRunId);
        expect(state!.approvalHistory).toHaveLength(1);
        expect(state!.approvalHistory![0]!.actionType).toBe("delete_file");
        expect(state!.approvalHistory![0]!.decision).toBe("approved");
      });

      it("should have no pending gates after resolution", async () => {
        const pending = await workflowManager.getPendingGates(gateTestRunId);
        expect(pending).toHaveLength(0);
      });
    });

    describe("requireGateApproval with override decision", () => {
      let overrideTestRunId: string;

      beforeAll(async () => {
        const run = await runManager.createRun("test-project", "Override test run", "auto");
        overrideTestRunId = run.runId;
        await workflowManager.initWorkflowState(overrideTestRunId);
      });

      it("should resolve gate with override", async () => {
        const gateId = await workflowManager.requireGateApproval(
          overrideTestRunId,
          "task_002",
          "database_migration",
          "critical",
          "Database migration requires approval",
        );

        const resolved = await workflowManager.resolveGateApproval(
          overrideTestRunId,
          gateId,
          "override",
          "admin",
        );
        expect(resolved).toBe(true);

        const state = await workflowManager.loadWorkflowState(overrideTestRunId);
        expect(state!.pendingGates![0]!.status).toBe("overridden");
        expect(state!.approvalHistory![0]!.decision).toBe("override");
      });
    });

    describe("requireGateApproval with rejection", () => {
      let rejectTestRunId: string;

      beforeAll(async () => {
        const run = await runManager.createRun("test-project", "Reject test run", "auto");
        rejectTestRunId = run.runId;
        await workflowManager.initWorkflowState(rejectTestRunId);
      });

      it("should resolve gate as rejected", async () => {
        const gateId = await workflowManager.requireGateApproval(
          rejectTestRunId,
          "task_003",
          "git_push",
          "high",
          "Git push requires approval",
          "git push origin main",
        );

        const resolved = await workflowManager.resolveGateApproval(
          rejectTestRunId,
          gateId,
          "rejected",
          "reviewer",
        );
        expect(resolved).toBe(true);

        const state = await workflowManager.loadWorkflowState(rejectTestRunId);
        expect(state!.pendingGates![0]!.status).toBe("rejected");
        expect(state!.approvalHistory![0]!.decision).toBe("rejected");
      });
    });

    describe("recordGateDecision", () => {
      let recordTestRunId: string;

      beforeAll(async () => {
        const run = await runManager.createRun("test-project", "Record test run", "auto");
        recordTestRunId = run.runId;
        await workflowManager.initWorkflowState(recordTestRunId);
      });

      it("should record an auto-approved decision", async () => {
        await workflowManager.recordGateDecision(
          recordTestRunId,
          "command_execution",
          "safe",
          "skip",
          "Auto-approved: safe action",
          true,
        );

        const state = await workflowManager.loadWorkflowState(recordTestRunId);
        expect(state!.approvalHistory).toHaveLength(1);
        expect(state!.approvalHistory![0]!.actionType).toBe("command_execution");
        expect(state!.approvalHistory![0]!.decision).toBe("skip");
        expect(state!.approvalHistory![0]!.autoApproved).toBe(true);
        expect(state!.approvalHistory![0]!.taskId).toBeUndefined();
      });
    });

    describe("getPendingGates", () => {
      it("should return empty array when no workflow state exists", async () => {
        const pending = await workflowManager.getPendingGates("nonexistent-run");
        expect(pending).toEqual([]);
      });

      it("should return empty array when no pending gates", async () => {
        const run = await runManager.createRun("test-project", "No gates run", "auto");
        await workflowManager.initWorkflowState(run.runId);

        const pending = await workflowManager.getPendingGates(run.runId);
        expect(pending).toEqual([]);
      });
    });
  });
});
