import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";

vi.mock("enquirer", () => ({
  default: vi.fn(),
}));

let testDir: string;
let api: FlowTaskAPI;

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-e2e-test-"));
  api = new FlowTaskAPI({ rootPath: testDir });
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("FlowTaskAPI E2E", () => {
  describe("Full lifecycle: init → create run → save tasks → run lifecycle → inspect → cleanup", () => {
    let projectId: string;
    let runId: string;

    it("1. should init a project", async () => {
      const project = await api.initProject("E2E Test Project", "development");
      projectId = project.projectId;
      expect(project.rootPath).toBe(testDir);
      expect(existsSync(join(testDir, ".flowtask", "project.json"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "config.json"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "state.json"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "run-index.json"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "task-index.json"))).toBe(true);
    });

    it("2. should init database", async () => {
      const db = await api.initDatabase();
      expect(db).not.toBeNull();
      const status = await api.getDbStatus();
      expect(status).not.toBeNull();
      expect(status!.tableCount).toBeGreaterThanOrEqual(6);
    });

    it("3. should create a run", async () => {
      const run = await api.createRun(projectId, "E2E test: implement feature X", "auto");
      runId = run.runId;
      expect(run.status).toBe("created");
      expect(run.mode).toBe("auto");

      const runDir = join(testDir, ".flowtask", "runs", runId);
      expect(existsSync(runDir)).toBe(true);
    });

    it("4. should save and load tasks", async () => {
      const now = new Date().toISOString();
      const tasks = [
        {
          id: "e2e_task_1",
          runId,
          title: "Setup project structure",
          description: "Initialize project directories",
          status: "done" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["Directories exist", "Config files created"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "e2e_task_2",
          runId,
          title: "Implement core logic",
          description: "Write main implementation",
          status: "pending" as const,
          executor: "shell",
          dependsOn: ["e2e_task_1"],
          acceptanceCriteria: ["Feature works", "Tests pass"],
          retryCount: 0,
          maxRetries: 3,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "e2e_task_3",
          runId,
          title: "Write documentation",
          description: "Document the feature",
          status: "pending" as const,
          executor: "opencode",
          dependsOn: ["e2e_task_2"],
          acceptanceCriteria: ["Docs written"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ];
      await api.saveTasks(runId, tasks);
      const loaded = await api.loadTasks(runId);
      expect(loaded).toHaveLength(3);
    });

    it("5. should get next pending task (e2e_task_2 since e2e_task_1 is done)", async () => {
      const tasks = await api.loadTasks(runId);
      const next = await api.getNextTask(tasks);
      expect(next).not.toBeNull();
      expect(next!.id).toBe("e2e_task_2");
    });

    it("6. should update run status to running", async () => {
      const updated = await api.updateRunStatus(runId, "running");
      expect(updated.status).toBe("running");
    });

    it("7. should update task status to running then done", async () => {
      let updated = await api.updateTaskStatus(runId, "e2e_task_1", "running");
      expect(updated.status).toBe("running");
      updated = await api.updateTaskStatus(runId, "e2e_task_1", "done");
      expect(updated.status).toBe("done");
    });

    it("8. should get next task again (e2e_task_2 dependencies met)", async () => {
      const tasks = await api.loadTasks(runId);
      const next = await api.getNextTask(tasks);
      expect(next).not.toBeNull();
      expect(next!.id).toBe("e2e_task_2");
    });

    it("9. should approve and deny tasks", async () => {
      const taskA = await api.updateTaskStatus(runId, "e2e_task_2", "waiting_approval");
      expect(taskA.status).toBe("waiting_approval");

      const approved = await api.approveTask(runId, "e2e_task_2");
      expect(approved.status).toBe("pending");

      const taskB = await api.updateTaskStatus(runId, "e2e_task_3", "waiting_approval");
      expect(taskB.status).toBe("waiting_approval");

      const denied = await api.denyTask(runId, "e2e_task_3");
      expect(denied.status).toBe("skipped");
    });

    it("10. should save artifacts", async () => {
      const artifact = await api.saveArtifact(
        runId,
        "e2e_task_2",
        "result.json",
        JSON.stringify({ success: true, output: "test" }),
      );
      expect(artifact.type).toBe("json");
      expect(existsSync(artifact.path)).toBe(true);
    });

    it("11. should list artifacts by run", async () => {
      const artifacts = await api.listArtifactsByRun(runId);
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
    });

    it("12. should append and read events", async () => {
      await api.appendEvent(runId, {
        type: "task_completed",
        runId,
        taskId: "e2e_task_2",
        message: "Task completed successfully",
        details: { durationMs: 1500 },
      });

      const events = await api.readRunEvents(runId);
      expect(events.length).toBeGreaterThanOrEqual(1);
      const completionEvent = events.find(
        (e) => e.type === "task_completed" && e.taskId === "e2e_task_2",
      );
      expect(completionEvent).toBeDefined();
      expect(completionEvent!.message).toContain("completed");
    });

    it("13. should write and read runtime and task logs", async () => {
      const { LogManager } = await import("../../src/core/log-manager.js");
      const lm = new LogManager(testDir);
      await lm.writeRuntime(runId, "E2E run started");
      await lm.writeRuntime(runId, "E2E run completed");
      await lm.writeTaskLog(runId, "e2e_task_1", "Task 1 log entry");

      const runtimeLog = await api.readRuntimeLog(runId);
      expect(runtimeLog).toContain("E2E run started");

      const taskLog = await api.readTaskLog(runId, "e2e_task_1");
      expect(taskLog).toContain("Task 1 log entry");
    });

    it("14. should list log files", async () => {
      const files = await api.listLogFiles(runId);
      expect(files.length).toBeGreaterThan(0);
      const hasRuntimeLog = files.some((f) => f.includes("runtime"));
      expect(hasRuntimeLog).toBe(true);
    });

    it("15. should export workflow", async () => {
      const result = await api.exportWorkflow(runId);
      expect(result.workflow.tasks.length).toBe(3);
      expect(result.yaml).toContain("e2e_task_1");
      expect(result.json).toContain("e2e_task_1");
    });

    it("16. should inspect the run", async () => {
      const inspection = await api.inspectRun(runId);
      expect(inspection.run).not.toBeNull();
      expect(inspection.run!.runId).toBe(runId);
      expect(inspection.tasks).toHaveLength(3);
      expect(inspection.events.length).toBeGreaterThan(0);
      expect(inspection.artifacts.length).toBeGreaterThanOrEqual(1);
    });

    it("17. should save and load run state", async () => {
      await api.saveRunState(runId, {
        runId,
        status: "running",
        progress: { total: 3, done: 1, running: 1, failed: 0, pending: 1 },
        updatedAt: new Date().toISOString(),
      });
      const state = await api.loadRunState(runId);
      expect(state).not.toBeNull();
      expect(state!.progress.done).toBe(1);
      expect(state!.progress.total).toBe(3);
    });

    it("18. should clean run state after completion", async () => {
      await api.updateRunStatus(runId, "completed");
      const run = await api.loadRun(runId);
      expect(run!.status).toBe("completed");
    });

    it("19. should run quality gate", async () => {
      const result = await api.runQualityGate(runId, false, []);
      expect(result).not.toBeNull();
      expect(result!.status).toBe("skipped");
    });

    it("20. should get project status", async () => {
      const status = await api.getProjectStatus();
      expect(status.initialized).toBe(true);
      expect(status.project).not.toBeNull();
      expect(status.state).not.toBeNull();
      expect(status.config).not.toBeNull();
    });
  });

  describe("Workflow diff, validation, reorder", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Workflow E2E test", "auto");
      runId = run.runId;
      const now = new Date().toISOString();
      await api.saveTasks(runId, [
        {
          id: "w_a",
          runId,
          title: "Task A",
          status: "done" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "w_b",
          runId,
          title: "Task B",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "w_c",
          runId,
          title: "Task C",
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
    });

    it("should validate workflow", async () => {
      const valid = await api.workflowValidate({
        runTitle: "Valid workflow",
        tasks: [
          { id: "t1", title: "T1", dependsOn: [], acceptanceCriteria: [] },
          { id: "t2", title: "T2", dependsOn: ["t1"], acceptanceCriteria: [] },
        ],
      });
      expect(valid.valid).toBe(true);
    });

    it("should detect cycles", async () => {
      const valid = await api.workflowValidate({
        runTitle: "Bad workflow",
        tasks: [
          { id: "x", title: "X", dependsOn: ["y"], acceptanceCriteria: [] },
          { id: "y", title: "Y", dependsOn: ["x"], acceptanceCriteria: [] },
        ],
      });
      expect(valid.valid).toBe(false);
      expect(valid.cycles.length).toBeGreaterThan(0);
    });

    it("should reorder tasks", async () => {
      const tasks = await api.loadTasks(runId);
      const ids = tasks.map((t) => t.id);
      const reordered = [ids[2]!, ids[1]!, ids[0]!];
      await api.workflowReorder(runId, reordered);
      const reloaded = await api.loadTasks(runId);
      expect(reloaded[0]!.id).toBe(ids[2]);
    });

    it("should add a task to workflow", async () => {
      const task = await api.workflowAddTask(runId, {
        title: "Task D",
        description: "Added via API",
      });
      expect(task.title).toBe("Task D");
      const allTasks = await api.loadTasks(runId);
      expect(allTasks.length).toBe(4);
    });

    it("should export workflow as JSON", async () => {
      const result = await api.exportWorkflow(runId);
      const parsed = JSON.parse(result.json);
      expect(parsed.tasks.length).toBe(4);
    });
  });

  describe("Checkpoint and database operations", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Checkpoint test", "auto");
      runId = run.runId;
    });

    it("should save a checkpoint state", async () => {
      if (!api.getDatabase()) return;

      const { CheckpointService } = await import("../../src/core/checkpoint-service.js");
      const cs = new CheckpointService(api.getDatabase()!, testDir);
      await cs.saveCheckpoint(runId, {
        runId,
        status: "running",
        progress: { total: 5, done: 2, running: 1, failed: 0, pending: 2 },
      });

      const checkpoints = await api.listCheckpoints(runId);
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    });

    it("should load latest checkpoint", async () => {
      if (!api.getDatabase()) return;
      const result = await api.getLatestCheckpoint(runId);
      if (result) {
        expect(result.state.runId).toBe(runId);
        expect(result.state.status).toBe("running");
      }
    });

    it("should clean old checkpoints", async () => {
      if (!api.getDatabase()) return;
      await api.cleanCheckpoints(runId, 1);
      const checkpoints = await api.listCheckpoints(runId);
      expect(checkpoints.length).toBeLessThanOrEqual(1);
    });
  });

  describe("Error handling", () => {
    it("should return null for non-existent run", async () => {
      const run = await api.loadRun("non_existent_run");
      expect(run).toBeNull();
    });

    it("should return undefined for non-existent task", async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Error test", "auto");
      const task = await api.getTask(run.runId, "non_existent_task");
      expect(task).toBeUndefined();
    });

    it("should return empty array for non-existent run tasks", async () => {
      const tasks = await api.loadTasks("non_existent_run");
      expect(tasks).toEqual([]);
    });

    it("should return empty array for non-existent events", async () => {
      const events = await api.readRunEvents("non_existent_run");
      expect(events).toEqual([]);
    });

    it("should return empty string for non-existent logs", async () => {
      const log = await api.readRuntimeLog("non_existent_run");
      expect(log).toBe("");
    });

    it("should gracefully handle non-initialized project operations", async () => {
      const newApi = new FlowTaskAPI({
        rootPath: mkdtempSync(join(tmpdir(), "flowtask-not-init-")),
      });
      const status = await newApi.getProjectStatus();
      expect(status.initialized).toBe(false);
      expect(status.project).toBeNull();
    });

    it("should not fail on backup without db", async () => {
      const newApi = new FlowTaskAPI({ rootPath: mkdtempSync(join(tmpdir(), "flowtask-no-db-")) });
      const result = await newApi.backupDatabase(join(testDir, "backup.db"));
      expect(result).toBe(false);
    });
  });

  describe("Config and provider operations", () => {
    it("should list config keys", async () => {
      const keys = await api.listConfigKeys();
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain("projectMode");
    });

    it("should get config value by key", async () => {
      const mode = await api.getConfigValue("projectMode");
      expect(mode).toBe("development");
    });

    it("should return undefined for non-existent config key", async () => {
      const val = await api.getConfigValue("does.not.exist");
      expect(val).toBeUndefined();
    });

    it("should set a config value and read it back", async () => {
      const { configJsonPath } = await import("../../src/utils/paths.js");
      const { atomicWriteJsonFile } = await import("../../src/utils/fs.js");
      const cPath = configJsonPath(testDir);
      await atomicWriteJsonFile(cPath, {
        projectMode: "development",
        customKey: "customValue",
        limits: { maxRunMinutes: 120 },
      });
      const val = await api.getConfigValue("customKey");
      expect(val).toBe("customValue");
      const nestedVal = await api.getConfigValue("limits.maxRunMinutes");
      expect(nestedVal).toBe(120);
    });
  });

  describe("Step approval flow", () => {
    let runId: string;
    let taskId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Step approval E2E", "auto");
      runId = run.runId;
      taskId = "step_e2e_task";
      const now = new Date().toISOString();
      await api.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "Task with steps",
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
    });

    it("should save steps requiring approval", async () => {
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      const now = new Date().toISOString();
      await sm.saveSteps(runId, taskId, [
        {
          id: "step_s1",
          taskId,
          runId,
          title: "Safe command",
          type: "command",
          command: "echo hello",
          status: "done",
          requiresApproval: false,
          dependsOn: [],
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "step_s2",
          taskId,
          runId,
          title: "Risky command",
          type: "command",
          command: "rm -rf /tmp/test",
          status: "pending_approval",
          requiresApproval: true,
          dependsOn: [],
          order: 1,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const steps = await api.loadSteps(runId, taskId);
      expect(steps).toHaveLength(2);
    });

    it("should approve step_s2", async () => {
      await api.approveStep(runId, taskId, "step_s2");
      const step = await api.getStep(runId, taskId, "step_s2");
      expect(step!.status).toBe("approved");
    });

    it("should approve all pending steps at once", async () => {
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      const now = new Date().toISOString();
      const existing = await sm.loadSteps(runId, taskId);
      existing.push({
        id: "step_s3",
        taskId,
        runId,
        title: "Another risky step",
        type: "command",
        command: "rm -rf /tmp/other",
        status: "pending_approval",
        requiresApproval: true,
        dependsOn: [],
        order: 2,
        createdAt: now,
        updatedAt: now,
      });
      await sm.saveSteps(runId, taskId, existing);

      const approved = await api.approveAllSteps(runId, taskId);
      expect(approved.length).toBeGreaterThanOrEqual(1);
      const step = await api.getStep(runId, taskId, "step_s3");
      expect(step!.status).toBe("approved");
    });

    it("should deny a step", async () => {
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      const existing = await sm.loadSteps(runId, taskId);
      const s3 = existing.find((s) => s.id === "step_s3");
      if (s3) {
        s3.status = "pending_approval";
        s3.updatedAt = new Date().toISOString();
        await sm.saveSteps(runId, taskId, existing);
      }

      await api.denyStep(runId, taskId, "step_s3");
      const step = await api.getStep(runId, taskId, "step_s3");
      expect(step!.status).toBe("denied");
    });

    it("should update step properties", async () => {
      const updated = await api.updateStep(runId, taskId, "step_s1", {
        title: "Updated safe command",
        command: "echo updated",
      });
      expect(updated.title).toBe("Updated safe command");
      expect(updated.command).toBe("echo updated");
    });

    it("should load all steps for the run", async () => {
      const allSteps = await api.loadAllSteps(runId);
      const steps = allSteps[taskId];
      expect(steps).toBeDefined();
      expect(steps!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Clean runs", () => {
    it("should list runs with status filter", async () => {
      const runs = await api.listRuns();
      expect(runs.length).toBeGreaterThan(0);
    });

    it("should clean with dry-run", async () => {
      const result = await api.cleanRuns({ dryRun: true });
      expect(result.dryRun).toBe(true);
    });
  });

  describe("Interactive input and auto-continue", () => {
    describe("TTY interactive input", () => {
      let runId: string;
      let EnquirerMock: ReturnType<typeof vi.fn>;

      beforeAll(async () => {
        const project = await api.loadProject();
        const run = await api.createRun(project!.projectId, "Interactive E2E", "auto");
        runId = run.runId;
        const now = new Date().toISOString();
        await api.saveTasks(runId, [
          {
            id: "tty_task",
            runId,
            title: "TTY input task",
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
      });

      beforeEach(async () => {
        vi.resetAllMocks();
        const { default: Enquirer } = await import("enquirer");
        EnquirerMock = Enquirer as unknown as ReturnType<typeof vi.fn>;
      });

      it("should prompt inline and accept input in TTY mode", async () => {
        const origIsTTY = process.stdin.isTTY;
        process.stdin.isTTY = true as unknown as boolean;
        try {
          const { RunLifecycle } = await import("../../src/core/run-lifecycle.js");
          const { RunManager } = await import("../../src/core/run-manager.js");
          const { ProjectManager } = await import("../../src/core/project-manager.js");

          const mockInstance = {
            prompt: vi.fn().mockResolvedValue({ response: "inline-answer" }),
          };
          EnquirerMock.mockReturnValue(mockInstance);

          const config = await new ProjectManager().loadConfig(testDir);
          config.defaultExecutor = "shell";
          config.validation = { ...config.validation, skipValidation: true };
          config.approval = { enabled: true, autoApprove: true, requireFor: [] };

          const project = await api.loadProject();
          const lifecycle = new RunLifecycle(testDir, project!.projectId, config);
          lifecycle.setSkipValidation(true);

          const rm = new RunManager(testDir);
          await rm.updateTaskStatus(runId, "tty_task", "waiting_input");

          const cont = await lifecycle.continueRun(runId);

          expect(mockInstance.prompt).toHaveBeenCalled();
          expect(cont.success).toBe(true);
          expect(cont.paused).toBe(false);

          const updated = await rm.loadTasks(runId);
          const task = updated.find((t) => t.id === "tty_task");
          expect(task?.status).toBe("done");
        } finally {
          process.stdin.isTTY = origIsTTY;
        }
      }, 15000);
    });

    describe("Non-TTY fallback", () => {
      let runId: string;

      beforeAll(async () => {
        const project = await api.loadProject();
        const run = await api.createRun(project!.projectId, "Non-TTY E2E", "auto");
        runId = run.runId;
        const now = new Date().toISOString();
        await api.saveTasks(runId, [
          {
            id: "nontty_task",
            runId,
            title: "Non-TTY input task",
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
      });

      it("should fall back to external input in non-TTY mode", async () => {
        const origIsTTY = process.stdin.isTTY;
        process.stdin.isTTY = false as unknown as boolean;
        try {
          const { RunLifecycle } = await import("../../src/core/run-lifecycle.js");
          const { RunManager } = await import("../../src/core/run-manager.js");
          const { ProjectManager } = await import("../../src/core/project-manager.js");

          const config = await new ProjectManager().loadConfig(testDir);
          config.defaultExecutor = "shell";
          config.validation = { ...config.validation, skipValidation: true };
          config.approval = { enabled: true, autoApprove: true, requireFor: [] };

          const project = await api.loadProject();
          const lifecycle = new RunLifecycle(testDir, project!.projectId, config);
          lifecycle.setSkipValidation(true);

          const rm = new RunManager(testDir);
          await rm.updateTaskStatus(runId, "nontty_task", "waiting_input");

          const cont = await lifecycle.continueRun(runId);

          expect(cont.paused).toBe(true);
          expect(cont.success).toBe(true);

          const updated = await rm.loadTasks(runId);
          const task = updated.find((t) => t.id === "nontty_task");
          expect(task?.status).toBe("waiting_input");
        } finally {
          process.stdin.isTTY = origIsTTY;
        }
      });
    });

    describe("Auto-continue multi-step", () => {
      let runId: string;

      beforeAll(async () => {
        const project = await api.loadProject();
        const run = await api.createRun(project!.projectId, "Auto-continue E2E", "auto");
        runId = run.runId;
        const now = new Date().toISOString();
        await api.saveTasks(runId, [
          {
            id: "ac_t1",
            runId,
            title: "Step 1",
            status: "pending" as const,
            executor: "shell",
            dependsOn: [],
            acceptanceCriteria: [],
            retryCount: 0,
            maxRetries: 2,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "ac_t2",
            runId,
            title: "Step 2",
            status: "pending" as const,
            executor: "shell",
            dependsOn: ["ac_t1"],
            acceptanceCriteria: [],
            retryCount: 0,
            maxRetries: 2,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "ac_t3",
            runId,
            title: "Step 3",
            status: "pending" as const,
            executor: "shell",
            dependsOn: ["ac_t2"],
            acceptanceCriteria: [],
            retryCount: 0,
            maxRetries: 2,
            createdAt: now,
            updatedAt: now,
          },
        ]);
      });

      it("should auto-continue to next pending step without pressing Enter", async () => {
        const { RunLifecycle } = await import("../../src/core/run-lifecycle.js");
        const { RunManager } = await import("../../src/core/run-manager.js");
        const { ProjectManager } = await import("../../src/core/project-manager.js");

        const config = await new ProjectManager().loadConfig(testDir);
        config.defaultExecutor = "shell";
        config.validation = { ...config.validation, skipValidation: true };
        config.approval = { enabled: true, autoApprove: true, requireFor: [] };

        const project = await api.loadProject();
        const lifecycle = new RunLifecycle(testDir, project!.projectId, config);
        lifecycle.setSkipValidation(true);

        const rm = new RunManager(testDir);
        await rm.updateTaskStatus(runId, "ac_t1", "done");

        const cont = await lifecycle.continueRun(runId);

        expect(cont.success).toBe(true);
        expect(cont.paused).toBe(false);

        const updated = await rm.loadTasks(runId);
        expect(updated.find((t) => t.id === "ac_t1")?.status).toBe("done");
        expect(updated.find((t) => t.id === "ac_t2")?.status).toBe("done");
        expect(updated.find((t) => t.id === "ac_t3")?.status).toBe("done");
      }, 15000);
    });

    describe("Repeated waiting_input", () => {
      let runId: string;
      let EnquirerMock: ReturnType<typeof vi.fn>;

      beforeAll(async () => {
        const project = await api.loadProject();
        const run = await api.createRun(project!.projectId, "Repeated input E2E", "auto");
        runId = run.runId;
        const now = new Date().toISOString();
        await api.saveTasks(runId, [
          {
            id: "ri_t1",
            runId,
            title: "Input 1",
            status: "pending" as const,
            executor: "shell",
            dependsOn: [],
            acceptanceCriteria: [],
            retryCount: 0,
            maxRetries: 2,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "ri_t2",
            runId,
            title: "Input 2",
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
      });

      beforeEach(async () => {
        vi.resetAllMocks();
        const { default: Enquirer } = await import("enquirer");
        EnquirerMock = Enquirer as unknown as ReturnType<typeof vi.fn>;
      });

      it("should handle repeated waiting_input prompts across multiple tasks", async () => {
        const origIsTTY = process.stdin.isTTY;
        process.stdin.isTTY = true as unknown as boolean;
        try {
          const { RunLifecycle } = await import("../../src/core/run-lifecycle.js");
          const { RunManager } = await import("../../src/core/run-manager.js");
          const { ProjectManager } = await import("../../src/core/project-manager.js");

          const mockInstance = {
            prompt: vi.fn().mockResolvedValue({ response: "go" }),
          };
          EnquirerMock.mockReturnValue(mockInstance);

          const config = await new ProjectManager().loadConfig(testDir);
          config.defaultExecutor = "shell";
          config.validation = { ...config.validation, skipValidation: true };
          config.approval = { enabled: true, autoApprove: true, requireFor: [] };

          const project = await api.loadProject();
          const lifecycle = new RunLifecycle(testDir, project!.projectId, config);
          lifecycle.setSkipValidation(true);

          const rm = new RunManager(testDir);
          await rm.updateTaskStatus(runId, "ri_t1", "waiting_input");
          await rm.updateTaskStatus(runId, "ri_t2", "waiting_input");

          const cont = await lifecycle.continueRun(runId);

          expect(mockInstance.prompt).toHaveBeenCalled();
          expect(cont.success).toBe(true);
          expect(cont.paused).toBe(false);

          const updated = await rm.loadTasks(runId);
          expect(updated.find((t) => t.id === "ri_t1")?.status).toBe("done");
          expect(updated.find((t) => t.id === "ri_t2")?.status).toBe("done");
        } finally {
          process.stdin.isTTY = origIsTTY;
        }
      }, 30000);
    });

    describe("Approval steps", () => {
      let runId: string;

      beforeAll(async () => {
        const project = await api.loadProject();
        const run = await api.createRun(project!.projectId, "Approval E2E", "auto");
        runId = run.runId;
        const now = new Date().toISOString();
        await api.saveTasks(runId, [
          {
            id: "app_task",
            runId,
            title: "Approval needed task",
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
      });

      it("should not auto-continue past a waiting_approval step", async () => {
        const origIsTTY = process.stdin.isTTY;
        process.stdin.isTTY = true as unknown as boolean;
        try {
          const { RunLifecycle } = await import("../../src/core/run-lifecycle.js");
          const { RunManager } = await import("../../src/core/run-manager.js");
          const { ProjectManager } = await import("../../src/core/project-manager.js");

          const config = await new ProjectManager().loadConfig(testDir);
          config.defaultExecutor = "shell";
          config.validation = { ...config.validation, skipValidation: true };
          config.approval = { enabled: true, autoApprove: true, requireFor: [] };

          const project = await api.loadProject();
          const lifecycle = new RunLifecycle(testDir, project!.projectId, config);
          lifecycle.setSkipValidation(true);

          const rm = new RunManager(testDir);
          await rm.updateTaskStatus(runId, "app_task", "waiting_approval");

          const cont = await lifecycle.continueRun(runId);

          expect(cont.paused).toBe(true);

          const updated = await rm.loadTasks(runId);
          const task = updated.find((t) => t.id === "app_task");
          expect(task?.status).toBe("waiting_approval");
        } finally {
          process.stdin.isTTY = origIsTTY;
        }
      });
    });
  });
});
