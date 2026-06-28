import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";

let testDir: string;
let api: FlowTaskAPI;

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-api-test-"));
  api = new FlowTaskAPI({ rootPath: testDir });
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("FlowTaskAPI", () => {
  describe("Project", () => {
    it("should not be initialized initially", async () => {
      const initialized = await api.isInitialized();
      expect(initialized).toBe(false);
    });

    it("should init a project", async () => {
      const project = await api.initProject("Test Project", "development");
      expect(project.projectId).toBeTruthy();
      expect(project.name).toBe("Test Project");
      expect(project.rootPath).toBe(testDir);
    });

    it("should be initialized after init", async () => {
      const initialized = await api.isInitialized();
      expect(initialized).toBe(true);
    });

    it("should load the project", async () => {
      const project = await api.loadProject();
      expect(project).not.toBeNull();
      expect(project!.name).toBe("Test Project");
    });

    it("should load project state", async () => {
      const state = await api.loadProjectState();
      expect(state).not.toBeNull();
      expect(state!.status).toBe("idle");
    });

    it("should save project state", async () => {
      const state = await api.loadProjectState();
      expect(state).not.toBeNull();
      state!.status = "has_running_run";
      state!.activeRunId = "test-run-1";
      await api.saveProjectState(state!);
      const loaded = await api.loadProjectState();
      expect(loaded!.status).toBe("has_running_run");
      expect(loaded!.activeRunId).toBe("test-run-1");
    });

    it("should load config", async () => {
      const config = await api.loadConfig();
      expect(config).toBeTruthy();
      expect(config.projectMode).toBe("development");
    });

    it("should get project status", async () => {
      const status = await api.getProjectStatus();
      expect(status.initialized).toBe(true);
      expect(status.project).not.toBeNull();
      expect(status.state).not.toBeNull();
      expect(status.config).not.toBeNull();
    });
  });

  describe("Config", () => {
    it("should get config", async () => {
      const config = await api.getConfig();
      expect(config.projectMode).toBeTruthy();
    });

    it("should get config value", async () => {
      const mode = await api.getConfigValue("projectMode");
      expect(mode).toBe("development");
    });

    it("should get undefined for non-existent key", async () => {
      const val = await api.getConfigValue("nonexistent.key");
      expect(val).toBeUndefined();
    });

    it("should set config value", async () => {
      const { configJsonPath } = await import("../../src/utils/paths.js");
      const { atomicWriteJsonFile } = await import("../../src/utils/fs.js");
      const cPath = configJsonPath(testDir);
      await atomicWriteJsonFile(cPath, { testKey: "testValue", projectMode: "development" });
      const val = await api.getConfigValue("testKey");
      expect(val).toBe("testValue");
    });

    it("should list config keys", async () => {
      const keys = await api.listConfigKeys();
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain("projectMode");
    });
  });

  describe("Run", () => {
    let runId: string;

    it("should create a run", async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Test run", "auto");
      runId = run.runId;
      expect(run.runId).toBeTruthy();
      expect(run.title).toBe("Test run");
      expect(run.status).toBe("created");
    });

    it("should load a run", async () => {
      const run = await api.loadRun(runId);
      expect(run).not.toBeNull();
      expect(run!.runId).toBe(runId);
    });

    it("should list runs", async () => {
      const runs = await api.listRuns();
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs.some((r) => r.runId === runId)).toBe(true);
    });

    it("should update run status", async () => {
      const run = await api.updateRunStatus(runId, "running");
      expect(run.status).toBe("running");
    });

    it("should save and load tasks", async () => {
      const tasks = [
        {
          id: "task_001",
          runId: runId,
          title: "Test task",
          description: "A test task description",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["AC1"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      await api.saveTasks(runId, tasks);
      const loaded = await api.loadTasks(runId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.title).toBe("Test task");
    });

    it("should get a task by id", async () => {
      const task = await api.getTask(runId, "task_001");
      expect(task).not.toBeUndefined();
      expect(task!.title).toBe("Test task");
    });

    it("should update task", async () => {
      const updated = await api.updateTask(runId, "task_001", {
        title: "Updated task",
        description: "Updated description",
      });
      expect(updated.title).toBe("Updated task");
      expect(updated.description).toBe("Updated description");
    });

    it("should update task status", async () => {
      const updated = await api.updateTaskStatus(runId, "task_001", "running");
      expect(updated.status).toBe("running");
    });

    it("should get next pending task", async () => {
      const tasks = await api.loadTasks(runId);
      const next = await api.getNextTask(tasks);
      expect(next).toBeNull(); // task is in "running" status
    });

    it("should inspect a run", async () => {
      const inspection = await api.inspectRun(runId);
      expect(inspection.run).not.toBeNull();
      expect(inspection.run!.runId).toBe(runId);
      expect(inspection.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it("should cancel a run", async () => {
      const run = await api.cancelRun(runId);
      expect(run.status).toBe("cancelled");
    });
  });

  describe("Step", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Step test run", "auto");
      runId = run.runId;
      const tasks = [
        {
          id: "step_task_001",
          runId: runId,
          title: "Task with steps",
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
      await api.saveTasks(runId, tasks);
    });

    it("should save and load steps", async () => {
      const steps = [
        {
          id: "step_001",
          taskId: "step_task_001",
          runId: runId,
          title: "Step 1",
          type: "command" as const,
          command: "echo hello",
          status: "pending" as const,
          requiresApproval: false,
          order: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      await sm.saveSteps(runId, "step_task_001", steps);

      const loaded = await api.loadSteps(runId, "step_task_001");
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.title).toBe("Step 1");
    });

    it("should get a step by id", async () => {
      const step = await api.getStep(runId, "step_task_001", "step_001");
      expect(step).not.toBeUndefined();
      expect(step!.title).toBe("Step 1");
    });

    it("should update step status", async () => {
      await api.updateStepStatus(runId, "step_task_001", "step_001", "running");
      const step = await api.getStep(runId, "step_task_001", "step_001");
      expect(step!.status).toBe("running");
    });

    it("should approve a step", async () => {
      const steps = [
        {
          id: "step_002",
          taskId: "step_task_001",
          runId: runId,
          title: "Step needing approval",
          type: "command" as const,
          command: "rm -rf tmp",
          status: "pending_approval" as const,
          requiresApproval: true,
          order: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      await sm.saveSteps(runId, "step_task_001", steps);

      await api.approveStep(runId, "step_task_001", "step_002");
      const step = await api.getStep(runId, "step_task_001", "step_002");
      expect(step!.status).toBe("approved");
    });

    it("should deny a step", async () => {
      const steps = [
        {
          id: "step_003",
          taskId: "step_task_001",
          runId: runId,
          title: "Step to deny",
          type: "command" as const,
          command: "echo test",
          status: "pending_approval" as const,
          requiresApproval: true,
          order: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      await sm.saveSteps(runId, "step_task_001", steps);

      await api.denyStep(runId, "step_task_001", "step_003");
      const step = await api.getStep(runId, "step_task_001", "step_003");
      expect(step!.status).toBe("denied");
    });

    it("should load all steps for a run", async () => {
      const allSteps = await api.loadAllSteps(runId);
      expect(allSteps["step_task_001"]).toBeDefined();
      const steps = allSteps["step_task_001"];
      expect(steps).toBeDefined();
      expect(steps!.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Workflow", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Workflow test run", "auto");
      runId = run.runId;
      const tasks = [
        {
          id: "wf_task_001",
          runId: runId,
          title: "Task A",
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
          id: "wf_task_002",
          runId: runId,
          title: "Task B",
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
      await api.saveTasks(runId, tasks);
    });

    it("should export workflow", async () => {
      const result = await api.exportWorkflow(runId);
      expect(result.workflow.tasks.length).toBe(2);
      expect(result.yaml).toBeTruthy();
      expect(result.json).toBeTruthy();
    });

    it("should add a task to workflow", async () => {
      const task = await api.workflowAddTask(runId, {
        title: "Task C",
        description: "New task",
      });
      expect(task.title).toBe("Task C");
      expect(task.status).toBe("pending");
    });

    it("should validate workflow", async () => {
      const result = await api.workflowValidate({
        runTitle: "Validation test",
        tasks: [
          { id: "v1", title: "Valid", dependsOn: [], acceptanceCriteria: [] },
          { id: "v2", title: "Also valid", dependsOn: ["v1"], acceptanceCriteria: [] },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it("should detect cycles in workflow", async () => {
      const result = await api.workflowValidate({
        runTitle: "Cycle test",
        tasks: [
          { id: "c1", title: "Task 1", dependsOn: ["c2"], acceptanceCriteria: [] },
          { id: "c2", title: "Task 2", dependsOn: ["c1"], acceptanceCriteria: [] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it("should reorder tasks", async () => {
      const currentTasks = await api.loadTasks(runId);
      const ids = currentTasks.map((t) => t.id);
      const reordered = [ids[1]!, ids[0]!, ...ids.slice(2)];
      await api.workflowReorder(runId, reordered);
      const tasks = await api.loadTasks(runId);
      expect(tasks[0]!.id).toBe(ids[1]);
    });
  });

  describe("Artifact", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Artifact test run", "auto");
      runId = run.runId;
    });

    it("should save artifact", async () => {
      const artifact = await api.saveArtifact(
        runId,
        "task_art_001",
        "test.json",
        '{"key": "value"}',
      );
      expect(artifact.artifactId).toBeTruthy();
      expect(artifact.title).toBe("test.json");
      expect(artifact.type).toBe("json");
    });

    it("should load artifact", async () => {
      const artifacts = await api.listArtifactsByRun(runId);
      if (artifacts.length > 0 && artifacts[0]) {
        const content = await api.loadArtifact(artifacts[0].filePath);
        expect(content).toBeTruthy();
      }
    });
  });

  describe("Events and Logs", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Event test run", "auto");
      runId = run.runId;
    });

    it("should append and read events", async () => {
      await api.appendEvent(runId, {
        type: "run_created",
        runId,
        message: "Test event",
      });
      const events = await api.readRunEvents(runId);
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.message === "Test event")).toBe(true);
    });

    it("should read runtime log", async () => {
      const { LogManager } = await import("../../src/core/log-manager.js");
      const lm = new LogManager(testDir);
      await lm.writeRuntime(runId, "Runtime test message");

      const log = await api.readRuntimeLog(runId);
      expect(log).toContain("Runtime test message");
    });

    it("should read task log", async () => {
      const { LogManager } = await import("../../src/core/log-manager.js");
      const lm = new LogManager(testDir);
      await lm.writeTaskLog(runId, "test_task", "Task log message");

      const log = await api.readTaskLog(runId, "test_task");
      expect(log).toContain("Task log message");
    });

    it("should list log files", async () => {
      const files = await api.listLogFiles(runId);
      expect(files.length).toBeGreaterThan(0);
    });
  });

  describe("Database", () => {
    it("should init and get db status", async () => {
      await api.initDatabase();
      const status = await api.getDbStatus();
      expect(status).not.toBeNull();
      expect(status!.version).toBeGreaterThanOrEqual(0);
    });

    it("should run integrity check", async () => {
      const result = await api.integrityCheck();
      expect(result.valid).toBe(true);
    });

    it("should backup database", async () => {
      const backupPath = join(testDir, ".flowtask", "flowtask-backup.db");
      const result = await api.backupDatabase(backupPath);
      expect(result).toBe(true);
      expect(existsSync(backupPath)).toBe(true);
    });
  });

  describe("Task Approval", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Approval test run", "auto");
      runId = run.runId;
      const tasks = [
        {
          id: "approve_task_001",
          runId,
          title: "Task to approve",
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
          id: "approve_task_002",
          runId,
          title: "Task to deny",
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
      await api.saveTasks(runId, tasks);
    });

    it("should approve a task", async () => {
      const task = await api.approveTask(runId, "approve_task_001");
      expect(task.status).toBe("pending");
    });

    it("should deny a task", async () => {
      const task = await api.denyTask(runId, "approve_task_002");
      expect(task.status).toBe("skipped");
    });
  });

  describe("Clean Runs", () => {
    it("should clean runs with dry-run", async () => {
      const result = await api.cleanRuns({ dryRun: true });
      expect(result.dryRun).toBe(true);
    });
  });

  describe("Utility", () => {
    it("should return root path", () => {
      expect(api.getRootPath()).toBe(testDir);
    });

    it("should set root path", () => {
      const newDir = mkdtempSync(join(tmpdir(), "flowtask-api-new-"));
      api.setRootPath(newDir);
      expect(api.getRootPath()).toBe(newDir);
      api.setRootPath(testDir);
      rmSync(newDir, { recursive: true, force: true });
    });
  });
});
