import type {
  Run,
  RunStatus,
  TimelineEvent,
  RunApproval,
  RunError,
  RunFileChange,
  CostUsage,
  TokenUsage,
} from "../schemas/run.schema.js";
import type { Task } from "../schemas/task.schema.js";
import type { Step, StepError } from "../schemas/step.schema.js";
import type { ArtifactRecord } from "../schemas/artifact.schema.js";
import type { ValidationResult } from "../schemas/validation.schema.js";
import type { FileChange } from "./file-tracker.js";
import type { WorkflowState } from "../schemas/workflow-lifecycle.schema.js";
import type { FlowTaskEvent } from "../schemas/event.schema.js";

import { readTextFile } from "../utils/fs.js";
import { getContextDir } from "../utils/paths.js";
import path from "node:path";
import { now } from "../utils/time.js";

interface AuditSummaryData {
  total: number;
  errors: number;
  warnings: number;
}

export interface ReportStep {
  taskId: string;
  taskTitle: string;
  status: string;
  executor?: string;
  retryCount?: number;
  startedAt?: string;
  finishedAt?: string;
  errors?: StepError[];
}

export interface ReportArtifact {
  title: string;
  type: string;
  path: string;
  origin: string;
  validationStatus: string;
  summary?: string;
  fileSize?: number;
}

export interface ReportFileChange {
  path: string;
  type: string;
  category: string;
  summary: string;
  diffStat?: string;
}

export interface ReportValidation {
  taskId: string;
  status: string;
  checks: number;
  passed: number;
  failed: number;
  confidence?: number;
  failureReason?: string;
}

export interface ReportApproval {
  type: string;
  status: string;
  reason?: string;
  requestedAt: string;
  resolvedAt?: string;
}

export interface ReportCostUsage {
  totalCost: number;
  currency: string;
  byStep?: Record<string, number>;
  byProvider?: Record<string, number>;
}

export interface ReportTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ReportData {
  runId: string;
  title: string;
  status: RunStatus;
  mode?: string;
  userGoal?: string;
  summary: string;
  planMarkdown?: string;
  totalSteps: number;
  stepsExecuted: number;
  stepsSkipped: number;
  stepsFailed: number;
  stepsCancelled: number;
  stepsPending: number;
  stepDetails: ReportStep[];
  artifacts: ReportArtifact[];
  artifactSummary: {
    total: number;
    byType: Record<string, number>;
    expected: number;
    unexpected: number;
  };
  fileChanges: ReportFileChange[];
  fileChangeSummary: {
    total: number;
    created: number;
    modified: number;
    deleted: number;
    renamed: number;
    expected: number;
    unexpected: number;
    sensitive: number;
  };
  validations: ReportValidation[];
  validationSummary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  approvals: ReportApproval[];
  approvalSummary: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  errors: ReportErrorEntry[];
  retryHistory: {
    total: number;
    byTask: { taskId: string; taskTitle: string; count: number }[];
  };
  costUsage?: ReportCostUsage;
  tokenUsage?: ReportTokenUsage;
  duration: {
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
  };
  timeline: {
    total: number;
    byType: Record<string, number>;
  };
  remainingIssues: string[];
  nextActions: string[];
  workflowLifecycle?: WorkflowLifecycleSummary;
  auditSummary?: {
    total: number;
    errors: number;
    warnings: number;
  };
  generatedAt: string;
  runCreatedAt: string;
  runUpdatedAt: string;
}

export interface ReportErrorEntry {
  stepId?: string;
  taskId?: string;
  message: string;
  timestamp: string;
  retryCount?: number;
  suggestedFix?: string;
}

export interface WorkflowLifecycleSummary {
  totalEvents: number;
  stateTransitions: number;
  firstEvent?: string;
  lastEvent?: string;
}

