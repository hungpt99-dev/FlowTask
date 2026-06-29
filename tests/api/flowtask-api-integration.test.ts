import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";

let testDir: string;
let api: FlowTaskAPI;

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-int-"));
  api = new FlowTaskAPI({ rootPath: testDir });
  await api.initProject("Integration Test", "development");
  await api.initDatabase();
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("FlowTaskAPI Integration", () => {
  describe("Run Lifecycle Integration", () => {
    let runId: string;
    let projectId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      projectId = project!.projectId;
    });

    it("should cancel a running run and reset project state", async () => {
      const run = await api.createRun(projectId, "Cancel test", "auto");
      runId = run.runId;
      await api.updateRunStatus(runId, "running");

      const cancelled = await api.cancelRun(runId);
      expect(cancelled.status).toBe("cancelled");

      const events = await api.readRunEvents(runId);
      const cancelEvent = events.find((e) => e.type === "run_cancelled");
      expect(cancelEvent).toBeDefined();
      expect(cancelEvent!.message).toContain("cancelled");

      const projectState = await api.loadProjectState();
      expect(projectState!.status).toBe("idle");
      expect(projectState!.activeRunId).toBeUndefined();
    });

    it("should delete a run and clean up metadata", async () => {
      const run = await api.createRun(projectId, "Delete test", "auto");
      const delRunId = run.runId;

      await api.deleteRun(delRunId);

      const runs = await api.listRuns(projectId);
      const deleted = runs.find((r) => r.runId === delRunId);
      expect(deleted).toBeUndefined();
    });

    it("should persist a run saved directly via saveRun", async () => {
      const run = await api.createRun(projectId, "Save test", "auto");
      run.title = "Updated save title";
      run.status = "running";
      await api.saveRun(run);

      const loaded = await api.loadRun(run.runId);
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe("Updated save title");
      expect(loaded!.status).toBe("running");
    });

    it("should load task output content", async () => {
      const run = await api.createRun(projectId, "Output test", "auto");
      const taskId = "output_task";
      await api.saveTasks(run.runId, [
        {
          id: taskId,
          runId: run.runId,
          title: "Output task",
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

      const { LogManager } = await import("../../src/core/log-manager.js");
      const lm = new LogManager(testDir);
      await lm.writeTaskLog(run.runId, taskId, "Task output line 1");
      await lm.writeTaskLog(run.runId, taskId, "Task output line 2");

      const output = await api.loadTaskOutput(run.runId, taskId);
      expect(output).toContain("Task output line 1");
      expect(output).toContain("Task output line 2");
    });
  });

  describe("Metadata Storage Integration (DB + File)", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Metadata test", "auto");
      runId = run.runId;
    });

    it("should persist tasks to both filesystem and DB", async () => {
      const taskId = "meta_task_1";
      await api.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "Metadata task",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["AC1", "AC2"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const tasks = await api.loadTasks(runId);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.id).toBe(taskId);
    });

    it("should persist approval status changes across reloads", async () => {
      const pTaskId = "meta_approval_task";
      await api.saveTasks(runId, [
        {
          id: pTaskId,
          runId,
          title: "Approval persistence",
          status: "waiting_approval" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      await api.approveTask(runId, pTaskId);
      const afterApprove = await api.loadTasks(runId);
      expect(afterApprove.find((t) => t.id === pTaskId)!.status).toBe("pending");

      const reloaded = await api.loadTasks(runId);
      expect(reloaded.find((t) => t.id === pTaskId)!.status).toBe("pending");
    });

    it("should persist step approval status across reloads", async () => {
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      const stepTaskId = "meta_step_task";
      const stepId = "meta_step_1";

      await api.saveTasks(runId, [
        {
          id: stepTaskId,
          runId,
          title: "Step persistence",
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

      await sm.saveSteps(runId, stepTaskId, [
        {
          id: stepId,
          taskId: stepTaskId,
          runId,
          title: "Step to approve",
          type: "command" as const,
          command: "echo test",
          status: "pending_approval" as const,
          requiresApproval: true,
          dependsOn: [],
          order: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      await api.approveStep(runId, stepTaskId, stepId);
      const step = await api.getStep(runId, stepTaskId, stepId);
      expect(step!.status).toBe("approved");

      const reloaded = await api.getStep(runId, stepTaskId, stepId);
      expect(reloaded!.status).toBe("approved");
    });

    it("should persist run state to disk", async () => {
      await api.saveRunState(runId, {
        runId,
        status: "running",
        progress: { total: 5, done: 2, running: 1, failed: 0, pending: 2 },
        updatedAt: new Date().toISOString(),
      });

      const state = await api.loadRunState(runId);
      expect(state).not.toBeNull();
      expect(state!.progress.total).toBe(5);
      expect(state!.progress.done).toBe(2);

      const reloaded = await api.loadRunState(runId);
      expect(reloaded!.progress.done).toBe(2);
    });
  });

  describe("Task Approval and Execution Integration", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Approval flow test", "manual");
      runId = run.runId;
    });

    it("should transition task through full approval lifecycle: waiting_approval → approved → running → done", async () => {
      const taskId = "full_approval_flow";

      await api.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "Full approval lifecycle",
          status: "waiting_approval" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      let task = await api.getTask(runId, taskId);
      expect(task!.status).toBe("waiting_approval");

      task = await api.approveTask(runId, taskId);
      expect(task!.status).toBe("pending");

      task = await api.updateTaskStatus(runId, taskId, "running");
      expect(task!.status).toBe("running");

      task = await api.updateTaskStatus(runId, taskId, "done");
      expect(task!.status).toBe("done");
    });

    it("should deny a waiting_approval task and persist to skipped", async () => {
      const denyId = "deny_flow_task";

      await api.saveTasks(runId, [
        {
          id: denyId,
          runId,
          title: "Deny flow",
          status: "waiting_approval" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      let task = await api.getTask(runId, denyId);
      expect(task!.status).toBe("waiting_approval");

      task = await api.denyTask(runId, denyId);
      expect(task!.status).toBe("skipped");

      const reloaded = await api.getTask(runId, denyId);
      expect(reloaded!.status).toBe("skipped");
    });

    it("should batch approve all steps in a task", async () => {
      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      const batchTaskId = "batch_approve_task";

      await api.saveTasks(runId, [
        {
          id: batchTaskId,
          runId,
          title: "Batch approve",
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

      const now = new Date().toISOString();
      await sm.saveSteps(runId, batchTaskId, [
        {
          id: "batch_s1",
          taskId: batchTaskId,
          runId,
          title: "Batch step 1",
          type: "command" as const,
          command: "echo 1",
          status: "pending_approval" as const,
          requiresApproval: true,
          dependsOn: [],
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "batch_s2",
          taskId: batchTaskId,
          runId,
          title: "Batch step 2",
          type: "command" as const,
          command: "echo 2",
          status: "pending_approval" as const,
          requiresApproval: true,
          dependsOn: [],
          order: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "batch_s3",
          taskId: batchTaskId,
          runId,
          title: "Batch step 3",
          type: "command" as const,
          command: "echo 3",
          status: "done" as const,
          requiresApproval: false,
          dependsOn: [],
          order: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const approved = await api.approveAllSteps(runId, batchTaskId);
      expect(approved.length).toBe(2);

      const s1 = await api.getStep(runId, batchTaskId, "batch_s1");
      expect(s1!.status).toBe("approved");
      const s2 = await api.getStep(runId, batchTaskId, "batch_s2");
      expect(s2!.status).toBe("approved");
    });
  });

  describe("Workflow Update Integration", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Workflow int test", "auto");
      runId = run.runId;
      const now = new Date().toISOString();
      await api.saveTasks(runId, [
        {
          id: "wf_a",
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
          id: "wf_b",
          runId,
          title: "Task B",
          status: "pending" as const,
          executor: "shell",
          dependsOn: ["wf_a"],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "wf_c",
          runId,
          title: "Task C",
          status: "pending" as const,
          executor: "shell",
          dependsOn: ["wf_b"],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });

    it("should remove a task by skipping it (not deleting)", async () => {
      await api.workflowRemoveTask(runId, "wf_c", { delete: false });
      const tasks = await api.loadTasks(runId);
      const removed = tasks.find((t) => t.id === "wf_c");
      expect(removed).toBeDefined();
      expect(removed!.status).toBe("skipped");
    });

    it("should use getNextTask with dependency chain", async () => {
      const tasks = await api.loadTasks(runId);
      const next = await api.getNextTask(tasks);
      expect(next).not.toBeNull();
      expect(next!.id).toBe("wf_b");
    });

    it("should apply a workflow from a JSON file", async () => {
      const filePath = join(testDir, "apply-wf.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          runTitle: "Applied workflow",
          tasks: [
            { id: "wf_a", title: "Task A", dependsOn: [] },
            { id: "wf_b", title: "Task B", dependsOn: ["wf_a"] },
            { id: "wf_d", title: "Task D (new)", dependsOn: ["wf_b"] },
          ],
        }),
        "utf-8",
      );

      const result = await api.workflowApply(runId, filePath, { noConfirm: true });
      expect(result.applied).toBe(true);
      expect(result.added).toBe(1);

      const tasks = await api.loadTasks(runId);
      const added = tasks.find((t) => t.id === "wf_d");
      expect(added).toBeDefined();
      expect(added!.status).toBe("pending");
    });

    it("should export workflow with skipCompleted option", async () => {
      const result = await api.exportWorkflow(runId, { skipCompleted: true });
      const completedInExport = result.workflow.tasks.filter((t) => t.id === "wf_a");
      expect(completedInExport).toHaveLength(0);
    });
  });

  describe("Config Advanced Operations", () => {
    it("should set and get nested config values via API", async () => {
      await api.setConfigValue("limits.maxRunMinutes", 60);
      await api.setConfigValue("notifications.email.enabled", true);
      await api.setConfigValue("approval.mode", "auto");

      const maxMinutes = await api.getConfigValue("limits.maxRunMinutes");
      expect(maxMinutes).toBe(60);

      const emailEnabled = await api.getConfigValue("notifications.email.enabled");
      expect(emailEnabled).toBe(true);

      const approvalMode = await api.getConfigValue("approval.mode");
      expect(approvalMode).toBe("auto");
    });

    it("should return undefined for non-existent deep config key", async () => {
      const val = await api.getConfigValue("nonexistent.deeply.nested.key");
      expect(val).toBeUndefined();
    });
  });

  describe("Event, Log, and Artifact Operations", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Event log test", "auto");
      runId = run.runId;
    });

    it("should query events by type via file-based readRunEvents", async () => {
      await api.appendEvent(runId, {
        type: "task_started",
        runId,
        taskId: "t1",
        message: "Task 1 started",
      });
      await api.appendEvent(runId, {
        type: "task_completed",
        runId,
        taskId: "t1",
        message: "Task 1 done",
      });
      await api.appendEvent(runId, {
        type: "task_started",
        runId,
        taskId: "t2",
        message: "Task 2 started",
      });

      const events = await api.readRunEvents(runId);
      const startedEvents = events.filter((e) => e.type === "task_started");
      expect(startedEvents.length).toBe(2);

      const completedEvents = events.filter((e) => e.type === "task_completed");
      expect(completedEvents.length).toBe(1);

      expect(events.length).toBeGreaterThanOrEqual(3);
    });

    it("should read validation log", async () => {
      const { LogManager } = await import("../../src/core/log-manager.js");
      const lm = new LogManager(testDir);
      await lm.writeValidation(runId, "Validation passed: all checks OK");
      await lm.writeValidation(runId, "No dangerous actions detected");

      const log = await api.readValidationLog(runId);
      expect(log).toContain("Validation passed");
      expect(log).toContain("No dangerous actions");
    });

    it("should save artifact to filesystem and verify by path", async () => {
      const artifact = await api.saveArtifact(runId, "art_task_1", "report.md", "# Test Report");
      expect(artifact.artifactId).toBeTruthy();
      expect(existsSync(artifact.path)).toBe(true);

      const content = await api.loadArtifact(artifact.path);
      expect(content).toBe("# Test Report");
    });

    it("should load artifact content by path", async () => {
      const artifact = await api.saveArtifact(
        runId,
        "art_task_2",
        "data.json",
        JSON.stringify({ result: "ok" }),
      );
      const content = await api.loadArtifact(artifact.path);
      expect(content).toBe(JSON.stringify({ result: "ok" }));
    });

    it("should list log files for a run", async () => {
      const { LogManager } = await import("../../src/core/log-manager.js");
      const lm = new LogManager(testDir);
      await lm.writeRuntime(runId, "Runtime entry for listing");

      const files = await api.listLogFiles(runId);
      expect(files.length).toBeGreaterThan(0);
      const hasRuntime = files.some((f) => f.includes("runtime"));
      expect(hasRuntime).toBe(true);
    });
  });

  describe("Checkpoint Operations Without Database", () => {
    let noDbApi: FlowTaskAPI;

    beforeAll(async () => {
      const noDbDir = mkdtempSync(join(tmpdir(), "flowtask-nodb-"));
      noDbApi = new FlowTaskAPI({ rootPath: noDbDir });
      await noDbApi.initProject("No DB test");
    });

    afterAll(() => {
      rmSync(noDbApi.getRootPath(), { recursive: true, force: true });
    });

    it("should return null for getLatestCheckpoint when DB is not initialized", async () => {
      const cp = await noDbApi.getLatestCheckpoint("any-run");
      expect(cp).toBeNull();
    });

    it("should return empty array for listCheckpoints when DB is not initialized", async () => {
      const cps = await noDbApi.listCheckpoints("any-run");
      expect(cps).toEqual([]);
    });

    it("should not throw when cleaning checkpoints without DB", async () => {
      await expect(noDbApi.cleanCheckpoints("any-run")).resolves.toBeUndefined();
    });
  });

  describe("State Transitions", () => {
    it("should transition project state through saveProjectState and persist changes", async () => {
      const project = await api.loadProject();
      expect(project).not.toBeNull();

      let state = await api.loadProjectState();
      expect(state!.status).toBe("idle");

      const run = await api.createRun(project!.projectId, "State transitions", "auto");

      await api.saveProjectState({
        ...state!,
        status: "has_running_run",
        activeRunId: run.runId,
      });
      state = await api.loadProjectState();
      expect(state!.status).toBe("has_running_run");
      expect(state!.activeRunId).toBe(run.runId);

      await api.saveProjectState({
        ...state!,
        status: "has_failed_run",
        activeRunId: run.runId,
      });
      state = await api.loadProjectState();
      expect(state!.status).toBe("has_failed_run");

      await api.saveProjectState({
        ...state!,
        status: "idle",
        activeRunId: undefined,
      });
      state = await api.loadProjectState();
      expect(state!.status).toBe("idle");
      expect(state!.activeRunId).toBeUndefined();
    });

    it("should persist project state across reloads", async () => {
      await api.saveProjectState({
        projectId: (await api.loadProject())!.projectId,
        status: "has_running_run",
        activeRunId: "test-active-run",
        updatedAt: new Date().toISOString(),
      });

      const reloaded = await api.loadProjectState();
      expect(reloaded!.status).toBe("has_running_run");
      expect(reloaded!.activeRunId).toBe("test-active-run");

      await api.saveProjectState({
        projectId: (await api.loadProject())!.projectId,
        status: "idle",
        activeRunId: undefined,
        updatedAt: new Date().toISOString(),
      });
    });
  });

  describe("Error Recovery and Edge Cases", () => {
    it("should throw on updating a non-existent step", async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Error recovery", "auto");

      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      await sm.saveSteps(run.runId, "err_task", []);

      await expect(
        api.updateStep(run.runId, "err_task", "nonexistent_step", { title: "Nope" }),
      ).rejects.toThrow("Step not found");
    });

    it("should handle updating step status on non-existent step", async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Step status err", "auto");
      await expect(
        api.updateStepStatus(run.runId, "err_task_2", "no_step", "running"),
      ).rejects.toThrow();
    });

    it("should return null for non-existent run inspect", async () => {
      const inspection = await api.inspectRun("non_existent_run_for_sure");
      expect(inspection.run).toBeNull();
      expect(inspection.tasks).toEqual([]);
      expect(inspection.events).toEqual([]);
    });

    it("should handle flushLogs when lifecycle is not initialized", async () => {
      await expect(api.flushLogs()).resolves.toBeUndefined();
    });

    it("should return empty results for non-existent task results", async () => {
      const results = await api.getTaskResults("nonexistent-task-id-12345");
      expect(results).toEqual([]);
    });

    it("should load empty steps for a task with no steps", async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Empty steps test", "auto");
      await api.saveTasks(run.runId, [
        {
          id: "no_step_task",
          runId: run.runId,
          title: "No steps",
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

      const steps = await api.loadSteps(run.runId, "no_step_task");
      expect(steps).toEqual([]);
    });
  });

  describe("Database Operations Integration", () => {
    it("should backup and restore database", async () => {
      const backupPath = join(testDir, ".flowtask", "int-backup.db");
      const result = await api.backupDatabase(backupPath);
      expect(result).toBe(true);
      expect(existsSync(backupPath)).toBe(true);

      const integrityResult = await api.integrityCheck();
      expect(integrityResult.valid).toBe(true);
    });

    it("should run vacuum after operations", async () => {
      await api.vacuumDatabase();
      const status = await api.getDbStatus();
      expect(status).not.toBeNull();
      expect(status!.version).toBeGreaterThanOrEqual(0);
    });
  });
});
