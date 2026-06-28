import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";

let testDir: string;
let api: FlowTaskAPI;

function makeId(): string {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-e2e-scenarios-"));
  api = new FlowTaskAPI({ rootPath: testDir });
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("FlowTaskAPI E2E Scenarios", () => {
  describe("Scenario 1: Full user journey with step-level approval", () => {
    let projectId: string;
    let runId: string;
    const taskId = makeId();
    const stepIds: [string, string, string] = [makeId(), makeId(), makeId()];

    it("1a. should init project and DB", async () => {
      const project = await api.initProject("E2E Step Approval Journey", "development");
      projectId = project.projectId;
      await api.initDatabase();
      expect(await api.isInitialized()).toBe(true);
    });

    it("1b. should create a run", async () => {
      const run = await api.createRun(projectId, "Step approval run", "manual");
      runId = run.runId;
      expect(run.status).toBe("created");
      expect(run.mode).toBe("manual");
    });

    it("1c. should save a task with mixed-approval steps", async () => {
      const now = new Date().toISOString();
      await api.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "Deploy feature",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      await sm.saveSteps(runId, taskId, [
        {
          id: stepIds[0],
          taskId,
          runId,
          title: "Run linter",
          type: "command" as const,
          command: "pnpm lint",
          status: "done" as const,
          requiresApproval: false,
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: stepIds[1],
          taskId,
          runId,
          title: "Run tests",
          type: "command" as const,
          command: "pnpm test",
          status: "pending_approval" as const,
          requiresApproval: true,
          order: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: stepIds[2],
          taskId,
          runId,
          title: "Deploy to prod",
          type: "command" as const,
          command: "deploy.sh",
          status: "pending_approval" as const,
          requiresApproval: true,
          order: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      const steps = await api.loadSteps(runId, taskId);
      expect(steps).toHaveLength(3);
    });

    it("1d. user approves step 2 (tests), denies step 3 (deploy)", async () => {
      await api.approveStep(runId, taskId, stepIds[1]);
      const s2 = await api.getStep(runId, taskId, stepIds[1]);
      expect(s2!.status).toBe("approved");

      await api.denyStep(runId, taskId, stepIds[2]);
      const s3 = await api.getStep(runId, taskId, stepIds[2]);
      expect(s3!.status).toBe("denied");
    });

    it("1e. user approves the task, transitioning from waiting_approval", async () => {
      await api.updateTaskStatus(runId, taskId, "waiting_approval");
      let task = await api.getTask(runId, taskId);
      expect(task!.status).toBe("waiting_approval");

      await api.approveTask(runId, taskId);
      task = await api.getTask(runId, taskId);
      expect(task!.status).toBe("pending");
    });

    it("1f. should transition task through running to done", async () => {
      let task = await api.updateTaskStatus(runId, taskId, "running");
      expect(task.status).toBe("running");

      task = await api.updateTaskStatus(runId, taskId, "done");
      expect(task.status).toBe("done");
    });

    it("1g. should have complete event trail for the run", async () => {
      await api.appendEvent(runId, {
        type: "approval_approved",
        runId,
        taskId,
        message: "Tests approved",
      });
      await api.appendEvent(runId, {
        type: "approval_rejected",
        runId,
        taskId,
        message: "Deploy denied",
      });

      const events = await api.readRunEvents(runId);
      const stepApproved = events.find((e) => e.type === "approval_approved");
      expect(stepApproved).toBeDefined();

      const stepDenied = events.find((e) => e.type === "approval_rejected");
      expect(stepDenied).toBeDefined();
    });

    it("1h. should complete the run and verify final state", async () => {
      await api.updateRunStatus(runId, "completed");
      const run = await api.loadRun(runId);
      expect(run!.status).toBe("completed");

      const inspection = await api.inspectRun(runId);
      expect(inspection.run!.runId).toBe(runId);
      expect(inspection.tasks.length).toBe(1);
      expect(inspection.tasks[0]!.status).toBe("done");
    });
  });

  describe("Scenario 2: Bypass approval mode", () => {
    let bypassDir: string;
    let bypassApi: FlowTaskAPI;
    let runId: string;
    const taskId = makeId();
    const stepId = makeId();

    beforeAll(async () => {
      bypassDir = mkdtempSync(join(tmpdir(), "flowtask-bypass-"));
      bypassApi = new FlowTaskAPI({ rootPath: bypassDir });
    });

    afterAll(() => {
      rmSync(bypassDir, { recursive: true, force: true });
    });

    it("2a. should init project and configure bypass approval mode", async () => {
      await bypassApi.initProject("Bypass Test", "development");
      await bypassApi.initDatabase();
      await bypassApi.setConfigValue("approval.autoApprove", true);
      const autoApprove = await bypassApi.getConfigValue("approval.autoApprove");
      expect(autoApprove).toBe(true);
    });

    it("2b. should create run and save tasks with approval-required steps", async () => {
      const project = await bypassApi.loadProject();
      const run = await bypassApi.createRun(project!.projectId, "Bypass approval run", "auto");
      runId = run.runId;
      const now = new Date().toISOString();
      await bypassApi.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "Auto-approved task",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(bypassDir);
      await sm.saveSteps(runId, taskId, [
        {
          id: stepId,
          taskId,
          runId,
          title: "Needs approval step",
          type: "command" as const,
          command: "echo risky",
          status: "pending_approval" as const,
          requiresApproval: true,
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });

    it("2c. should approve all steps via approveAllSteps when bypass config is active", async () => {
      const approved = await bypassApi.approveAllSteps(runId, taskId);
      expect(approved.length).toBe(1);
      expect(approved[0]!.status).toBe("approved");
    });

    it("2d. should verify all steps are approved without individual approvals", async () => {
      const step = await bypassApi.getStep(runId, taskId, stepId);
      expect(step!.status).toBe("approved");
    });
  });

  describe("Scenario 3: Metadata persistence across API instances", () => {
    let runId: string;
    let taskId: string;
    const persistDir = mkdtempSync(join(tmpdir(), "flowtask-persist-"));

    afterAll(() => {
      rmSync(persistDir, { recursive: true, force: true });
    });

    it("3a. API-1: init project, create run, save tasks, steps, events, artifacts", async () => {
      const api1 = new FlowTaskAPI({ rootPath: persistDir });
      await api1.initProject("Persistence Test", "development");
      await api1.initDatabase();

      const project = await api1.loadProject();
      const run = await api1.createRun(project!.projectId, "Persist me", "auto");
      runId = run.runId;
      taskId = makeId();

      const now = new Date().toISOString();
      await api1.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "Persistent task",
          status: "done" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["It works"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(persistDir);
      await sm.saveSteps(runId, taskId, [
        {
          id: "persist_step",
          taskId,
          runId,
          title: "Step that persists",
          type: "command" as const,
          command: "echo persist",
          status: "done" as const,
          requiresApproval: false,
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await api1.saveArtifact(runId, taskId, "output.txt", "persistent content");
      await api1.appendEvent(runId, {
        type: "run_completed",
        runId,
        taskId,
        message: "Event persists",
      });
      await api1.saveRunState(runId, {
        runId,
        status: "completed" as const,
        progress: { total: 1, done: 1, running: 0, failed: 0, pending: 0 },
        updatedAt: now,
      });
      await api1.updateRunStatus(runId, "completed");
    });

    it("3b. API-2: load same project, verify all metadata persisted", async () => {
      const api2 = new FlowTaskAPI({ rootPath: persistDir });
      await api2.initDatabase();

      const initialized = await api2.isInitialized();
      expect(initialized).toBe(true);

      const run = await api2.loadRun(runId);
      expect(run).not.toBeNull();
      expect(run!.status).toBe("completed");
      expect(run!.title).toBe("Persist me");

      const tasks = await api2.loadTasks(runId);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.id).toBe(taskId);
      expect(tasks[0]!.status).toBe("done");

      const steps = await api2.loadSteps(runId, taskId);
      expect(steps).toHaveLength(1);
      expect(steps[0]!.title).toBe("Step that persists");

      expect(
        existsSync(join(persistDir, ".flowtask", "runs", runId, "artifacts", taskId, "output.txt")),
      ).toBe(true);

      const events = await api2.readRunEvents(runId);
      const completedEvent = events.find((e) => e.type === "run_completed");
      expect(completedEvent).toBeDefined();

      const runState = await api2.loadRunState(runId);
      expect(runState).not.toBeNull();
      expect(runState!.status).toBe("completed");

      const inspection = await api2.inspectRun(runId);
      expect(inspection.run).not.toBeNull();
      expect(inspection.tasks).toHaveLength(1);
      expect(Object.keys(inspection.steps).length).toBeGreaterThanOrEqual(1);
    });

    it("3c. API-2: verify project state persisted", async () => {
      const api2 = new FlowTaskAPI({ rootPath: persistDir });
      const project = await api2.loadProject();
      expect(project).not.toBeNull();
      expect(project!.name).toBe("Persistence Test");

      const status = await api2.getProjectStatus();
      expect(status.initialized).toBe(true);
      expect(status.project).not.toBeNull();
    });

    it("3d. API-2: verify DB data persisted", async () => {
      const api2 = new FlowTaskAPI({ rootPath: persistDir });
      await api2.initDatabase();

      const dbStatus = await api2.getDbStatus();
      expect(dbStatus).not.toBeNull();
      expect(dbStatus!.tableCount).toBeGreaterThanOrEqual(6);
    });

    it("3e. API-2: verify step manager data is file-based and persisted", async () => {
      const api2 = new FlowTaskAPI({ rootPath: persistDir });
      const steps = await api2.loadSteps(runId, taskId);
      expect(steps).toHaveLength(1);
      expect(steps[0]!.status).toBe("done");
    });
  });

  describe("Scenario 4: Complex workflow editing", () => {
    let runId: string;
    const taskIds = [makeId(), makeId(), makeId(), makeId(), makeId()];
    const tA = taskIds[0]!;
    const tB = taskIds[1]!;
    const tC = taskIds[2]!;
    const tD = taskIds[3]!;
    const tE = taskIds[4]!;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Complex workflow", "auto");
      runId = run.runId;
      const now = new Date().toISOString();
      await api.saveTasks(runId, [
        {
          id: tA,
          runId,
          title: "Setup",
          status: "done" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["Env ready"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: tB,
          runId,
          title: "Build",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [tA],
          acceptanceCriteria: ["Build OK"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: tC,
          runId,
          title: "Test",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [tB],
          acceptanceCriteria: ["Tests pass"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });

    it("4a. should verify initial workflow structure", async () => {
      const tasks = await api.loadTasks(runId);
      expect(tasks).toHaveLength(3);
      const next = await api.getNextTask(tasks);
      expect(next).not.toBeNull();
      expect(next!.id).toBe(tB);
    });

    it("4b. should add a new task mid-chain (after task B)", async () => {
      const added = await api.workflowAddTask(
        runId,
        {
          id: tD,
          title: "Lint",
          description: "Run linter after build",
          dependsOn: [tB],
        },
        tB,
      );
      expect(added.title).toBe("Lint");
      expect(added.status).toBe("pending");
      expect(added.dependsOn).toEqual([tB]);
    });

    it("4c. should add another task at the end", async () => {
      const added = await api.workflowAddTask(runId, {
        id: tE,
        title: "Deploy",
        dependsOn: [tC],
      });
      expect(added.title).toBe("Deploy");
      expect(added.dependsOn).toEqual([tC]);
    });

    it("4d. should have 5 tasks after adds", async () => {
      const tasks = await api.loadTasks(runId);
      expect(tasks).toHaveLength(5);
    });

    it("4e. should validate workflow has no cycles", async () => {
      const tasks = await api.loadTasks(runId);
      const activeTasks = tasks.filter((t) => t.status !== "skipped");
      const result = await api.workflowValidate({
        runTitle: "Complex workflow",
        tasks: activeTasks.map((t) => ({
          id: t.id,
          title: t.title,
          dependsOn: t.dependsOn,
          acceptanceCriteria: t.acceptanceCriteria,
        })),
      });
      expect(result.valid).toBe(true);
    });

    it("4f. should remove the deploy task (skip)", async () => {
      const tasks = await api.loadTasks(runId);
      const deployTask = tasks.find((t) => t.title === "Deploy")!;
      expect(deployTask).toBeDefined();

      await api.workflowRemoveTask(runId, deployTask.id, { delete: false });
      const reloaded = await api.loadTasks(runId);
      const removed = reloaded.find((t) => t.id === deployTask.id);
      expect(removed).toBeDefined();
      expect(removed!.status).toBe("skipped");
    });

    it("4g. should reorder tasks respecting dependencies", async () => {
      const tasks = await api.loadTasks(runId);
      const active = tasks.filter((t) => t.status !== "skipped");
      const ids = active.map((t) => t.id);

      const lintId = active.find((t) => t.title === "Lint")!.id;
      const testId = active.find((t) => t.title === "Test")!.id;
      const lintPos = ids.indexOf(lintId);
      const testPos = ids.indexOf(testId);

      const reordered = [...ids];
      reordered[lintPos] = testId;
      reordered[testPos] = lintId;

      await api.workflowReorder(runId, reordered);
      const reloaded = await api.loadTasks(runId);
      const activeReloaded = reloaded.filter((t) => t.status !== "skipped");
      expect(activeReloaded[lintPos]!.id).toBe(testId);
      expect(activeReloaded[testPos]!.id).toBe(lintId);
    });

    it("4h. should export the modified workflow", async () => {
      const result = await api.exportWorkflow(runId);
      expect(result.workflow.tasks.length).toBeGreaterThanOrEqual(4);
      expect(result.json).toContain("Setup");
      expect(result.json).toContain("Lint");
      expect(result.yaml).toContain("Setup");
    });

    it("4i. should compute diff between exported workflow and file", async () => {
      const result = await api.exportWorkflow(runId);
      const filePath = join(testDir, "modified-workflow.json");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, result.json, "utf-8");

      const diff = await api.workflowDiff(runId, filePath);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
    });
  });

  describe("Scenario 5: Cross-run management and data isolation", () => {
    const runIds: string[] = [];
    const numRuns = 4;

    it("5a. should create multiple runs with different statuses", async () => {
      const project = await api.loadProject();
      for (let i = 0; i < numRuns; i++) {
        const run = await api.createRun(project!.projectId, `Multi-run-${i}`, "auto");
        runIds.push(run.runId);
      }
      expect(runIds).toHaveLength(numRuns);
    });

    it("5b. should set different statuses on each run", async () => {
      const statuses: Array<"planning" | "running" | "completed" | "failed"> = [
        "planning",
        "running",
        "completed",
        "failed",
      ];
      for (let i = 0; i < numRuns; i++) {
        await api.updateRunStatus(runIds[i]!, statuses[i]!);
      }
      for (let i = 0; i < numRuns; i++) {
        const run = await api.loadRun(runIds[i]!);
        expect(run!.status).toBe(statuses[i]);
      }
    });

    it("5c. should list all runs with correct counts", async () => {
      const allRuns = await api.listRuns();
      const myRuns = allRuns.filter((r) => runIds.includes(r.runId));
      expect(myRuns.length).toBe(numRuns);
    });

    it("5d. should have data isolation between runs", async () => {
      const now = new Date().toISOString();
      for (let i = 0; i < runIds.length; i++) {
        await api.saveTasks(runIds[i]!, [
          {
            id: `iso_task_${i}`,
            runId: runIds[i]!,
            title: `Isolated task ${i}`,
            status: "pending" as const,
            executor: "shell",
            dependsOn: [],
            acceptanceCriteria: [],
            retryCount: 0,
            maxRetries: 2,
            createdAt: now,
            updatedAt: now,
          },
        ]);
      }
      for (let i = 0; i < runIds.length; i++) {
        const tasks = await api.loadTasks(runIds[i]!);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]!.id).toBe(`iso_task_${i}`);
        expect(tasks[0]!.runId).toBe(runIds[i]);
      }
    });

    it("5e. should clean completed and failed runs", async () => {
      const result = await api.cleanRuns({ status: "completed", dryRun: false });
      expect(result.deleted).toBeGreaterThanOrEqual(1);

      const result2 = await api.cleanRuns({ status: "failed", dryRun: false });
      expect(result2.deleted).toBeGreaterThanOrEqual(1);

      const remaining = await api.listRuns();
      const stillExists = remaining.filter((r) => runIds.includes(r.runId));
      expect(stillExists.length).toBeLessThan(numRuns);
    });
  });

  describe("Scenario 6: Event-driven state tracking", () => {
    let runId: string;
    const taskId = makeId();

    it("6a. should create run and append lifecycle events", async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Event tracking", "auto");
      runId = run.runId;
      await api.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "Tracked task",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      await api.appendEvent(runId, { type: "run_started", runId, message: "Run started" });
      await api.appendEvent(runId, {
        type: "task_started",
        runId,
        taskId,
        message: "Task started",
      });
      await api.appendEvent(runId, {
        type: "task_completed",
        runId,
        taskId,
        message: "Task completed",
      });
      await api.appendEvent(runId, { type: "run_completed", runId, message: "Run finished" });

      const events = await api.readRunEvents(runId);
      expect(events.length).toBeGreaterThanOrEqual(4);

      const stateTransitions = [
        "run_started",
        "task_started",
        "task_completed",
        "run_completed",
      ] as const;
      for (const st of stateTransitions) {
        const found = events.find((e) => e.type === st);
        expect(found).toBeDefined();
      }
    });

    it("6b. should track workflow modification events", async () => {
      const added = await api.workflowAddTask(runId, { title: "Extra task", dependsOn: [taskId] });
      let events = await api.readRunEvents(runId);
      const addEvent = events.find((e) => e.type === "workflow_added_task");
      expect(addEvent).toBeDefined();
      expect(addEvent!.taskId).toBe(added.id);

      await api.workflowRemoveTask(runId, added.id, { delete: true });
      events = await api.readRunEvents(runId);
      const removeEvent = events.find((e) => e.type === "workflow_removed_task");
      expect(removeEvent).toBeDefined();
    });

    it("6c. should track step approval events via state transitions", async () => {
      const stepTaskId = makeId();
      const stepIdA = makeId();
      const stepIdB = makeId();

      await api.saveTasks(runId, [
        {
          id: stepTaskId,
          runId,
          title: "Step tracking task",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      const now = new Date().toISOString();
      await sm.saveSteps(runId, stepTaskId, [
        {
          id: stepIdA,
          taskId: stepTaskId,
          runId,
          title: "Approve me A",
          type: "command" as const,
          command: "echo a",
          status: "pending_approval" as const,
          requiresApproval: true,
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: stepIdB,
          taskId: stepTaskId,
          runId,
          title: "Approve me B",
          type: "command" as const,
          command: "echo b",
          status: "pending_approval" as const,
          requiresApproval: true,
          order: 1,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const allApproved = await api.approveAllSteps(runId, stepTaskId);
      expect(allApproved).toHaveLength(2);

      const steps = await api.loadSteps(runId, stepTaskId);
      expect(steps.every((s) => s.status === "approved")).toBe(true);
    });
  });

  describe("Scenario 7: Config-driven behavior changes", () => {
    let configDir: string;
    let configApi: FlowTaskAPI;

    beforeAll(async () => {
      configDir = mkdtempSync(join(tmpdir(), "flowtask-config-"));
      configApi = new FlowTaskAPI({ rootPath: configDir });
      await configApi.initProject("Config Test", "development");
      await configApi.initDatabase();
    });

    afterAll(() => {
      rmSync(configDir, { recursive: true, force: true });
    });

    it("7a. should set nested configuration values and persist them", async () => {
      await configApi.setConfigValue("limits.maxRunMinutes", 60);
      await configApi.setConfigValue("approval.autoApprove", true);
      await configApi.setConfigValue("quality.enabledByDefault", true);

      expect(await configApi.getConfigValue("limits.maxRunMinutes")).toBe(60);
      expect(await configApi.getConfigValue("approval.autoApprove")).toBe(true);
      expect(await configApi.getConfigValue("quality.enabledByDefault")).toBe(true);
    });

    it("7b. should update config and verify new values override old ones", async () => {
      await configApi.setConfigValue("limits.maxRunMinutes", 120);
      expect(await configApi.getConfigValue("limits.maxRunMinutes")).toBe(120);
      expect(await configApi.getConfigValue("approval.autoApprove")).toBe(true);
    });

    it("7c. should list config keys including nested ones", async () => {
      const keys = await configApi.listConfigKeys();
      expect(keys).toContain("limits.maxRunMinutes");
      expect(keys).toContain("approval.autoApprove");
      expect(keys).toContain("quality.enabledByDefault");
    });

    it("7d. should create runs with different modes based on config", async () => {
      const project = await configApi.loadProject();

      const autoRun = await configApi.createRun(project!.projectId, "Auto mode", "auto");
      expect(autoRun.mode).toBe("auto");

      const manualRun = await configApi.createRun(project!.projectId, "Manual mode", "manual");
      expect(manualRun.mode).toBe("manual");

      const debugRun = await configApi.createRun(project!.projectId, "Debug mode", "debug");
      expect(debugRun.mode).toBe("debug");
    });

    it("7e. should verify runs with different modes have correct separation", async () => {
      const runs = await configApi.listRuns();
      expect(runs.length).toBeGreaterThanOrEqual(3);
      const titles = runs.map((r) => r.title);
      expect(titles).toContain("Auto mode");
      expect(titles).toContain("Manual mode");
      expect(titles).toContain("Debug mode");
    });
  });
});