export class FinalReportGenerator {
  generateReportData(params: {
    run: Run;
    tasks: Task[];
    steps: Step[];
    artifacts: ArtifactRecord[];
    fileChanges: FileChange[];
    validations: ValidationResult[];
    events: FlowTaskEvent[];
    timeline: TimelineEvent[];
    approvals: RunApproval[];
    runErrors: RunError[];
    workflowState?: WorkflowState | null;
    auditSummary?: AuditSummaryData | null;
    planMarkdown?: string;
  }): ReportData {
    const {
      run,
      tasks,
      steps,
      artifacts,
      fileChanges,
      validations,
      events,
      timeline,
      approvals,
      runErrors,
      workflowState,
      auditSummary,
      planMarkdown,
    } = params;

    const stepsExecuted = tasks.filter((t) => t.status === "done").length;
    const stepsSkipped = tasks.filter((t) => t.status === "skipped").length;
    const stepsFailed = tasks.filter((t) => t.status === "failed").length;
    const stepsCancelled = tasks.filter((t) => t.status === "cancelled").length;
    const stepsPending = tasks.filter(
      (t) =>
        t.status === "pending" ||
        t.status === "blocked" ||
        t.status === "interrupted" ||
        t.status === "waiting_approval" ||
        t.status === "waiting_input",
    ).length;

    const stepDetails: ReportStep[] = tasks.map((t) => {
      const taskSteps = steps.filter((s) => s.taskId === t.id);
      const allErrors: StepError[] = [];
      for (const s of taskSteps) {
        if (s.errors) allErrors.push(...s.errors);
      }
      const firstStep = taskSteps[0];
      const lastStep = taskSteps[taskSteps.length - 1];
      return {
        taskId: t.id,
        taskTitle: t.title,
        status: t.status,
        executor: t.executor,
        retryCount: t.retryCount,
        startedAt: firstStep?.startedAt,
        finishedAt: lastStep?.finishedAt,
        errors: allErrors.length > 0 ? allErrors : undefined,
      };
    });

    const reportArtifacts: ReportArtifact[] = artifacts.map((a) => ({
      title: a.title,
      type: a.type,
      path: a.filePath,
      origin: a.origin,
      validationStatus: a.validationStatus,
      summary: a.summary,
      fileSize: a.fileSize,
    }));

    const byArtifactType: Record<string, number> = {};
    for (const a of artifacts) {
      byArtifactType[a.type] = (byArtifactType[a.type] ?? 0) + 1;
    }

    const reportFileChanges: ReportFileChange[] = fileChanges.map((fc) => ({
      path: fc.filePath,
      type: fc.type,
      category: fc.category,
      summary: fc.summary,
      diffStat: fc.diffStat,
    }));

    let validationPassed = 0;
    let validationFailed = 0;
    let validationSkipped = 0;
    const reportValidations: ReportValidation[] = validations.map((v) => {
      const passedChecks = v.checks.filter((c) => c.status === "passed").length;
      const failedChecks = v.checks.filter(
        (c) => c.status === "failed" || c.status === "needs_retry" || c.status === "needs_review",
      ).length;
      if (v.status === "passed") validationPassed++;
      else if (v.status === "failed") validationFailed++;
      else validationSkipped++;
      return {
        taskId: v.taskId,
        status: v.status,
        checks: v.checks.length,
        passed: passedChecks,
        failed: failedChecks,
        confidence: v.confidence,
        failureReason:
          typeof v.failureReason === "string" ? v.failureReason : v.failureReason?.reason,
      };
    });

    const reportApprovals: ReportApproval[] = approvals.map((a) => ({
      type: a.type,
      status: a.status,
      reason: a.reason,
      requestedAt: a.requestedAt,
      resolvedAt: a.resolvedAt,
    }));

    let approvalPending = 0;
    let approvalApproved = 0;
    let approvalRejected = 0;
    for (const a of approvals) {
      if (a.status === "pending") approvalPending++;
      else if (a.status === "approved") approvalApproved++;
      else if (a.status === "rejected") approvalRejected++;
    }

    const reportErrors: ReportErrorEntry[] = runErrors.map((e) => ({
      stepId: e.stepId,
      taskId: e.taskId,
      message: e.message,
      timestamp: e.timestamp,
      retryCount: e.retryCount,
      suggestedFix: e.suggestedFix,
    }));

    const retryByTask: Map<string, { title: string; count: number }> = new Map();
    for (const t of tasks) {
      if ((t.retryCount ?? 0) > 0) {
        retryByTask.set(t.id, { title: t.title, count: t.retryCount });
      }
    }
    for (const s of steps) {
      if (s.errors) {
        const retries = s.errors.filter((e) => e.retryCount > 0).length;
        if (retries > 0) {
          const existing = retryByTask.get(s.taskId);
          if (existing) {
            existing.count = Math.max(existing.count, retries);
          } else {
            const task = tasks.find((t) => t.id === s.taskId);
            retryByTask.set(s.taskId, { title: task?.title ?? s.taskId, count: retries });
          }
        }
      }
    }

    const timelineByType: Record<string, number> = {};
    for (const te of timeline) {
      timelineByType[te.type] = (timelineByType[te.type] ?? 0) + 1;
    }

    const totalCost = run.costUsage;
    const totalToken = run.tokenUsage;

    const remainingIssues: string[] = [];
    if (stepsFailed > 0) remainingIssues.push(`${stepsFailed} task(s) failed`);
    if (stepsSkipped > 0) remainingIssues.push(`${stepsSkipped} task(s) skipped`);
    if (stepsCancelled > 0) remainingIssues.push(`${stepsCancelled} task(s) cancelled`);
    if (stepsPending > 0) remainingIssues.push(`${stepsPending} task(s) still pending`);
    if (validationFailed > 0) remainingIssues.push(`${validationFailed} validation(s) failed`);
    if (approvalRejected > 0) remainingIssues.push(`${approvalRejected} approval(s) rejected`);
    if (approvalPending > 0) remainingIssues.push(`${approvalPending} approval(s) still pending`);
    if (fileChanges.filter((fc) => fc.category === "unexpected").length > 0) {
      remainingIssues.push(
        `${fileChanges.filter((fc) => fc.category === "unexpected").length} unexpected file change(s)`,
      );
    }
    if (fileChanges.filter((fc) => fc.category === "sensitive").length > 0) {
      remainingIssues.push(
        `${fileChanges.filter((fc) => fc.category === "sensitive").length} sensitive file change(s)`,
      );
    }
    if (reportErrors.length > 0) remainingIssues.push(`${reportErrors.length} error(s) recorded`);
    if (retryByTask.size > 0) remainingIssues.push(`${retryByTask.size} task(s) required retry`);

    const taskSummary = this.buildTaskRunSummary(tasks);
    const summary = `Workflow "${run.title}" ${run.finishedAt ? "completed" : "running"}. ${taskSummary}.${runErrors.length > 0 ? ` ${runErrors.length} error(s) recorded.` : ""}`;

    const nextActions: string[] = [];
    if (stepsFailed > 0) {
      const failedTasks = tasks.filter((t) => t.status === "failed");
      for (const ft of failedTasks) {
        nextActions.push(
          `Review and retry failed task: flowtask retry ${run.runId} --task ${ft.id}`,
        );
      }
    }
    if (stepsPending > 0) {
      nextActions.push(`Resume workflow: flowtask resume ${run.runId}`);
    }
    if (approvalPending > 0) {
      nextActions.push(`Resolve pending approvals: flowtask tasks-approve --run ${run.runId}`);
    }
    if (validationFailed > 0) {
      nextActions.push(`Review validation failures: flowtask validate ${run.runId}`);
    }
    if (fileChanges.filter((fc) => fc.category === "unexpected").length > 0) {
      nextActions.push("Review unexpected file changes");
    }
    if (run.status === "succeeded" || run.status === "completed") {
      nextActions.push(`Duplicate this run: flowtask duplicate ${run.runId}`);
      nextActions.push(`Export this run: flowtask export ${run.runId}`);
    } else if (run.status === "failed") {
      nextActions.push(`Retry workflow: flowtask retry ${run.runId}`);
    }
    if (run.status === "cancelled") {
      nextActions.push(`Duplicate and retry: flowtask duplicate ${run.runId}`);
    }

    const wfState = workflowState;
    const workflowLifecycle: WorkflowLifecycleSummary | undefined = wfState
      ? {
          totalEvents: wfState.lifecycle.length,
          stateTransitions: wfState.lifecycle.filter((l) => l.type === "state_transition").length,
          firstEvent: wfState.lifecycle[0]?.timestamp,
          lastEvent: wfState.lifecycle[wfState.lifecycle.length - 1]?.timestamp,
        }
      : undefined;

    return {
      runId: run.runId,
      title: run.title,
      status: run.status,
      mode: run.mode,
      userGoal: run.userGoal,
      summary,
      planMarkdown,
      totalSteps: tasks.length,
      stepsExecuted,
      stepsSkipped,
      stepsFailed,
      stepsCancelled,
      stepsPending,
      stepDetails,
      artifacts: reportArtifacts,
      artifactSummary: {
        total: artifacts.length,
        byType: byArtifactType,
        expected: artifacts.filter((a) => a.origin === "expected").length,
        unexpected: artifacts.filter((a) => a.origin === "unexpected").length,
      },
      fileChanges: reportFileChanges,
      fileChangeSummary: {
        total: fileChanges.length,
        created: fileChanges.filter((fc) => fc.type === "created").length,
        modified: fileChanges.filter((fc) => fc.type === "modified").length,
        deleted: fileChanges.filter((fc) => fc.type === "deleted").length,
        renamed: fileChanges.filter((fc) => fc.type === "renamed").length,
        expected: fileChanges.filter((fc) => fc.category === "expected").length,
        unexpected: fileChanges.filter((fc) => fc.category === "unexpected").length,
        sensitive: fileChanges.filter((fc) => fc.category === "sensitive").length,
      },
      validations: reportValidations,
      validationSummary: {
        total: validations.length,
        passed: validationPassed,
        failed: validationFailed,
        skipped: validationSkipped,
      },
      approvals: reportApprovals,
      approvalSummary: {
        total: approvals.length,
        pending: approvalPending,
        approved: approvalApproved,
        rejected: approvalRejected,
      },
      errors: reportErrors,
      retryHistory: {
        total: retryByTask.size,
        byTask: Array.from(retryByTask.entries()).map(([taskId, info]) => ({
          taskId,
          taskTitle: info.title,
          count: info.count,
        })),
      },
      costUsage: totalCost
        ? {
            totalCost: totalCost.totalCost,
            currency: totalCost.currency,
            byStep: totalCost.byStep,
            byProvider: totalCost.byProvider,
          }
        : undefined,
      tokenUsage: totalToken
        ? {
            inputTokens: totalToken.inputTokens,
            outputTokens: totalToken.outputTokens,
            totalTokens: totalToken.totalTokens,
          }
        : undefined,
      duration: {
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
      },
      timeline: {
        total: timeline.length,
        byType: timelineByType,
      },
      remainingIssues,
      nextActions,
      workflowLifecycle,
      auditSummary: auditSummary
        ? {
            total: auditSummary.total,
            errors: auditSummary.errors,
            warnings: auditSummary.warnings,
          }
        : undefined,
      generatedAt: now(),
      runCreatedAt: run.createdAt,
      runUpdatedAt: run.updatedAt,
    };
  }

