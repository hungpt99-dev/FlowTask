/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from "vitest";
import { FinalReportGenerator, type ReportData } from "../../src/core/final-report.js";
import type { Run, TimelineEvent, RunApproval, RunError } from "../../src/schemas/run.schema.js";
import type { Task } from "../../src/schemas/task.schema.js";
import type { Step } from "../../src/schemas/step.schema.js";
import type { ArtifactRecord } from "../../src/schemas/artifact.schema.js";
import type { ValidationResult } from "../../src/schemas/validation.schema.js";
import type { FileChange } from "../../src/core/file-tracker.js";
import type { FlowTaskEvent } from "../../src/schemas/event.schema.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    runId: "run-1",
    projectId: "proj-1",
    title: "Test workflow",
    status: "succeeded",
    mode: "auto",
    userGoal: "Implement user authentication",
    taskCount: 4,
    completedTaskCount: 3,
    startedAt: "2025-01-01T00:00:00.000Z",
    finishedAt: "2025-01-01T01:00:00.000Z",
    durationMs: 3600000,
    costUsage: { totalCost: 0.05, currency: "USD", byProvider: { openai: 0.05 } },
    tokenUsage: { inputTokens: 10000, outputTokens: 2000, totalTokens: 12000 },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T01:00:00.000Z",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "task-1",
    runId: "run-1",
    title: "Some task",
    description: "A description",
    status: "done",
    executor: "shell",
    dependsOn: [],
    acceptanceCriteria: [],
    retryCount: 0,
    maxRetries: 2,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:30:00.000Z",
    ...overrides,
  };
}

function makeStep(overrides: Partial<Step>): Step {
  return {
    id: "step-1",
    taskId: "task-1",
    runId: "run-1",
    title: "Step 1",
    type: "command",
    status: "succeeded",
    order: 1,
    dependsOn: [],
    requiresApproval: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:30:00.000Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    artifactId: "art-1",
    runId: "run-1",
    title: "auth.ts",
    type: "created_file",
    path: "/project/src/auth.ts",
    filePath: "src/auth.ts",
    fileSize: 1024,
    origin: "expected",
    validationStatus: "passed",
    createdAt: "2025-01-01T00:00:00.000Z",
    modifiedAt: "2025-01-01T00:30:00.000Z",
    ...overrides,
  };
}

