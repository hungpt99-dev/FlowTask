import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";

// ── Global Package Tests ─────────────────────────────────

describe("FlowTask Installation", () => {
  describe("Global installation assets", () => {
    it("should have a package.json with bin entry for flowtask", () => {
      const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
      expect(pkg.bin).toBeDefined();
      expect(pkg.bin.flowtask).toBeDefined();
      expect(typeof pkg.bin.flowtask).toBe("string");
      expect(pkg.bin.flowtask).toMatch(/^\.\/dist\//);
    });

    it("should have a CLI entry point at src/cli/index.ts", () => {
      expect(existsSync(join(__dirname, "../../src/cli/index.ts"))).toBe(true);
    });

    it("should build dist with runnable binary", () => {
      const distDir = join(__dirname, "../../dist");
      if (existsSync(distDir)) {
        const files = readFileSync(join(distDir, "index.js"), "utf-8");
        expect(files).toContain("#!/usr/bin/env node");
      } else {
        // dist/ not built yet — that's acceptable in dev
        expect(existsSync(join(__dirname, "../../tsup.config.ts"))).toBe(true);
      }
    });

    it("should export FlowTaskAPI from package entry", async () => {
      const mod = await import("../../src/api/flowtask-api.js");
      expect(mod.FlowTaskAPI).toBeDefined();
      expect(typeof mod.FlowTaskAPI).toBe("function");
    });
  });

  // ── Project Init Tests ──────────────────────────────────

  describe("Project initialization", () => {
    let testDir: string;
    let api: FlowTaskAPI;

    beforeAll(() => {
      testDir = mkdtempSync(join(tmpdir(), "flowtask-install-test-"));
      api = new FlowTaskAPI({ rootPath: testDir });
    });

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("should start uninitialized", async () => {
      expect(await api.isInitialized()).toBe(false);
    });

    it("should create .flowtask directory structure", async () => {
      await api.initProject("Test Project", "development");

      expect(existsSync(join(testDir, ".flowtask", "project.json"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "config.json"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "state.json"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "run-index.json"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "task-index.json"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "rules"))).toBe(true);
      expect(existsSync(join(testDir, ".flowtask", "steps"))).toBe(true);
    });

    it("should be initialized after init", async () => {
      expect(await api.isInitialized()).toBe(true);
    });

    it("should store project metadata", async () => {
      const project = await api.loadProject();
      expect(project).not.toBeNull();
      expect(project!.name).toBe("Test Project");
      expect(project!.projectId).toBeTruthy();
      expect(project!.rootPath).toBe(testDir);
      const config = await api.loadConfig();
      expect(config.projectMode).toBe("development");
    });

    it("should have correct default config", async () => {
      const config = await api.loadConfig();
      expect(config.projectMode).toBe("development");
      expect(config.planner).toBeDefined();
      expect(config.planner!.default).toBe("auto");
    });

    it("should init with research mode", async () => {
      const researchDir = mkdtempSync(join(tmpdir(), "flowtask-research-"));
      const researchApi = new FlowTaskAPI({ rootPath: researchDir });
      try {
        await researchApi.initProject("Research", "research");
        const config = await researchApi.loadConfig();
        expect(config.projectMode).toBe("research");
      } finally {
        rmSync(researchDir, { recursive: true, force: true });
      }
    });

    it("should init with writing mode", async () => {
      const writingDir = mkdtempSync(join(tmpdir(), "flowtask-writing-"));
      const writingApi = new FlowTaskAPI({ rootPath: writingDir });
      try {
        await writingApi.initProject("Writing", "writing");
        const config = await writingApi.loadConfig();
        expect(config.projectMode).toBe("writing");
      } finally {
        rmSync(writingDir, { recursive: true, force: true });
      }
    });

    it("should init with general mode", async () => {
      const generalDir = mkdtempSync(join(tmpdir(), "flowtask-general-"));
      const generalApi = new FlowTaskAPI({ rootPath: generalDir });
      try {
        await generalApi.initProject("General", "general");
        const config = await generalApi.loadConfig();
        expect(config.projectMode).toBe("general");
      } finally {
        rmSync(generalDir, { recursive: true, force: true });
      }
    });
  });

  // ── Reinitialization Tests ──────────────────────────────

  describe("Reinitialization with --force", () => {
    let testDir: string;
    let api: FlowTaskAPI;

    beforeAll(async () => {
      testDir = mkdtempSync(join(tmpdir(), "flowtask-reinit-test-"));
      api = new FlowTaskAPI({ rootPath: testDir });
      await api.initProject("Original", "development");
    });

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("should preserve existing .flowtask directory structure after force reinit", async () => {
      const customRule = join(testDir, ".flowtask", "rules", "custom.md");
      writeFileSync(customRule, "# Custom preserved rule\n");

      await api.initProject("Reinitialized", "development", true);

      expect(existsSync(customRule)).toBe(true);
    });

    it("should update project name on force reinit", async () => {
      const project = await api.loadProject();
      expect(project!.name).toBe("Reinitialized");
    });

    it("should preserve existing run index during force reinit", async () => {
      const runIndexPath = join(testDir, ".flowtask", "run-index.json");
      const existing = JSON.parse(readFileSync(runIndexPath, "utf-8"));
      existing.runs.push({
        runId: "preserved-run-001",
        title: "Preserved Run",
        status: "completed",
        mode: "auto",
        createdAt: new Date().toISOString(),
      });
      writeFileSync(runIndexPath, JSON.stringify(existing, null, 2));

      await api.initProject("Again", "development", true);

      const updated = JSON.parse(readFileSync(runIndexPath, "utf-8"));
      expect(updated.runs).toHaveLength(1);
      expect(updated.runs[0].runId).toBe("preserved-run-001");
    });

    it("should preserve existing task index during force reinit", async () => {
      const taskIndexPath = join(testDir, ".flowtask", "task-index.json");
      const existing = JSON.parse(readFileSync(taskIndexPath, "utf-8"));
      existing.tasks.push({
        taskId: "preserved-task-001",
        runId: "preserved-run-001",
        title: "Preserved Task",
        status: "done",
      });
      writeFileSync(taskIndexPath, JSON.stringify(existing, null, 2));

      await api.initProject("Again", "development", true);

      const updated = JSON.parse(readFileSync(taskIndexPath, "utf-8"));
      expect(updated.tasks).toHaveLength(1);
      expect(updated.tasks[0].taskId).toBe("preserved-task-001");
    });

    it("should support multiple force reinitializations", async () => {
      for (let i = 2; i <= 4; i++) {
        await api.initProject(`Reinit-${i}`, "development", true);
        const project = await api.loadProject();
        expect(project!.name).toBe(`Reinit-${i}`);
      }
    });
  });

  // ── Minimal Workflow Run Tests ───────────────────────────

  describe("Minimal workflow run", () => {
    let testDir: string;
    let api: FlowTaskAPI;
    let projectId: string;

    beforeAll(async () => {
      testDir = mkdtempSync(join(tmpdir(), "flowtask-workflow-run-"));
      api = new FlowTaskAPI({ rootPath: testDir });
      const project = await api.initProject("Workflow Test", "development");
      projectId = project.projectId;
    });

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("should validate the minimal example workflow file", async () => {
      const examplePath = join(__dirname, "../../examples/minimal/flowtask.yaml");
      expect(existsSync(examplePath)).toBe(true);

      const { WorkflowManager } = await import("../../src/core/workflow-manager.js");
      const { RunManager } = await import("../../src/core/run-manager.js");
      const { EventStore } = await import("../../src/core/event-store.js");
      const runManager = new RunManager(testDir);
      const eventStore = new EventStore(testDir);
      const wm = new WorkflowManager(testDir, runManager, eventStore);
      const workflow = await wm.loadWorkflowFromFile(examplePath);

      expect(workflow.runTitle).toBe("Hello World Example");
      expect(workflow.tasks).toHaveLength(1);
      const task0 = workflow.tasks[0]!;
      expect(task0.id).toBe("hello_world");
      expect(task0.title).toBe("Print Hello World");
      expect(task0.executor).toBe("shell");

      const validation = wm.validateWorkflow(workflow);
      expect(validation.valid).toBe(true);
    });

    it("should create a run and save tasks from the minimal workflow", async () => {
      const examplePath = join(__dirname, "../../examples/minimal/flowtask.yaml");
      const { WorkflowManager } = await import("../../src/core/workflow-manager.js");
      const { RunManager } = await import("../../src/core/run-manager.js");
      const { EventStore } = await import("../../src/core/event-store.js");
      const runManager = new RunManager(testDir);
      const eventStore = new EventStore(testDir);
      const wm = new WorkflowManager(testDir, runManager, eventStore);
      const workflow = await wm.loadWorkflowFromFile(examplePath);

      const runTitle = workflow.runTitle ?? "Hello World Example";
      const run = await api.createRun(projectId, runTitle, "auto");
      expect(run.status).toBe("created");
      expect(run.title).toBe("Hello World Example");

      const now = new Date().toISOString();
      const tasks = workflow.tasks.map((t) => ({
        id: t.id,
        runId: run.runId,
        title: t.title,
        description: t.description ?? "",
        status: "pending" as const,
        executor: t.executor ?? "shell",
        dependsOn: t.dependsOn ?? [],
        acceptanceCriteria: t.acceptanceCriteria ?? [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      }));

      await api.saveTasks(run.runId, tasks);
      const loaded = await api.loadTasks(run.runId);
      expect(loaded).toHaveLength(1);
      const firstTask = loaded[0]!;
      expect(firstTask.id).toBe("hello_world");
      expect(firstTask.status).toBe("pending");
    });

    it("should transition a shell task through run lifecycle: pending → running → done", async () => {
      const run = await api.createRun(projectId, "Task Lifecycle Test", "auto");

      const now = new Date().toISOString();
      const taskId = "lifecycle_test";
      await api.saveTasks(run.runId, [
        {
          id: taskId,
          runId: run.runId,
          title: "Echo Hello",
          description: "Simple shell echo command",
          status: "pending",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["Output contains Hello"],
          retryCount: 0,
          maxRetries: 1,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      let task = await api.getTask(run.runId, taskId);
      expect(task!.status).toBe("pending");

      task = await api.updateTaskStatus(run.runId, taskId, "running");
      expect(task!.status).toBe("running");

      task = await api.updateTaskStatus(run.runId, taskId, "done");
      expect(task!.status).toBe("done");

      await api.updateRunStatus(run.runId, "completed");
      const loaded = await api.loadRun(run.runId);
      expect(loaded!.status).toBe("completed");
    });

    it("should handle task failure and retry tracking", async () => {
      const run = await api.createRun(projectId, "Failure Test", "manual");

      const now = new Date().toISOString();
      const taskId = "fail_retry_test";
      await api.saveTasks(run.runId, [
        {
          id: taskId,
          runId: run.runId,
          title: "Fail then retry",
          description: "Simulate task failure",
          status: "pending",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["Must pass"],
          retryCount: 0,
          maxRetries: 3,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      let task = await api.getTask(run.runId, taskId);
      expect(task!.retryCount).toBe(0);

      task = await api.updateTaskStatus(run.runId, taskId, "running");
      task = await api.updateTaskStatus(run.runId, taskId, "failed");
      const failed = await api.getTask(run.runId, taskId);
      expect(failed!.status).toBe("failed");

      const timestamp = new Date().toISOString();
      await api.saveTasks(run.runId, [
        {
          ...failed!,
          status: "pending",
          retryCount: (failed!.retryCount ?? 0) + 1,
          updatedAt: timestamp,
        },
      ]);

      const retried = await api.getTask(run.runId, taskId);
      expect(retried!.status).toBe("pending");
      expect(retried!.retryCount).toBe(1);
    });

    it("should create a run with multiple sequential tasks matching dependency model", async () => {
      const run = await api.createRun(projectId, "Sequential Tasks", "auto");

      const now = new Date().toISOString();
      const task1Id = "seq_task_1";
      const task2Id = "seq_task_2";
      const task3Id = "seq_task_3";

      await api.saveTasks(run.runId, [
        {
          id: task1Id,
          runId: run.runId,
          title: "Build",
          description: "Build step",
          status: "done",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["Build succeeds"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: task2Id,
          runId: run.runId,
          title: "Test",
          description: "Test step (depends on Build)",
          status: "running",
          executor: "shell",
          dependsOn: [task1Id],
          acceptanceCriteria: ["Tests pass"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: task3Id,
          runId: run.runId,
          title: "Deploy",
          description: "Deploy step (depends on Test)",
          status: "pending",
          executor: "shell",
          dependsOn: [task2Id],
          acceptanceCriteria: ["Deploy succeeds"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const tasks = await api.loadTasks(run.runId);
      expect(tasks).toHaveLength(3);

      const task1 = tasks.find((t) => t.id === task1Id)!;
      const task2 = tasks.find((t) => t.id === task2Id)!;
      const task3 = tasks.find((t) => t.id === task3Id)!;

      expect(task1.dependsOn).toEqual([]);
      expect(task2.dependsOn).toEqual([task1Id]);
      expect(task3.dependsOn).toEqual([task2Id]);

      expect(task1.status).toBe("done");
      expect(task2.status).toBe("running");
      expect(task3.status).toBe("pending");
    });

    it("should inspect a completed run with full detail", async () => {
      const run = await api.createRun(projectId, "Inspection Test", "auto");
      const now = new Date().toISOString();
      const taskId = "inspect_task";

      await api.saveTasks(run.runId, [
        {
          id: taskId,
          runId: run.runId,
          title: "Inspect me",
          description: "Task for inspection",
          status: "done",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["Done"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await api.updateRunStatus(run.runId, "completed");

      const inspection = await api.inspectRun(run.runId);
      expect(inspection.run).not.toBeNull();
      expect(inspection.run!.runId).toBe(run.runId);
      expect(inspection.run!.status).toBe("completed");
      expect(inspection.tasks).toHaveLength(1);
      const inspectedTask = inspection.tasks[0]!;
      expect(inspectedTask.id).toBe(taskId);
      expect(inspectedTask.status).toBe("done");
    });
  });

  // ── Environment Validation Tests ─────────────────────────

  describe("Environment validation", () => {
    let testDir: string;
    let api: FlowTaskAPI;

    beforeAll(async () => {
      testDir = mkdtempSync(join(tmpdir(), "flowtask-env-test-"));
      api = new FlowTaskAPI({ rootPath: testDir });
      await api.initProject("Env Test", "development");
    });

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("should detect valid Node.js version (22+)", () => {
      const major = parseInt(process.version.slice(1), 10);
      expect(major).toBeGreaterThanOrEqual(22);
    });

    it("should report correct project status", async () => {
      const status = await api.getProjectStatus();
      expect(status.initialized).toBe(true);
      expect(status.project).not.toBeNull();
      expect(status.config).not.toBeNull();
      expect(status.state).not.toBeNull();
    });

    it("should load and verify config", async () => {
      const config = await api.loadConfig();
      expect(config.planner).toBeDefined();
      expect(config.planner!.default).toBeTruthy();
      expect(config.projectMode).toBeDefined();
    });

    it("should have mode rule files matching the project mode", async () => {
      const modeRulePath = join(testDir, ".flowtask", "rules", "mode.md");
      expect(existsSync(modeRulePath)).toBe(true);
      const content = readFileSync(modeRulePath, "utf-8");
      expect(content).toContain("Mode Rules");
    });

    it("should have default step file", async () => {
      const stepsPath = join(testDir, ".flowtask", "steps", "default.md");
      expect(existsSync(stepsPath)).toBe(true);
    });

    it("should load project state", async () => {
      const state = await api.loadProjectState();
      expect(state).not.toBeNull();
      expect(state!.status).toBe("idle");
    });

    it("should update and persist project state", async () => {
      const state = await api.loadProjectState();
      state!.status = "has_running_run";
      state!.activeRunId = "active-run-001";
      await api.saveProjectState(state!);

      const loaded = await api.loadProjectState();
      expect(loaded!.status).toBe("has_running_run");
      expect(loaded!.activeRunId).toBe("active-run-001");

      // Reset
      state!.status = "idle";
      state!.activeRunId = undefined;
      await api.saveProjectState(state!);
    });

    it("should gracefully handle uninitialized state", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "flowtask-empty-"));
      const emptyApi = new FlowTaskAPI({ rootPath: emptyDir });
      try {
        const initialized = await emptyApi.isInitialized();
        expect(initialized).toBe(false);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });
});