  async generateReport(
    run: Run,
    tasks: Task[],
    options: {
      rootPath?: string;
      steps?: Step[];
      artifacts?: ArtifactRecord[];
      fileChanges?: FileChange[];
      validations?: ValidationResult[];
      events?: FlowTaskEvent[];
      timeline?: TimelineEvent[];
      approvals?: RunApproval[];
      runErrors?: RunError[];
      workflowState?: WorkflowState | null;
      auditSummary?: AuditSummaryData | null;
    },
  ): Promise<ReportData> {
    const {
      rootPath,
      steps = [],
      artifacts = [],
      fileChanges = [],
      validations = [],
      events = [],
      timeline = [],
      approvals = [],
      runErrors = [],
      workflowState = null,
      auditSummary = null,
    } = options;

    let planMarkdown: string | undefined;
    if (rootPath) {
      try {
        const planPath = path.join(getContextDir(rootPath, run.runId), "plan.md");
        planMarkdown = await readTextFile(planPath);
      } catch {
        // plan may not exist
      }
    }

    return this.generateReportData({
      run,
      tasks,
      steps,
      artifacts,
      fileChanges,
      validations,
      events,
      timeline,
      approvals,
      runErrors,
      workflowState,
      auditSummary,
      planMarkdown,
    });
  }

