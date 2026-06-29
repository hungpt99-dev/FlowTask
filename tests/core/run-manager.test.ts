import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { RunManager } from "../../src/core/run-manager.js";
import { testDir } from "../setup.js";

describe("RunManager", () => {
  let manager: RunManager;

  beforeAll(() => {
    manager = new RunManager(testDir);
  });

  it("should create a run with correct structure", async () => {
    const run = await manager.createRun("test-project", "Test implementation", "auto");
    expect(run.runId).toBeTruthy();
    expect(run.projectId).toBe("test-project");
    expect(run.title).toBe("Test implementation");
    expect(run.status).toBe("created");
    expect(run.mode).toBe("auto");
  });

  it("should load a created run", async () => {
    const run = await manager.createRun("test-project", "Load test", "auto");
    const loaded = await manager.loadRun(run.runId);
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe(run.runId);
    expect(loaded!.title).toBe("Load test");
  });

  it("should return null for non-existent run", async () => {
    const loaded = await manager.loadRun("non-existent-run-id");
    expect(loaded).toBeNull();
  });

  it("should save and update a run", async () => {
    const run = await manager.createRun("test-project", "Update test", "auto");
    const updated = { ...run, status: "running" as const, updatedAt: new Date().toISOString() };
    await manager.saveRun(updated);
    const loaded = await manager.loadRun(run.runId);
    expect(loaded!.status).toBe("running");
  });

  it("should save and load tasks", async () => {
    const run = await manager.createRun("test-project", "Task test", "auto");
    const tasks = [
      {
        id: "task_001",
        runId: run.runId,
        title: "First task",
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
    await manager.saveTasks(run.runId, tasks);
    const loaded = await manager.loadTasks(run.runId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.title).toBe("First task");
  });

  it("should update a task with partial fields", async () => {
    const run = await manager.createRun("test-project", "Update task test", "auto");
    const tasks = [
      {
        id: "task_001",
        runId: run.runId,
        title: "Original title",
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
    await manager.saveTasks(run.runId, tasks);

    const updated = await manager.updateTask(run.runId, "task_001", {
      title: "Updated title",
      description: "New description",
      executor: "opencode",
      acceptanceCriteria: ["AC1", "AC2"],
    });

    expect(updated.title).toBe("Updated title");
    expect(updated.description).toBe("New description");
    expect(updated.executor).toBe("opencode");
    expect(updated.acceptanceCriteria).toEqual(["AC1", "AC2"]);

    const loaded = await manager.loadTasks(run.runId);
    expect(loaded[0]!.title).toBe("Updated title");
    expect(loaded[0]!.description).toBe("New description");
  });

  it("should throw when updating a non-existent task", async () => {
    const run = await manager.createRun("test-project", "Update non-existent", "auto");
    await expect(manager.updateTask(run.runId, "nonexistent", { title: "New" })).rejects.toThrow(
      "Task not found",
    );
  });

  it("should get next pending task", async () => {
    const run = await manager.createRun("test-project", "Next task test", "auto");
    const tasks = [
      {
        id: "task_001",
        runId: run.runId,
        title: "Task one",
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
        id: "task_002",
        runId: run.runId,
        title: "Task two",
        status: "pending" as const,
        executor: "shell",
        dependsOn: ["task_001"],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    await manager.saveTasks(run.runId, tasks);
    const loaded = await manager.loadTasks(run.runId);
    const next = manager.getNextTask(loaded);
    expect(next).not.toBeNull();
    expect(next!.title).toBe("Task two");
  });

  // ── Run History / Search / Filter ─────────────────────

  describe("run history and search", () => {
    let run1: Awaited<ReturnType<typeof manager.createRun>>;
    let run2: Awaited<ReturnType<typeof manager.createRun>>;

    beforeEach(async () => {
      run1 = await manager.createRun(
        "test-project",
        "First feature implementation",
        "auto",
        "Implement feature X",
      );
      run2 = await manager.createRun(
        "test-project",
        "Bug fix for login",
        "manual",
        "Fix login bug",
      );
      await manager.createRun("test-project", "Documentation update", "auto", "Update docs");
    });

    it("should search runs by title", async () => {
      const results = await manager.searchRuns("feature");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.runId === run1.runId)).toBe(true);
    });

    it("should search runs by user goal", async () => {
      const results = await manager.searchRuns("Implement feature");
      expect(results.some((r) => r.runId === run1.runId)).toBe(true);
    });

    it("should filter runs by status", async () => {
      await manager.updateRunStatus(run1.runId, "completed");
      const results = await manager.filterRuns({ status: "created" });
      expect(results.some((r) => r.runId === run1.runId)).toBe(false);
      expect(results.some((r) => r.runId === run2.runId)).toBe(true);
    });

    it("should filter runs by mode", async () => {
      const results = await manager.filterRuns({ mode: "manual" });
      expect(results.some((r) => r.runId === run2.runId)).toBe(true);
      expect(results.every((r) => r.mode === "manual")).toBe(true);
    });

    it("should filter runs by search query", async () => {
      const results = await manager.filterRuns({ searchQuery: "bug fix" });
      expect(results.some((r) => r.runId === run2.runId)).toBe(true);
    });

    it("should filter runs with limit and offset", async () => {
      const results = await manager.filterRuns({ limit: 2, offset: 0 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should get run timeline", async () => {
      await manager.appendTimelineEvent(run1.runId, "workflow_created", "Run started");
      const timeline = await manager.getRunTimeline(run1.runId);
      expect(timeline.length).toBeGreaterThanOrEqual(1);
    });

    it("should add and retrieve run errors", async () => {
      await manager.addRunError(run1.runId, {
        message: "Test error occurred",
        stepId: "step_001",
      });
      const errors = await manager.getRunErrors(run1.runId);
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toBe("Test error occurred");
    });

    it("should add and retrieve run approvals", async () => {
      await manager.addRunApproval(run1.runId, {
        type: "plan",
        status: "pending",
      });
      const approvals = await manager.getRunApprovals(run1.runId);
      expect(approvals.length).toBe(1);
      expect(approvals[0]!.status).toBe("pending");
    });

    it("should resolve run approvals", async () => {
      await manager.addRunApproval(run1.runId, {
        id: "approval_001",
        type: "step",
        status: "pending",
      });
      await manager.resolveRunApproval(run1.runId, "approval_001", "approved");
      const approvals = await manager.getRunApprovals(run1.runId);
      const resolved = approvals.find((a) => a.id === "approval_001");
      expect(resolved?.status).toBe("approved");
      expect(resolved?.resolvedAt).toBeTruthy();
    });

    it("should track file changes", async () => {
      await manager.addRunFileChange(run1.runId, {
        path: "src/test.ts",
        type: "created",
        expected: true,
      });
      await manager.addRunFileChange(run1.runId, {
        path: "src/old.ts",
        type: "deleted",
      });
      const changes = await manager.getRunFileChanges(run1.runId);
      expect(changes.length).toBe(2);
      expect(changes[0]!.path).toBe("src/test.ts");
    });

    it("should increment retry count", async () => {
      await manager.incrementRunRetryCount(run1.runId);
      await manager.incrementRunRetryCount(run1.runId);
      const run = await manager.loadRun(run1.runId);
      expect(run?.retryCount).toBe(2);
    });

    it("should set user goal", async () => {
      await manager.setUserGoal(run1.runId, "New goal");
      const run = await manager.loadRun(run1.runId);
      expect(run?.userGoal).toBe("New goal");
    });

    it("should update cost usage", async () => {
      await manager.updateCostUsage(run1.runId, {
        totalCost: 0.05,
        currency: "USD",
      });
      const cost = await manager.getRunCostUsage(run1.runId);
      expect(cost).not.toBeNull();
      expect(cost!.totalCost).toBe(0.05);
    });

    it("should update token usage", async () => {
      await manager.updateTokenUsage(run1.runId, {
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
      });
      const tokens = await manager.getRunTokenUsage(run1.runId);
      expect(tokens).not.toBeNull();
      expect(tokens!.totalTokens).toBe(700);
    });

    it("should update run metadata", async () => {
      await manager.updateRunMetadata(run1.runId, { key: "value", nested: { a: 1 } });
      const run = await manager.loadRun(run1.runId);
      expect(run?.metadata?.key).toBe("value");
    });

    it("should handle userGoal in createRun", async () => {
      const run = await manager.createRun(
        "test-project",
        "Custom goal test",
        "auto",
        "Custom user goal",
      );
      expect(run.userGoal).toBe("Custom user goal");
    });

    it("should get run timeline for run without timeline", async () => {
      const timeline = await manager.getRunTimeline("nonexistent");
      expect(timeline).toEqual([]);
    });

    it("should return empty errors for non-existent run", async () => {
      const errors = await manager.getRunErrors("nonexistent");
      expect(errors).toEqual([]);
    });
  });

  // ── Duplicate Run ─────────────────────────────────────

  describe("duplicateRun", () => {
    it("should duplicate a run with tasks", async () => {
      const source = await manager.createRun("test-project", "Source run", "auto");
      const tasks = [
        {
          id: "task_001",
          runId: source.runId,
          title: "Source task",
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
      await manager.saveTasks(source.runId, tasks);

      const duplicate = await manager.duplicateRun(source.runId, "Duplicated run");
      expect(duplicate.title).toBe("Duplicated run");
      expect(duplicate.status).toBe("created");
      expect(duplicate.runId).not.toBe(source.runId);

      const dupTasks = await manager.loadTasks(duplicate.runId);
      expect(dupTasks.length).toBe(1);
      expect(dupTasks[0]!.title).toBe("Source task");
    });

    it("should throw for non-existent source run", async () => {
      await expect(manager.duplicateRun("nonexistent")).rejects.toThrow("Source run not found");
    });

    it("should duplicate without tasks when requested", async () => {
      const source = await manager.createRun("test-project", "Source no tasks", "auto");
      const duplicate = await manager.duplicateRun(source.runId, "No tasks", {
        includeTasks: false,
      });
      const dupTasks = await manager.loadTasks(duplicate.runId);
      expect(dupTasks.length).toBe(0);
    });
  });

  // ── Compare Runs ──────────────────────────────────────

  describe("compareRuns", () => {
    it("should compare two runs", async () => {
      const runA = await manager.createRun("test-project", "Compare A", "auto");
      const runB = await manager.createRun("test-project", "Compare B", "manual");

      await manager.updateRunStatus(runA.runId, "completed");

      const comparison = await manager.compareRuns(runA.runId, runB.runId);
      expect(comparison.sameProject).toBe(true);
      expect(comparison.run1.status).toBe("completed");
      expect(comparison.run2.status).toBe("created");
    });

    it("should throw for non-existent runs", async () => {
      const run = await manager.createRun("test-project", "Compare target", "auto");
      await expect(manager.compareRuns("nonexistent", run.runId)).rejects.toThrow("Run not found");
      await expect(manager.compareRuns(run.runId, "nonexistent")).rejects.toThrow("Run not found");
    });

    it("should provide detailed comparison with task diff", async () => {
      const runA = await manager.createRun("test-project", "Detailed A", "auto");
      const runB = await manager.createRun("test-project", "Detailed B", "auto");

      const tasksA = [
        {
          id: "task_shared",
          runId: runA.runId,
          title: "Shared task",
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
          id: "task_only_a",
          runId: runA.runId,
          title: "Only in A",
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
      await manager.saveTasks(runA.runId, tasksA);

      const tasksB = [
        {
          id: "task_shared",
          runId: runB.runId,
          title: "Shared task",
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
          id: "task_only_b",
          runId: runB.runId,
          title: "Only in B",
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
      await manager.saveTasks(runB.runId, tasksB);

      const detailed = await manager.compareRunsDetailed(runA.runId, runB.runId);
      expect(detailed.taskDiff.onlyIn1.length).toBe(1);
      expect(detailed.taskDiff.onlyIn1[0]!.id).toBe("task_only_a");
      expect(detailed.taskDiff.onlyIn2.length).toBe(1);
      expect(detailed.taskDiff.onlyIn2[0]!.id).toBe("task_only_b");

      const shared = detailed.taskDiff.both.find((b) => b.id === "task_shared");
      expect(shared).toBeDefined();
      expect(shared!.changed).toBe(true);
      expect(shared!.status1).toBe("done");
      expect(shared!.status2).toBe("pending");
    });
  });

  // ── Export Run ────────────────────────────────────────

  describe("exportRun", () => {
    it("should export a run as JSON", async () => {
      const run = await manager.createRun("test-project", "Export test", "auto");
      const tasks = [
        {
          id: "task_export",
          runId: run.runId,
          title: "Export task",
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
      await manager.saveTasks(run.runId, tasks);

      const { data, content } = await manager.exportRun(run.runId, "json");
      expect(data.run.runId).toBe(run.runId);
      expect(data.tasks).toHaveLength(1);
      expect(content).toContain(run.runId);

      const parsed = JSON.parse(content);
      expect(parsed.run.title).toBe("Export test");
      expect(parsed.exportVersion).toBe("1.0");
    });

    it("should throw for non-existent run export", async () => {
      await expect(manager.exportRun("nonexistent")).rejects.toThrow("Run not found");
    });

    it("should export to file", async () => {
      const run = await manager.createRun("test-project", "File export test", "auto");
      const outPath = `${testDir}/exported-run.json`;
      const result = await manager.exportRunToFile(run.runId, outPath);
      expect(result).toBe(outPath);

      const { readTextFile } = await import("../../src/utils/fs.js");
      const content = await readTextFile(outPath);
      const parsed = JSON.parse(content);
      expect(parsed.run.runId).toBe(run.runId);
    });
  });

  // ── Timeline & Events ────────────────────────────────

  describe("timeline and events", () => {
    it("should append timeline events in order", async () => {
      const run = await manager.createRun("test-project", "Timeline test", "auto");
      await manager.appendTimelineEvent(run.runId, "scan_started", "Scanning workspace");
      await manager.appendTimelineEvent(run.runId, "scan_completed", "Scan completed");
      await manager.appendTimelineEvent(run.runId, "plan_created", "Plan created");

      const timeline = await manager.getRunTimeline(run.runId);
      expect(timeline.length).toBe(4); // 1 initial + 3 new
      expect(timeline[3]!.type).toBe("plan_created");
    });
  });

  // ── Update Run Status ────────────────────────────────

  describe("updateRunStatus", () => {
    it("should set startedAt on first transition to running", async () => {
      const run = await manager.createRun("test-project", "StartedAt test", "auto");
      const updated = await manager.updateRunStatus(run.runId, "running");
      expect(updated.startedAt).toBeTruthy();
    });

    it("should set finishedAt and duration on terminal status", async () => {
      const run = await manager.createRun("test-project", "Duration test", "auto");
      await manager.updateRunStatus(run.runId, "running");
      // Small delay to ensure duration > 0
      await new Promise((r) => setTimeout(r, 5));
      const updated = await manager.updateRunStatus(run.runId, "completed");
      expect(updated.finishedAt).toBeTruthy();
      expect(updated.durationMs).toBeGreaterThan(0);
    });
  });

  // ── Delete Run Data ──────────────────────────────────

  describe("deleteRunData", () => {
    it("should delete run data and remove from index", async () => {
      const run = await manager.createRun("test-project", "Delete test", "auto");
      await manager.deleteRunData(run.runId);

      const loaded = await manager.loadRun(run.runId);
      expect(loaded).toBeNull();

      const runs = await manager.listRuns();
      expect(runs.some((r) => r.runId === run.runId)).toBe(false);
    });
  });

  // ── SavePlan ──────────────────────────────────────────

  describe("savePlan", () => {
    it("should save plan markdown to run", async () => {
      const run = await manager.createRun("test-project", "Plan test", "auto");
      const planContent = "# Plan\n\n1. Step one\n2. Step two";
      await manager.savePlan(run.runId, planContent);

      const loaded = await manager.loadRun(run.runId);
      expect(loaded?.planMd).toBe(planContent);
    });
  });

  // ── Save Final Report ────────────────────────────────

  describe("saveFinalReport", () => {
    it("should save final report content", async () => {
      const run = await manager.createRun("test-project", "Report test", "auto");
      const reportContent = "# Final Report\n\nAll tasks completed.";
      await manager.saveFinalReport(run.runId, reportContent);

      const report = await manager.getRunFinalReport(run.runId);
      expect(report).toContain("All tasks completed");

      const loaded = await manager.loadRun(run.runId);
      expect(loaded?.finalReportMd).toBe(reportContent);
      expect(loaded?.finalReportPath).toBeTruthy();
    });
  });

  // ── Run Logs ─────────────────────────────────────────

  describe("run logs", () => {
    it("should list log files for a run", async () => {
      const run = await manager.createRun("test-project", "Log test", "auto");
      const files = await manager.listRunLogFiles(run.runId);
      expect(Array.isArray(files)).toBe(true);
    });

    it("should get run log content", async () => {
      const run = await manager.createRun("test-project", "Log content test", "auto");
      const content = await manager.getRunLogContent(run.runId, "runtime");
      expect(typeof content).toBe("string");
    });
  });
});
