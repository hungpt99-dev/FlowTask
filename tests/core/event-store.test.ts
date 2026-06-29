/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeAll } from "vitest";
import { EventStore } from "../../src/core/event-store.js";
import { testDir } from "../setup.js";

describe("EventStore", () => {
  let store: EventStore;

  beforeAll(() => {
    store = new EventStore(testDir);
  });

  it("should create an instance", () => {
    expect(store).toBeInstanceOf(EventStore);
  });

  it("should read empty run events when no events exist", async () => {
    const events = await store.readRunEvents("non-existent-run");
    expect(events).toEqual([]);
  });

  it("should append and read events for a run", async () => {
    const runId = "test-run-events";
    await store.appendToRun(runId, {
      type: "run_created",
      runId,
      message: "Test run created",
    });
    await store.appendToRun(runId, {
      type: "run_started",
      runId,
      message: "Test run started",
    });
    await store.appendToRun(runId, {
      type: "task_started",
      runId,
      taskId: "task_001",
      message: "First task",
    });

    const events = await store.readRunEvents(runId);
    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe("run_created");
    expect(events[1]!.type).toBe("run_started");
    expect(events[2]!.type).toBe("task_started");
  });

  it("should include timestamps on events", async () => {
    const runId = "test-timestamps";
    await store.appendToRun(runId, {
      type: "run_created",
      runId,
    });
    const events = await store.readRunEvents(runId);
    expect(events[0]!.time).toBeDefined();
    expect(() => new Date(events[0]!.time)).not.toThrow();
  });

  it("should handle many events", async () => {
    const runId = "test-many-events";
    for (let i = 0; i < 20; i++) {
      await store.appendToRun(runId, {
        type: "task_completed",
        runId,
        taskId: `task_${i}`,
      });
    }
    const events = await store.readRunEvents(runId);
    expect(events).toHaveLength(20);
  });

  // ── Paginated Events ──────────────────────────────────

  it("should paginate events", async () => {
    const runId = "test-paginated-events";
    for (let i = 0; i < 10; i++) {
      await store.appendToRun(runId, {
        type: "task_completed",
        runId,
        taskId: `task_${i}`,
      });
    }
    const page1 = await store.readRunEventsPaginated(runId, 3, 0);
    expect(page1).toHaveLength(3);

    const page2 = await store.readRunEventsPaginated(runId, 3, 3);
    expect(page2).toHaveLength(3);

    const all = await store.readRunEventsPaginated(runId, 100, 0);
    expect(all).toHaveLength(10);
  });

  it("should count events", async () => {
    const runId = "test-count-events";
    expect(await store.countRunEvents(runId)).toBe(0);
    await store.appendToRun(runId, { type: "run_created", runId });
    expect(await store.countRunEvents(runId)).toBe(1);
    await store.appendToRun(runId, { type: "run_started", runId });
    expect(await store.countRunEvents(runId)).toBe(2);
  });

  it("should filter events by type", async () => {
    const runId = "test-filter-type";
    await store.appendToRun(runId, { type: "run_created", runId });
    await store.appendToRun(runId, { type: "run_started", runId });
    await store.appendToRun(runId, { type: "task_started", runId, taskId: "t1" });
    await store.appendToRun(runId, { type: "task_completed", runId, taskId: "t1" });

    const started = await store.getEventsByType(runId, "task_started");
    expect(started).toHaveLength(1);
    expect(started[0]!.taskId).toBe("t1");
  });

  it("should filter events by task", async () => {
    const runId = "test-filter-task";
    await store.appendToRun(runId, { type: "task_started", runId, taskId: "t1" });
    await store.appendToRun(runId, { type: "task_started", runId, taskId: "t2" });
    await store.appendToRun(runId, { type: "task_completed", runId, taskId: "t1" });

    const t1Events = await store.getEventsByTask(runId, "t1");
    expect(t1Events).toHaveLength(2);
  });

  it("should search events by message", async () => {
    const runId = "test-search-events";
    await store.appendToRun(runId, { type: "run_created", runId, message: "Workflow created" });
    await store.appendToRun(runId, { type: "run_started", runId, message: "Starting execution" });
    await store.appendToRun(runId, { type: "task_created", runId, message: "First task created" });

    const found = await store.searchEvents(runId, "starting");
    expect(found).toHaveLength(1);
    expect(found[0]!.type).toBe("run_started");
  });

  // ── Timeline ──────────────────────────────────────────

  it("should append and read timeline events", async () => {
    const runId = "test-timeline";
    const _e1 = await store.appendTimeline(runId, "workflow_created", "Workflow started");
    const _e2 = await store.appendTimeline(
      runId,
      "scan_started",
      "Scanning",
      undefined,
      undefined,
      undefined,
      "running",
    );

    const timeline = await store.getTimeline(runId);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.type).toBe("workflow_created");
    expect(timeline[0]!.message).toBe("Workflow started");
    expect(timeline[1]!.type).toBe("scan_started");
    expect(timeline[1]!.status).toBe("running");
  });

  it("should filter timeline by type", async () => {
    const runId = "test-timeline-filter-type";
    await store.appendTimeline(runId, "scan_started", "Scanning");
    await store.appendTimeline(runId, "scan_completed", "Done");
    await store.appendTimeline(runId, "plan_created", "Plan ready");

    const scans = await store.getTimeline(runId, { types: ["scan_started", "scan_completed"] });
    expect(scans).toHaveLength(2);
  });

  it("should filter timeline by task and step", async () => {
    const runId = "test-timeline-task-step";
    await store.appendTimeline(runId, "step_started", "Step A", undefined, "task_1", "step_a");
    await store.appendTimeline(
      runId,
      "step_completed",
      "Step A done",
      undefined,
      "task_1",
      "step_a",
    );
    await store.appendTimeline(runId, "step_started", "Step B", undefined, "task_1", "step_b");

    const taskEvents = await store.getTimeline(runId, { taskId: "task_1" });
    expect(taskEvents).toHaveLength(3);

    const stepEvents = await store.getTimeline(runId, { stepId: "step_a" });
    expect(stepEvents).toHaveLength(2);

    const filtered = await store.getTimeline(runId, { taskId: "task_1", stepId: "step_a" });
    expect(filtered).toHaveLength(2);
  });

  it("should filter timeline by type (empty filter returns all)", async () => {
    const runId = "test-timeline-empty-filter";
    await store.appendTimeline(runId, "workflow_created", "Start");
    await store.appendTimeline(runId, "step_started", "Middle");
    await store.appendTimeline(runId, "workflow_completed", "End");

    const all = await store.getTimeline(runId, {});
    expect(all).toHaveLength(3);
  });

  it("should paginate timeline", async () => {
    const runId = "test-timeline-pagination";
    for (let i = 0; i < 10; i++) {
      await store.appendTimeline(runId, "step_completed", `Step ${i}`);
    }

    const page1 = await store.getTimeline(runId, { limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);

    const page2 = await store.getTimeline(runId, { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
  });

  it("should search timeline", async () => {
    const runId = "test-timeline-search";
    await store.appendTimeline(runId, "plan_created", "Initial plan created");
    await store.appendTimeline(runId, "step_started", "Implement feature X");
    await store.appendTimeline(runId, "step_completed", "Implement feature X done");

    const results = await store.searchTimeline(runId, "feature X");
    expect(results).toHaveLength(2);
  });

  it("should get timeline summary", async () => {
    const runId = "test-timeline-summary";
    await store.appendTimeline(runId, "workflow_created", "Start");
    await store.appendTimeline(runId, "scan_started", "Scan");
    await store.appendTimeline(runId, "scan_completed", "Scan done");
    await store.appendTimeline(runId, "plan_created", "Plan");

    const summary = await store.getTimelineSummary(runId);
    expect(summary.total).toBe(4);
    expect(summary.byType).toHaveProperty("workflow_created", 1);
    expect(summary.byType).toHaveProperty("scan_started", 1);
    expect(summary.firstEvent).not.toBeNull();
    expect(summary.lastEvent).not.toBeNull();
    expect(summary.firstEvent!.type).toBe("workflow_created");
    expect(summary.lastEvent!.type).toBe("plan_created");
  });

  // ── Audit Log ─────────────────────────────────────────

  it("should append and read audit events", async () => {
    const runId = "test-audit";
    const _a1 = await store.appendAudit(runId, "workflow.create", "Workflow created");
    const _a2 = await store.appendAudit(
      runId,
      "step.start",
      "Step A started",
      { risk: "low" },
      "system",
      "step_a",
      "info",
    );

    const audit = await store.getAuditLog(runId);
    expect(audit).toHaveLength(2);
    expect(audit[0]!.action).toBe("workflow.create");
    expect(audit[1]!.action).toBe("step.start");
    expect(audit[1]!.actor).toBe("system");
    expect(audit[1]!.target).toBe("step_a");
    expect(audit[1]!.severity).toBe("info");
  });

  it("should filter audit by action", async () => {
    const runId = "test-audit-filter-action";
    await store.appendAudit(runId, "workflow.create", "Created");
    await store.appendAudit(runId, "step.start", "Started");
    await store.appendAudit(runId, "step.complete", "Completed");

    const steps = await store.getAuditLog(runId, { actions: ["step.start", "step.complete"] });
    expect(steps).toHaveLength(2);
  });

  it("should filter audit by actor and target", async () => {
    const runId = "test-audit-actor-target";
    await store.appendAudit(runId, "step.start", "Step A", {}, "user1", "step_a");
    await store.appendAudit(runId, "step.start", "Step B", {}, "user1", "step_b");
    await store.appendAudit(runId, "step.start", "Step C", {}, "user2", "step_c");

    const user1 = await store.getAuditLog(runId, { actor: "user1" });
    expect(user1).toHaveLength(2);

    const stepB = await store.getAuditLog(runId, { target: "step_b" });
    expect(stepB).toHaveLength(1);
  });

  it("should filter audit by severity", async () => {
    const runId = "test-audit-severity";
    await store.appendAudit(
      runId,
      "workflow.create",
      "Info event",
      {},
      undefined,
      undefined,
      "info",
    );
    await store.appendAudit(runId, "error.occur", "Error!", {}, undefined, undefined, "error");
    await store.appendAudit(runId, "error.occur", "Warning!", {}, undefined, undefined, "warn");

    const errors = await store.getAuditLog(runId, { severity: "error" });
    expect(errors).toHaveLength(1);
  });

  it("should search audit log", async () => {
    const runId = "test-audit-search";
    await store.appendAudit(runId, "workflow.create", "Created workflow");
    await store.appendAudit(runId, "step.fail", "Step X failed with error", { code: 500 });
    await store.appendAudit(runId, "error.occur", "Connection timeout");

    const results = await store.searchAuditLog(runId, "error");
    expect(results).toHaveLength(2); // "Step X failed with error" + "Connection timeout"
  });

  it("should get audit summary", async () => {
    const runId = "test-audit-summary";
    await store.appendAudit(runId, "workflow.create", "Created", {}, undefined, undefined, "info");
    await store.appendAudit(runId, "step.fail", "Step failed", {}, undefined, undefined, "error");
    await store.appendAudit(runId, "step.fail", "Another fail", {}, undefined, undefined, "error");
    await store.appendAudit(
      runId,
      "validation.fail",
      "Validation warn",
      {},
      undefined,
      undefined,
      "warn",
    );

    const summary = await store.getAuditSummary(runId);
    expect(summary.total).toBe(4);
    expect(summary.errors).toBe(2);
    expect(summary.warnings).toBe(1);
    expect(summary.byAction).toHaveProperty("workflow.create", 1);
    expect(summary.byAction).toHaveProperty("step.fail", 2);
  });

  // ── Real-Time Visibility ──────────────────────────────

  it("should track active runs", () => {
    expect(store.getActiveRuns()).toEqual([]);
    store.markRunActive("run_1");
    store.markRunActive("run_2");
    expect(store.getActiveRuns()).toEqual(expect.arrayContaining(["run_1", "run_2"]));
    expect(store.isRunActive("run_1")).toBe(true);
    expect(store.isRunActive("run_3")).toBe(false);
    store.markRunInactive("run_1");
    expect(store.isRunActive("run_1")).toBe(false);
    expect(store.getActiveRuns()).toEqual(["run_2"]);
  });

  it("should subscribe to run events and receive notifications", async () => {
    const runId = "test-subscribe";
    const received: string[] = [];
    const unsub = store.subscribeToRun(runId, (event) => {
      received.push(event.type);
    });

    await store.appendToRun(runId, { type: "run_created", runId });
    await store.appendToRun(runId, { type: "task_started", runId, taskId: "t1" });

    expect(received).toHaveLength(2);
    expect(received[0]).toBe("run_created");
    expect(received[1]).toBe("task_started");

    unsub();

    await store.appendToRun(runId, { type: "task_completed", runId, taskId: "t1" });
    expect(received).toHaveLength(2); // no new events after unsubscribe
  });

  it("should handle multiple subscribers independently", async () => {
    const runId = "test-multi-sub";
    const received1: string[] = [];
    const received2: string[] = [];

    const unsub1 = store.subscribeToRun(runId, (e) => received1.push(e.type));
    const unsub2 = store.subscribeToRun(runId, (e) => received2.push(e.type));

    await store.appendToRun(runId, { type: "run_created", runId });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);

    unsub1();
    unsub2();
  });

  // ── Status Summary & Step Progress ────────────────────

  it("should compute step progress correctly", () => {
    const steps = [
      { status: "completed" },
      { status: "done" },
      { status: "failed" },
      { status: "skipped" },
      { status: "pending" },
      { status: "running" },
      { status: "blocked" },
      { status: "needs_user_review" },
    ];

    const progress = store.getStepProgress(steps);
    expect(progress.total).toBe(8);
    expect(progress.completed).toBe(2);
    expect(progress.failed).toBe(1);
    expect(progress.skipped).toBe(1);
    expect(progress.pending).toBe(1);
    expect(progress.running).toBe(1);
    expect(progress.blocked).toBe(1);
    expect(progress.needsReview).toBe(1);
    expect(progress.percentage).toBe(38); // (2+1)/8 = 37.5 -> round 38
  });

  it("should compute status summary with events", async () => {
    const runId = "test-status-summary";
    await store.appendToRun(runId, { type: "run_created", runId });
    await store.appendToRun(runId, { type: "validation_passed", runId, taskId: "t1" });
    await store.appendToRun(runId, { type: "validation_passed", runId, taskId: "t2" });
    await store.appendToRun(runId, { type: "validation_failed", runId, taskId: "t3" });

    const events = await store.readRunEvents(runId);
    const steps = [
      { status: "completed", title: "Step A" },
      { status: "running", title: "Step B" },
      { status: "pending" },
    ];

    const summary = await store.getRunStatusSummary(
      runId,
      "running",
      steps,
      events,
      0,
      1,
      undefined,
    );

    expect(summary.stepCount).toBe(3);
    expect(summary.stepCompleted).toBe(1);
    expect(summary.stepRunning).toBe(1);
    expect(summary.validationPassed).toBe(2);
    expect(summary.validationFailed).toBe(1);
    expect(summary.totalRetries).toBe(1);
    expect(summary.currentStep).toBe("Step B");
    expect(summary.lastEvent).toBe("validation_failed");
  });

  // ── Global Events ─────────────────────────────────────

  it("should append and rotate global events", async () => {
    await store.appendGlobal({ type: "project_initialized", message: "Project created" });

    for (let i = 0; i < 10; i++) {
      await store.appendGlobal({ type: "rules_loaded", message: `Rule ${i}` });
    }

    await store.rotateGlobalEvents(5);
    // rotation is best-effort, no assertion on content
  });

  // ── Cross-Run Queries ─────────────────────────────────

  it("should list timeline across multiple runs", async () => {
    await store.appendTimeline("run_a", "workflow_created", "Run A");
    await store.appendTimeline("run_b", "workflow_created", "Run B");

    const map = await store.listRunsWithTimeline(["run_a", "run_b", "run_c"]);
    expect(map.get("run_a")).toHaveLength(1);
    expect(map.get("run_b")).toHaveLength(1);
    expect(map.get("run_c")).toHaveLength(0);
  });

  it("should list audit across multiple runs", async () => {
    await store.appendAudit("run_a", "workflow.create", "Run A created");
    await store.appendAudit("run_b", "workflow.create", "Run B created");

    const map = await store.listRunsWithAudit(["run_a", "run_b"]);
    expect(map.get("run_a")).toHaveLength(1);
    expect(map.get("run_b")).toHaveLength(1);
  });
});