  generateMarkdown(report: ReportData): string {
    const lines: string[] = [];

    lines.push("# Final Report");
    lines.push("");
    lines.push(`**Generated:** ${new Date(report.generatedAt).toISOString()}`);
    lines.push("");

    lines.push("## 1. Run Summary");
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`| ----- | ----- |`);
    lines.push(`| **Run ID** | \`${report.runId}\` |`);
    lines.push(`| **Title** | ${report.title} |`);
    lines.push(`| **Status** | ${this.badge(report.status)} |`);
    if (report.mode) lines.push(`| **Mode** | ${report.mode} |`);
    if (report.userGoal) lines.push(`| **User Goal** | ${report.userGoal} |`);
    lines.push(`| **Created** | ${new Date(report.runCreatedAt).toISOString()} |`);
    if (report.duration.startedAt)
      lines.push(`| **Started** | ${new Date(report.duration.startedAt).toISOString()} |`);
    if (report.duration.finishedAt)
      lines.push(`| **Finished** | ${new Date(report.duration.finishedAt).toISOString()} |`);
    if (report.duration.durationMs != null) {
      lines.push(`| **Duration** | ${this.formatMs(report.duration.durationMs)} |`);
    }
    lines.push("");

    lines.push(`**Summary:** ${report.summary}`);
    lines.push("");