function makeValidation(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    taskId: "task-1",
    status: "passed",
    checks: [
      { type: "process", status: "passed", message: "Process exited with code 0" },
      { type: "file", status: "passed", message: "Required file exists" },
    ],
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFileChange(overrides: Partial<FileChange> = {}): FileChange {
  return {
    changeId: "change-1",
    runId: "run-1",
    type: "created",
    filePath: "src/auth.ts",
    category: "expected",
    summary: "Created src/auth.ts",
    detectedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("FinalReportGenerator", () => {
  const gen = new FinalReportGenerator();

  it("generates report data with all sections populated", () => {
    const tasks: Task[] = [
      makeTask({ id: "t1", title: "Task A", status: "done", executor: "shell", retryCount: 0 }),
      makeTask({
        id: "t2",
        title: "Task B",
        status: "failed",
        executor: "opencode",
        retryCount: 2,
      }),
      makeTask({ id: "t3", title: "Task C", status: "skipped", executor: "shell", retryCount: 0 }),
      makeTask({ id: "t4", title: "Task D", status: "pending", executor: "shell", retryCount: 0 }),
    ];

    const steps: Step[] = [
      makeStep({ id: "s1", taskId: "t1", title: "Implement auth", status: "succeeded" }),
      makeStep({
        id: "s2",
        taskId: "t2",
        title: "Write tests",
        status: "failed",
        errors: [{ message: "Test failed", timestamp: "2025-01-01T00:00:00.000Z", retryCount: 2 }],
      }),
    ];

    const artifacts: ArtifactRecord[] = [
      makeArtifact({
        title: "auth.ts",
        type: "created_file",
        origin: "expected",
        validationStatus: "passed",
      }),
      makeArtifact({
        title: "login.tsx",
        type: "created_file",
        origin: "expected",
        validationStatus: "passed",
      }),
      makeArtifact({
        title: "debug.log",
        type: "log",
        origin: "unexpected",
        validationStatus: "pending",
      }),
    ];

    const fileChanges: FileChange[] = [
      makeFileChange({ filePath: "src/auth.ts", type: "created", category: "expected" }),
      makeFileChange({ filePath: "src/login.tsx", type: "created", category: "expected" }),
      makeFileChange({ filePath: "src/debug.log", type: "created", category: "unexpected" }),
    ];

    const validations: ValidationResult[] = [
      makeValidation({
        taskId: "t1",
        status: "passed",
        checks: [
          { type: "process", status: "passed", message: "Ok" },
          { type: "file", status: "passed", message: "File exists" },
        ],
      }),
      makeValidation({
        taskId: "t2",
        status: "failed",
        checks: [
          { type: "process", status: "passed", message: "Ok" },
          { type: "file", status: "failed", message: "Missing file" },
        ],
        confidence: 0.5,
        failureReason: "Required file not found",
      }),
    ];

    const timelineEvents: TimelineEvent[] = [
      { type: "workflow_created", timestamp: "2025-01-01T00:00:00.000Z" },
      { type: "step_started", timestamp: "2025-01-01T00:01:00.000Z" },
      { type: "step_completed", timestamp: "2025-01-01T00:30:00.000Z" },
      { type: "workflow_completed", timestamp: "2025-01-01T01:00:00.000Z" },
    ];

    const approvals: RunApproval[] = [
      {
        id: "a1",
        type: "plan",
        status: "approved",
        requestedAt: "2025-01-01T00:00:00.000Z",
        resolvedAt: "2025-01-01T00:00:05.000Z",
      },
    ];

    const runErrors: RunError[] = [
      {
        taskId: "t2",
        message: "Task B failed",
        timestamp: "2025-01-01T00:45:00.000Z",
        retryCount: 2,
        suggestedFix: "Check test configuration",
      },
    ];

    const report = gen.generateReportData({
      run: makeRun(),
      tasks,
      steps,
      artifacts,
      fileChanges,
      validations,
      events: [],
      timeline: timelineEvents,
      approvals,
      runErrors,
      workflowState: null,
      auditSummary: { total: 5, errors: 1, warnings: 2 },
    });

    expect(report.runId).toBe("run-1");
    expect(report.title).toBe("Test workflow");
    expect(report.status).toBe("succeeded");
    expect(report.userGoal).toBe("Implement user authentication");

    // Step counts
    expect(report.totalSteps).toBe(4);
    expect(report.stepsExecuted).toBe(1);
    expect(report.stepsFailed).toBe(1);
    expect(report.stepsSkipped).toBe(1);
    expect(report.stepsPending).toBe(1);

    // Summary
    expect(report.summary).toContain("1/4 tasks completed");
    expect(report.summary).toContain("1 failed");
    expect(report.summary).toContain("1 skipped");

    // Step details
    expect(report.stepDetails).toHaveLength(4);
    expect(report.stepDetails[0]!.status).toBe("done");
    expect(report.stepDetails[1]!.status).toBe("failed");
    expect(report.stepDetails[1]!.retryCount).toBe(2);

    // Artifacts
    expect(report.artifactSummary.total).toBe(3);
    expect(report.artifactSummary.expected).toBe(2);
    expect(report.artifactSummary.unexpected).toBe(1);
    expect(report.artifacts[0]!.origin).toBe("expected");
    expect(report.artifacts[2]!.origin).toBe("unexpected");

    // File changes
    expect(report.fileChangeSummary.total).toBe(3);
    expect(report.fileChangeSummary.expected).toBe(2);
    expect(report.fileChangeSummary.unexpected).toBe(1);

    // Validation
    expect(report.validationSummary.total).toBe(2);
    expect(report.validationSummary.passed).toBe(1);
    expect(report.validationSummary.failed).toBe(1);

    // Approvals
    expect(report.approvalSummary.total).toBe(1);
    expect(report.approvalSummary.approved).toBe(1);

    // Errors
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.message).toBe("Task B failed");

    // Retry history
    expect(report.retryHistory.total).toBe(1);
    expect(report.retryHistory.byTask[0]!.taskTitle).toBe("Task B");

    // Cost & Tokens
    expect(report.costUsage).toBeDefined();
    expect(report.costUsage!.totalCost).toBe(0.05);
    expect(report.tokenUsage!.totalTokens).toBe(12000);

    // Duration
    expect(report.duration.durationMs).toBe(3600000);

    // Timeline
    expect(report.timeline.total).toBe(4);

    // Audit
    expect(report.auditSummary).toBeDefined();
    expect(report.auditSummary!.total).toBe(5);
  });

  it("handles empty data gracefully", () => {
    const noCostRun = makeRun({ status: "created" });
    delete (noCostRun as Record<string, unknown>).costUsage;
    delete (noCostRun as Record<string, unknown>).tokenUsage;

    const report = gen.generateReportData({
      run: noCostRun,
      tasks: [],
      steps: [],
      artifacts: [],
      fileChanges: [],
      validations: [],
      events: [],
      timeline: [],
      approvals: [],
      runErrors: [],
      workflowState: null,
      auditSummary: null,
    });

    expect(report.totalSteps).toBe(0);
    expect(report.stepsExecuted).toBe(0);
    expect(report.stepsFailed).toBe(0);
    expect(report.artifactSummary.total).toBe(0);
    expect(report.validationSummary.total).toBe(0);
    expect(report.approvalSummary.total).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(report.retryHistory.total).toBe(0);
    expect(report.costUsage).toBeUndefined();
    expect(report.tokenUsage).toBeUndefined();
  });

  it("includes remaining issues when there are failures", () => {
    const tasks: Task[] = [
      makeTask({ id: "t1", title: "Task A", status: "done" }),
      makeTask({ id: "t2", title: "Task B", status: "failed" }),
      makeTask({ id: "t3", title: "Task C", status: "skipped" }),
    ];

    const approvals: RunApproval[] = [
      { id: "a1", type: "step", status: "rejected", requestedAt: "2025-01-01T00:00:00.000Z" },
    ];

    const report = gen.generateReportData({
      run: makeRun({ status: "failed" }),
      tasks,
      steps: [],
      artifacts: [],
      fileChanges: [],
      validations: [makeValidation({ taskId: "t2", status: "failed" })],
      events: [],
      timeline: [],
      approvals,
      runErrors: [],
      workflowState: null,
      auditSummary: null,
    });

    expect(report.remainingIssues.length).toBeGreaterThan(0);
    expect(report.remainingIssues.some((i) => i.includes("failed"))).toBe(true);
    expect(report.remainingIssues.some((i) => i.includes("skipped"))).toBe(true);
  });

  it("generates markdown with all sections", () => {
    const report = gen.generateReportData({
      run: makeRun(),
      tasks: [
        makeTask({ id: "t1", title: "Task A", status: "done", executor: "shell" }),
        makeTask({ id: "t2", title: "Task B", status: "failed", executor: "opencode" }),
      ],
      steps: [],
      artifacts: [makeArtifact({ title: "auth.ts", type: "created_file", origin: "expected" })],
      fileChanges: [
        makeFileChange({ filePath: "src/auth.ts", type: "created", category: "expected" }),
      ],
      validations: [makeValidation({ taskId: "t1", status: "passed" })],
      events: [],
      timeline: [
        { type: "workflow_created", timestamp: "2025-01-01T00:00:00.000Z" },
        { type: "workflow_completed", timestamp: "2025-01-01T01:00:00.000Z" },
      ],
      approvals: [
        { id: "a1", type: "plan", status: "approved", requestedAt: "2025-01-01T00:00:00.000Z" },
      ],
      runErrors: [
        { taskId: "t2", message: "Task B failed", timestamp: "2025-01-01T00:45:00.000Z" },
      ],
      workflowState: null,
      auditSummary: { total: 3, errors: 1, warnings: 1 },
    });

    const md = gen.generateMarkdown(report);

    expect(md).toContain("# Final Report");
    expect(md).toContain("## 1. Run Summary");
    expect(md).toContain("## 2. Steps");
    expect(md).toContain("## 3. Artifacts");
    expect(md).toContain("## 4. File Changes");
    expect(md).toContain("## 5. Validation");
    expect(md).toContain("## 6. Approvals");
    expect(md).toContain("## 7. Errors");
    expect(md).toContain("## 8. Cost & Token Usage");
    expect(md).toContain("## 9. Audit Summary");
    expect(md).toContain("## 10. Timeline");
    expect(md).toContain("## 11. Remaining Issues");
    expect(md).toContain("## 12. Recommended Next Actions");
    expect(md).toContain("flowtask retry");
    expect(md).toContain("Task B");

    // Verify key data is present
    expect(md).toContain("Test workflow");
    expect(md).toContain("run-1");
    expect(md).toContain("✅ Succeeded");
    expect(md).toContain("auth.ts");
    expect(md).toContain("0.050000 USD");
    expect(md).toContain("12,000");
  });

  it("generateMarkdown handles minimal report without sections that have no data", () => {
    const report = gen.generateReportData({
      run: makeRun({
        status: "created",
        userGoal: undefined,
        costUsage: undefined,
        tokenUsage: undefined,
      }),
      tasks: [makeTask({ id: "t1", title: "Task A", status: "done" })],
      steps: [],
      artifacts: [],
      fileChanges: [],
      validations: [],
      events: [],
      timeline: [],
      approvals: [],
      runErrors: [],
      workflowState: null,
      auditSummary: null,
    });

    const md = gen.generateMarkdown(report);

    expect(md).toContain("# Final Report");
    expect(md).toContain("## 1. Run Summary");
    expect(md).toContain("## 2. Steps");
    expect(md).not.toContain("## 7. Errors");
    expect(md).not.toContain("## 8. Cost & Token Usage");
    expect(md).not.toContain("## 9. Audit Summary");
    expect(md).not.toContain("## 11. Remaining Issues");
  });

  it("buildTaskRunSummary handles all task statuses correctly", () => {
    const tasks: Task[] = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "failed" }),
      makeTask({ id: "t3", status: "skipped" }),
      makeTask({ id: "t4", status: "cancelled" }),
      makeTask({ id: "t5", status: "pending" }),
    ];

    const report = gen.generateReportData({
      run: makeRun({ status: "partially_completed" }),
      tasks,
      steps: [],
      artifacts: [],
      fileChanges: [],
      validations: [],
      events: [],
      timeline: [],
      approvals: [],
      runErrors: [],
      workflowState: null,
      auditSummary: null,
    });

    expect(report.summary).toContain("1/5 tasks completed");
    expect(report.summary).toContain("1 failed");
    expect(report.summary).toContain("1 skipped");
    expect(report.summary).toContain("1 cancelled");
    expect(report.summary).toContain("1 pending");
  });

  it("includes next actions for failed runs", () => {
    const tasks: Task[] = [makeTask({ id: "t1", title: "Failed Task", status: "failed" })];

    const report = gen.generateReportData({
      run: makeRun({ status: "failed" }),
      tasks,
      steps: [],
      artifacts: [],
      fileChanges: [],
      validations: [],
      events: [],
      timeline: [],
      approvals: [],
      runErrors: [],
      workflowState: null,
      auditSummary: null,
    });

    expect(report.nextActions.some((a) => a.includes("flowtask retry"))).toBe(true);
  });

  it("includes next actions for completed successful runs", () => {
    const tasks: Task[] = [makeTask({ id: "t1", status: "done" })];

    const report = gen.generateReportData({
      run: makeRun({ status: "succeeded" }),
      tasks,
      steps: [],
      artifacts: [],
      fileChanges: [],
      validations: [],
      events: [],
      timeline: [],
      approvals: [],
      runErrors: [],
      workflowState: null,
      auditSummary: null,
    });

    expect(report.nextActions.some((a) => a.includes("flowtask duplicate"))).toBe(true);
    expect(report.nextActions.some((a) => a.includes("flowtask export"))).toBe(true);
  });

  it("includes next actions for cancelled runs", () => {
    const report = gen.generateReportData({
      run: makeRun({ status: "cancelled" }),
      tasks: [],
      steps: [],
      artifacts: [],
      fileChanges: [],
      validations: [],
      events: [],
      timeline: [],
      approvals: [],
      runErrors: [],
      workflowState: null,
      auditSummary: null,
    });

    expect(report.nextActions.some((a) => a.includes("flowtask duplicate"))).toBe(true);
  });

  it("generates report with workflow lifecycle data", () => {
    const timelineEvents: TimelineEvent[] = [
      { type: "workflow_created", timestamp: "2025-01-01T00:00:00.000Z" },
      { type: "workflow_running", timestamp: "2025-01-01T00:01:00.000Z" },
      { type: "step_started", timestamp: "2025-01-01T00:02:00.000Z" },
      { type: "workflow_completed", timestamp: "2025-01-01T01:00:00.000Z" },
    ];

    const report = gen.generateReportData({
      run: makeRun({ status: "succeeded" }),
      tasks: [],
      steps: [],
      artifacts: [],
      fileChanges: [],
      validations: [],
      events: [],
      timeline: timelineEvents,
      approvals: [],
      runErrors: [],
      workflowState: {
        runId: "run-1",
        status: "succeeded",
        retryCount: 0,
        errorCount: 0,
        lifecycle: [
          {
            type: "workflow_created",
            timestamp: "2025-01-01T00:00:00.000Z",
            workflowStatus: "created",
          },
          {
            type: "workflow_paused",
            timestamp: "2025-01-01T00:01:00.000Z",
            workflowStatus: "paused",
          },
          {
            type: "workflow_resumed",
            timestamp: "2025-01-01T00:02:00.000Z",
            workflowStatus: "running",
          },
          {
            type: "workflow_completed",
            timestamp: "2025-01-01T01:00:00.000Z",
            workflowStatus: "succeeded",
          },
        ],
        updatedAt: "2025-01-01T01:00:00.000Z",
      },
      auditSummary: null,
    });

    expect(report.workflowLifecycle).toBeDefined();
    expect(report.workflowLifecycle!.totalEvents).toBe(4);
  });

  it("properly populates validation summary with failures", () => {
    const validations: ValidationResult[] = [
      makeValidation({
        taskId: "t1",
        status: "failed",
        checks: [
          { type: "process", status: "passed", message: "Ok" },
          { type: "file", status: "failed", message: "Missing required output" },
        ],
        confidence: 0.3,
        failureReason: "Validation failed: missing file",
      }),
    ];

    const report = gen.generateReportData({
      run: makeRun({ status: "failed" }),
      tasks: [makeTask({ id: "t1", status: "failed" })],
      steps: [],
      artifacts: [],
      fileChanges: [],
      validations,
      events: [],
      timeline: [],
      approvals: [],
      runErrors: [],
      workflowState: null,
      auditSummary: null,
    });

    expect(report.validationSummary.failed).toBe(1);
    expect(report.validations[0]!.passed).toBe(1);
    expect(report.validations[0]!.failed).toBe(1);
    expect(report.validations[0]!.confidence).toBe(0.3);
    expect(report.validations[0]!.failureReason).toBe("Validation failed: missing file");
  });

  it("properly populates artifact by-type counts", () => {
    const artifacts: ArtifactRecord[] = [
      makeArtifact({ title: "a.ts", type: "created_file" }),
      makeArtifact({ title: "b.ts", type: "created_file" }),
      makeArtifact({ title: "report.md", type: "report" }),
    ];

    const report = gen.generateReportData({
      run: makeRun(),
      tasks: [],
      steps: [],
      artifacts,
      fileChanges: [],
      validations: [],
      events: [],
      timeline: [],
      approvals: [],
      runErrors: [],
      workflowState: null,
      auditSummary: null,
    });

    expect(report.artifactSummary.byType["created_file"]).toBe(2);
    expect(report.artifactSummary.byType["report"]).toBe(1);
  });
});