    if (report.workflowLifecycle) {
      lines.push("### Workflow Lifecycle");
      lines.push("");
      lines.push(`| Metric | Value |`);
      lines.push(`| ------ | ----- |`);
      lines.push(`| **Lifecycle events** | ${report.workflowLifecycle.totalEvents} |`);
      lines.push(`| **State transitions** | ${report.workflowLifecycle.stateTransitions} |`);
      if (report.workflowLifecycle.firstEvent) {
        lines.push(
          `| **First event** | ${new Date(report.workflowLifecycle.firstEvent).toISOString()} |`,
        );
      }
      if (report.workflowLifecycle.lastEvent) {
        lines.push(
          `| **Last event** | ${new Date(report.workflowLifecycle.lastEvent).toISOString()} |`,
        );
      }
      lines.push("");
    }

    lines.push("## 2. Steps");
    lines.push("");
    lines.push(`| Status | Count |`);
    lines.push(`| ------ | ----- |`);
    lines.push(`| **Total steps** | ${report.totalSteps} |`);
    lines.push(`| **Executed** | ${report.stepsExecuted} |`);
    lines.push(`| **Failed** | ${report.stepsFailed} |`);
    lines.push(`| **Skipped** | ${report.stepsSkipped} |`);
    lines.push(`| **Cancelled** | ${report.stepsCancelled} |`);
    lines.push(`| **Pending** | ${report.stepsPending} |`);
    lines.push("");

    if (report.stepDetails.length > 0) {
      lines.push("### Step Details");
      lines.push("");
      lines.push("| # | Task | Status | Executor | Retries |");
      lines.push("|---| ---- | ------ | -------- | ------- |");
      for (let i = 0; i < report.stepDetails.length; i++) {
        const sd = report.stepDetails[i]!;
        const retries = sd.retryCount && sd.retryCount > 0 ? `${sd.retryCount}x` : "-";
        lines.push(
          `| ${i + 1} | ${sd.taskTitle} | ${this.badge(sd.status)} | ${sd.executor ?? "-"} | ${retries} |`,
        );
      }
      lines.push("");
    }

    if (report.retryHistory.total > 0) {
      lines.push("### Retry History");
      lines.push("");
      lines.push("| Task | Retries |");
      lines.push("| ---- | ------- |");
      for (const rh of report.retryHistory.byTask) {
        lines.push(`| ${rh.taskTitle} (\`${rh.taskId}\`) | ${rh.count} |`);
      }
      lines.push("");
    }

    lines.push("## 3. Artifacts");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`| ------ | ----- |`);
    lines.push(`| **Total artifacts** | ${report.artifactSummary.total} |`);
    lines.push(`| **Expected** | ${report.artifactSummary.expected} |`);
    lines.push(`| **Unexpected** | ${report.artifactSummary.unexpected} |`);
    lines.push("");

    if (Object.keys(report.artifactSummary.byType).length > 0) {
      lines.push("### By Type");
      lines.push("");
      for (const [type, count] of Object.entries(report.artifactSummary.byType).sort(
        (a, b) => b[1] - a[1],
      )) {
        lines.push(`- **${type}:** ${count}`);
      }
      lines.push("");
    }

    if (report.artifacts.length > 0) {
      lines.push("### Artifact List");
      lines.push("");
      lines.push("| Title | Type | Origin | Validation | Summary |");
      lines.push("| ----- | ---- | ------ | ---------- | ------- |");
      for (const a of report.artifacts) {
        lines.push(
          `| ${a.title} | ${a.type} | ${a.origin} | ${a.validationStatus} | ${a.summary ?? "-"} |`,
        );
      }
      lines.push("");
    }

    lines.push("## 4. File Changes");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`| ------ | ----- |`);
    lines.push(`| **Total changes** | ${report.fileChangeSummary.total} |`);
    lines.push(`| **Created** | ${report.fileChangeSummary.created} |`);
    lines.push(`| **Modified** | ${report.fileChangeSummary.modified} |`);
    lines.push(`| **Deleted** | ${report.fileChangeSummary.deleted} |`);
    lines.push(`| **Renamed** | ${report.fileChangeSummary.renamed} |`);
    lines.push(`| **Expected** | ${report.fileChangeSummary.expected} |`);
    lines.push(`| **Unexpected** | ${report.fileChangeSummary.unexpected} |`);
    lines.push(`| **Sensitive** | ${report.fileChangeSummary.sensitive} |`);
    lines.push("");

    if (report.fileChanges.length > 0) {
      lines.push("### File Change List");
      lines.push("");
      lines.push("| Path | Type | Category | Summary |");
      lines.push("| ---- | ---- | -------- | ------- |");
      for (const fc of report.fileChanges) {
        lines.push(`| \`${fc.path}\` | ${fc.type} | ${fc.category} | ${fc.summary} |`);
      }
      lines.push("");
    }

    lines.push("## 5. Validation");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`| ------ | ----- |`);
    lines.push(`| **Total validations** | ${report.validationSummary.total} |`);
    lines.push(`| **Passed** | ${report.validationSummary.passed} |`);
    lines.push(`| **Failed** | ${report.validationSummary.failed} |`);
    lines.push(`| **Skipped** | ${report.validationSummary.skipped} |`);
    lines.push("");

    if (report.validations.length > 0) {
      lines.push("### Validation Details");
      lines.push("");
      lines.push("| Task ID | Status | Checks | Passed | Failed | Confidence |");
      lines.push("| ------- | ------ | ------ | ------ | ------ | ---------- |");
      for (const v of report.validations) {
        const conf = v.confidence != null ? `${(v.confidence * 100).toFixed(0)}%` : "-";
        lines.push(
          `| \`${v.taskId}\` | ${this.badge(v.status)} | ${v.checks} | ${v.passed} | ${v.failed} | ${conf} |`,
        );
      }
      lines.push("");
    }

    lines.push("## 6. Approvals");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`| ------ | ----- |`);
    lines.push(`| **Total approvals** | ${report.approvalSummary.total} |`);
    lines.push(`| **Approved** | ${report.approvalSummary.approved} |`);
    lines.push(`| **Rejected** | ${report.approvalSummary.rejected} |`);
    lines.push(`| **Pending** | ${report.approvalSummary.pending} |`);
    lines.push("");

    if (report.approvals.length > 0) {
      lines.push("### Approval Details");
      lines.push("");
      lines.push("| Type | Status | Reason | Requested |");
      lines.push("| ---- | ------ | ------ | --------- |");
      for (const a of report.approvals) {
        lines.push(
          `| ${a.type} | ${a.status} | ${a.reason ?? "-"} | ${new Date(a.requestedAt).toISOString()} |`,
        );
      }
      lines.push("");
    }

    if (report.errors.length > 0) {
      lines.push("## 7. Errors");
      lines.push("");
      lines.push("| # | Time | Message | Task | Evidence | Suggested Fix | Retries |");
      lines.push("|---| ---- | ------- | ---- | -------- | ------------- | ------- |");
      for (let i = 0; i < report.errors.length; i++) {
        const e = report.errors[i]!;
        const taskRef = e.taskId ? `\`${e.taskId}\`` : "-";
        const evidence = e.suggestedFix ? "" : "-";
        const fix = e.suggestedFix ?? "-";
        const retries = e.retryCount != null ? `${e.retryCount}` : "-";
        const msg = e.message.length > 100 ? e.message.slice(0, 97) + "..." : e.message;
        const evidenceShort = e.suggestedFix ? "" : "-";
        lines.push(
          `| ${i + 1} | ${new Date(e.timestamp).toISOString()} | ${msg} | ${taskRef} | ${evidenceShort} | ${fix} | ${retries} |`,
        );
      }
      lines.push("");
    }

    if (report.costUsage || report.tokenUsage) {
      lines.push("## 8. Cost & Token Usage");
      lines.push("");
      if (report.costUsage) {
        lines.push(
          `| **Total cost** | ${report.costUsage.totalCost.toFixed(6)} ${report.costUsage.currency} |`,
        );
        if (report.costUsage.byProvider) {
          lines.push("");
          lines.push("### Cost by Provider");
          for (const [provider, cost] of Object.entries(report.costUsage.byProvider)) {
            lines.push(`- **${provider}:** ${cost.toFixed(6)} ${report.costUsage.currency}`);
          }
        }
      }
      if (report.tokenUsage) {
        lines.push("");
        lines.push(`| **Input tokens** | ${report.tokenUsage.inputTokens.toLocaleString()} |`);
        lines.push(`| **Output tokens** | ${report.tokenUsage.outputTokens.toLocaleString()} |`);
        lines.push(`| **Total tokens** | ${report.tokenUsage.totalTokens.toLocaleString()} |`);
      }
      lines.push("");
    }

    if (report.auditSummary) {
      lines.push("## 9. Audit Summary");
      lines.push("");
      lines.push(`| Metric | Value |`);
      lines.push(`| ------ | ----- |`);
      lines.push(`| **Total events** | ${report.auditSummary.total} |`);
      lines.push(`| **Errors** | ${report.auditSummary.errors} |`);
      lines.push(`| **Warnings** | ${report.auditSummary.warnings} |`);
      lines.push("");
    }

    if (report.timeline.total > 0) {
      lines.push("## 10. Timeline");
      lines.push("");
      lines.push(`| Metric | Value |`);
      lines.push(`| ------ | ----- |`);
      lines.push(`| **Total events** | ${report.timeline.total} |`);
      lines.push("");
      lines.push("### Top Event Types");
      lines.push("");
      const topEvents = Object.entries(report.timeline.byType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
      for (const [type, count] of topEvents) {
        lines.push(`- **${type}:** ${count}`);
      }
      lines.push("");
    }

    if (report.remainingIssues.length > 0) {
      lines.push("## 11. Remaining Issues");
      lines.push("");
      for (const issue of report.remainingIssues) {
        lines.push(`- ${issue}`);
      }
      lines.push("");
    }

    if (report.nextActions.length > 0) {
      lines.push("## 12. Recommended Next Actions");
      lines.push("");
      for (let i = 0; i < report.nextActions.length; i++) {
        lines.push(`${i + 1}. ${report.nextActions[i]}`);
      }
      lines.push("");
    }

    if (report.planMarkdown) {
      lines.push("## 13. Original Plan");
      lines.push("");
      lines.push("```");
      lines.push(report.planMarkdown);
      lines.push("```");
      lines.push("");
    }

    lines.push("---");
    lines.push("");
    lines.push(
      `*Report generated at ${new Date(report.generatedAt).toISOString()} for run \`${report.runId}\`.*`,
    );

    return lines.join("\n");
  }

  private buildTaskRunSummary(tasks: Task[]): string {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const skipped = tasks.filter((t) => t.status === "skipped").length;
    const cancelled = tasks.filter((t) => t.status === "cancelled").length;
    const pending = tasks.filter(
      (t) =>
        t.status === "pending" ||
        t.status === "blocked" ||
        t.status === "interrupted" ||
        t.status === "waiting_approval" ||
        t.status === "waiting_input",
    ).length;

    const parts: string[] = [`${done}/${total} tasks completed`];
    if (failed > 0) parts.push(`${failed} failed`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (cancelled > 0) parts.push(`${cancelled} cancelled`);
    if (pending > 0) parts.push(`${pending} pending`);
    return parts.join(", ");
  }

  private formatMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return `${min}m ${sec}s`;
  }

  private badge(status: string): string {
    const map: Record<string, string> = {
      completed: "✅ Completed",
      succeeded: "✅ Succeeded",
      done: "✅ Done",
      failed: "❌ Failed",
      skipped: "⏭ Skipped",
      cancelled: "🚫 Cancelled",
      pending: "⏳ Pending",
      running: "🔄 Running",
      created: "🆕 Created",
      scanning: "🔍 Scanning",
      planning: "📋 Planning",
      planned: "📋 Planned",
      waiting_plan_approval: "⏳ Waiting Approval",
      approved: "✅ Approved",
      ready: "✅ Ready",
      waiting_approval: "⏳ Waiting Approval",
      waiting_input: "⌨️ Waiting Input",
      waiting_dependency: "⏳ Waiting Dependency",
      validating: "🔎 Validating",
      retrying: "🔄 Retrying",
      paused: "⏸ Paused",
      stuck: "⚠️ Stuck",
      needs_user_review: "👀 Needs Review",
      partially_completed: "⚠️ Partial",
      rollback_required: "⚠️ Rollback Required",
      rolled_back: "↩ Rolled Back",
      blocked: "🚫 Blocked",
      interrupted: "⚠️ Interrupted",
      passed: "✅ Passed",
      needs_retry: "🔄 Needs Retry",
      needs_review: "👀 Needs Review",
      pending_approval: "⏳ Pending Approval",
      denied: "❌ Denied",
    };
    return map[status] ?? status;
  }
}
