import { describe, it, expect } from "vitest";
import { WorkflowDiffCalculator, WorkflowDiffResultSchema } from "../../src/core/workflow-diff.js";
import type { Step } from "../../src/schemas/step.schema.js";
import type { FileChange } from "../../src/core/file-tracker.js";
import type { ArtifactRecord } from "../../src/schemas/artifact.schema.js";
import type { ValidationResult } from "../../src/schemas/validation.schema.js";
import type { AiPlannerOutput, AiPlannerTask } from "../../src/schemas/planner.schema.js";
import type { WorkflowDiffTaskInput } from "../../src/core/workflow-diff.js";

function makeStep(overrides: Partial<Step> & { id: string; taskId: string; title: string }): Step {
  return {
    id: overrides.id,
    taskId: overrides.taskId,
    runId: overrides.runId ?? "run_test",
    title: overrides.title,
    description: overrides.description,
    type: overrides.type ?? "command",
    command: overrides.command,
    status: overrides.status ?? "created",
    expectedResult: overrides.expectedResult,
    outputPlan: overrides.outputPlan,
    requiresApproval: overrides.requiresApproval ?? false,
    order: overrides.order ?? 0,
    createdAt: overrides.createdAt ?? "2025-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2025-01-01T00:00:00.000Z",
    dependsOn: overrides.dependsOn ?? [],
    expectedOutput: overrides.expectedOutput,
    output: overrides.output,
    errors: overrides.errors,
    metadata: overrides.metadata,
  } as Step;
}

function makeFileChange(overrides: Partial<FileChange> & { filePath: string }): FileChange {
  return {
    changeId: overrides.changeId ?? "change_1",
    runId: overrides.runId ?? "run_test",
    type: overrides.type ?? "created",
    filePath: overrides.filePath,
    category: overrides.category ?? "expected",
    summary: overrides.summary ?? `File ${overrides.filePath}`,
    detectedAt: overrides.detectedAt ?? "2025-01-01T00:00:00.000Z",
  } as FileChange;
}

function makeArtifact(
  overrides: Partial<ArtifactRecord> & { title: string; filePath: string },
): ArtifactRecord {
  return {
    artifactId: overrides.artifactId ?? "artifact_1",
    runId: overrides.runId ?? "run_test",
    title: overrides.title,
    type: overrides.type ?? "document",
    path: overrides.path ?? `/tmp/${overrides.filePath}`,
    filePath: overrides.filePath,
    origin: overrides.origin ?? "expected",
    validationStatus: overrides.validationStatus ?? "pending",
    createdAt: overrides.createdAt ?? "2025-01-01T00:00:00.000Z",
  } as ArtifactRecord;
}

function makeValidationResult(
  overrides: Partial<ValidationResult> & { taskId: string },
): ValidationResult {
  return {
    taskId: overrides.taskId,
    status: overrides.status ?? "passed",
    checks: overrides.checks ?? [],
    createdAt: overrides.createdAt ?? "2025-01-01T00:00:00.000Z",
  } as ValidationResult;
}

function makePlanTask(overrides: Partial<AiPlannerTask> & { title: string }): AiPlannerTask {
  return {
    title: overrides.title,
    description: overrides.description ?? "task description",
    executor: overrides.executor ?? "shell",
    dependsOn: overrides.dependsOn ?? [],
    riskLevel: overrides.riskLevel ?? "safe",
    acceptanceCriteria: overrides.acceptanceCriteria ?? ["criteria met"],
    commands: overrides.commands ?? [],
    validation: overrides.validation,
    targetFiles: overrides.targetFiles,
    targetArtifacts: overrides.targetArtifacts,
    outputPlan: overrides.outputPlan,
    expectedResult: overrides.expectedResult,
    approvalRequired: overrides.approvalRequired,
    taskType: overrides.taskType ?? "general",
  } as AiPlannerTask;
}

function makePlan(
  overrides: Partial<AiPlannerOutput> & { tasks: AiPlannerTask[] },
): AiPlannerOutput {
  return {
    title: overrides.title ?? "Test Plan",
    summary: overrides.summary ?? "A test plan",
    tasks: overrides.tasks,
  };
}

function makeTaskInput(
  overrides: Partial<WorkflowDiffTaskInput> & { id: string; title: string },
): WorkflowDiffTaskInput {
  return {
    id: overrides.id,
    title: overrides.title,
    expectedResult: overrides.expectedResult,
    outputPlan: overrides.outputPlan,
    acceptanceCriteria: overrides.acceptanceCriteria,
  };
}

describe("WorkflowDiffCalculator", () => {
  const calc = new WorkflowDiffCalculator();

  describe("compute", () => {
    it("returns empty diff when nothing to compare", () => {
      const result = calc.compute({
        runId: "run_empty",
        steps: [],
        tasks: [],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
      });

      expect(result.runId).toBe("run_empty");
      expect(result.summary.totalDiffs).toBe(0);
      expect(result.items).toEqual([]);
      expect(WorkflowDiffResultSchema.parse(result)).toBeTruthy();
    });

    it("detects missing expected output", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Generate report",
        expectedOutput: { reportPath: "/tmp/report.md" },
        output: undefined,
        status: "running",
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Generate report" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
      });

      expect(result.summary.hasMissingOutputs).toBe(true);
      expect(result.items.some((i) => i.type === "missing_output")).toBe(true);
      expect(result.items[0]?.stepId).toBe("step_1");
    });

    it("detects output value mismatch", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Transform data",
        expectedOutput: { count: 42, status: "ok" },
        output: { count: 10, status: "ok" },
        status: "running",
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Transform data" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
      });

      const mismatches = result.items.filter((i) => i.type === "output_value_mismatch");
      expect(mismatches.length).toBe(1);
      expect(mismatches[0]?.label).toContain("count");
    });

    it("detects extra unexpected output keys", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Analyze data",
        expectedOutput: { result: "done" },
        output: { result: "done", extraKey: "unexpected" },
        status: "succeeded",
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Analyze data" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
      });

      const extras = result.items.filter((i) => i.type === "extra_output");
      expect(extras.length).toBe(1);
      expect(extras[0]?.label).toContain("extraKey");
    });

    it("detects plan drift: planned output not found in steps", () => {
      const plan = makePlan({
        tasks: [
          makePlanTask({
            title: "Write doc",
            outputPlan: [
              {
                action: "create" as const,
                target: "docs/readme.md",
                description: "README",
                validationMethod: "file_exists" as const,
              },
            ],
          }),
        ],
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [],
        tasks: [makeTaskInput({ id: "task_1", title: "Write doc" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
        plan,
      });

      const drifts = result.items.filter((i) => i.type === "plan_drift");
      expect(drifts.length).toBeGreaterThanOrEqual(1);
    });

    it("detects expected file changes not found", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Create config",
        metadata: { targetFiles: ["config/app.json", "config/db.json"] },
        status: "succeeded",
        command: "echo done",
      });

      const plan = makePlan({
        tasks: [makePlanTask({ title: "Create config", targetFiles: ["config/app.json"] })],
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Create config" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
        plan,
      });

      const missingFiles = result.items.filter((i) => i.type === "missing_file_change");
      expect(missingFiles.length).toBeGreaterThanOrEqual(1);
    });

    it("detects unexpected file changes", () => {
      const changes: FileChange[] = [
        makeFileChange({
          filePath: "unexpected.txt",
          type: "created",
          category: "unexpected",
        }),
      ];

      const result = calc.compute({
        runId: "run_1",
        steps: [],
        tasks: [],
        fileChanges: changes,
        artifacts: [],
        validationResults: [],
      });

      const unexpectedFiles = result.items.filter((i) => i.type === "unexpected_file_change");
      expect(unexpectedFiles.length).toBe(1);
      expect(unexpectedFiles[0]?.label).toContain("unexpected.txt");
    });

    it("detects sensitive file changes as errors", () => {
      const changes: FileChange[] = [
        makeFileChange({
          filePath: ".env",
          type: "modified",
          category: "sensitive",
        }),
      ];

      const result = calc.compute({
        runId: "run_1",
        steps: [],
        tasks: [],
        fileChanges: changes,
        artifacts: [],
        validationResults: [],
      });

      const sensitiveChanges = result.items.filter(
        (i) => i.type === "unexpected_file_change" && i.severity === "error",
      );
      expect(sensitiveChanges.length).toBe(1);
      expect(sensitiveChanges[0]?.label).toContain(".env");
    });

    it("detects missing artifacts", () => {
      const plan = makePlan({
        tasks: [
          makePlanTask({
            title: "Generate PDF",
            targetArtifacts: ["output/report.pdf"],
          }),
        ],
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [],
        tasks: [makeTaskInput({ id: "task_1", title: "Generate PDF" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
        plan,
      });

      const missing = result.items.filter((i) => i.type === "missing_artifact");
      expect(missing.length).toBeGreaterThanOrEqual(1);
    });

    it("detects unexpected artifacts", () => {
      const artifacts: ArtifactRecord[] = [
        makeArtifact({ title: "extra.txt", filePath: "extra.txt", origin: "unexpected" }),
      ];

      const result = calc.compute({
        runId: "run_1",
        steps: [],
        tasks: [],
        fileChanges: [],
        artifacts,
        validationResults: [],
      });

      const extras = result.items.filter((i) => i.type === "extra_artifact");
      expect(extras.length).toBe(1);
      expect(extras[0]?.label).toContain("extra.txt");
    });

    it("detects missing planned commands", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Install deps",
        command: "npm install",
        status: "succeeded",
      });

      const plan = makePlan({
        tasks: [
          makePlanTask({
            title: "Install deps",
            commands: ["npm install", "npm run build"],
          }),
        ],
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Install deps" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
        plan,
      });

      const missingCmds = result.items.filter((i) => i.type === "missing_command");
      expect(missingCmds.length).toBeGreaterThanOrEqual(1);
    });

    it("detects executor drift (type mismatch)", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Review PR",
        type: "approval",
        command: "gh pr review",
        status: "succeeded",
      });

      const plan = makePlan({
        tasks: [
          makePlanTask({ title: "Review PR", taskType: "review", commands: ["gh pr review"] }),
        ],
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Review PR" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
        plan,
      });

      const drifts = result.items.filter((i) => i.type === "executor_drift");
      expect(drifts.length).toBe(1);
    });

    it("detects skipped verification (task has criteria but no validation)", () => {
      const result = calc.compute({
        runId: "run_1",
        steps: [],
        tasks: [
          makeTaskInput({
            id: "task_1",
            title: "Task with criteria",
            acceptanceCriteria: ["output must exist"],
          }),
        ],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
      });

      const skipped = result.items.filter((i) => i.type === "skipped_verification");
      expect(skipped.length).toBe(1);
      expect(skipped[0]?.label).toContain("Task with criteria");
    });

    it("detects validation drift (validation failed)", () => {
      const result = calc.compute({
        runId: "run_1",
        steps: [],
        tasks: [
          makeTaskInput({
            id: "task_1",
            title: "Failing task",
            acceptanceCriteria: ["must pass"],
          }),
        ],
        fileChanges: [],
        artifacts: [],
        validationResults: [
          makeValidationResult({
            taskId: "task_1",
            status: "failed",
            checks: [
              {
                type: "process",
                status: "failed",
                message: "Process exited with code 1",
              },
            ],
            confidence: 0,
          }),
        ],
      });

      const drifts = result.items.filter((i) => i.type === "validation_drift");
      expect(drifts.length).toBe(1);
    });

    it("detects validation drift when final status is passed but some checks failed", () => {
      const result = calc.compute({
        runId: "run_1",
        steps: [],
        tasks: [
          makeTaskInput({
            id: "task_1",
            title: "Mixed results task",
            acceptanceCriteria: ["must pass"],
          }),
        ],
        fileChanges: [],
        artifacts: [],
        validationResults: [
          makeValidationResult({
            taskId: "task_1",
            status: "passed",
            checks: [
              { type: "process", status: "passed", message: "ok" },
              { type: "file", status: "failed", message: "File not found" },
            ],
          }),
        ],
      });

      const drifts = result.items.filter((i) => i.type === "validation_drift");
      expect(drifts.length).toBe(1);
      expect(drifts[0]?.label).toContain("file");
    });

    it("detects risk level mismatch: high-risk without approval", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Delete production",
        command: "rm -rf",
        status: "succeeded",
        requiresApproval: false,
      });

      const plan = makePlan({
        tasks: [
          makePlanTask({
            title: "Delete production",
            riskLevel: "high",
            commands: ["rm -rf"],
            approvalRequired: true,
          }),
        ],
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Delete production" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
        plan,
      });

      const riskItems = result.items.filter((i) => i.type === "risk_level_mismatch");
      expect(riskItems.length).toBeGreaterThanOrEqual(1);
    });

    it("detects failed step as risk mismatch", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Failing step",
        command: "exit 1",
        status: "failed",
      });

      const plan = makePlan({
        tasks: [makePlanTask({ title: "Failing step", riskLevel: "safe" })],
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Failing step" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
        plan,
      });

      const riskItems = result.items.filter(
        (i) => i.type === "risk_level_mismatch" && i.label.includes("failed"),
      );
      expect(riskItems.length).toBe(1);
    });

    it("detects retries as risk info", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Retry step",
        command: "npm install",
        status: "succeeded",
        errors: [
          {
            message: "timeout",
            timestamp: "2025-01-01T00:00:00.000Z",
            retryCount: 0,
          },
          {
            message: "timeout",
            timestamp: "2025-01-01T00:00:01.000Z",
            retryCount: 1,
          },
        ],
      });

      const plan = makePlan({
        tasks: [makePlanTask({ title: "Retry step", riskLevel: "safe" })],
      });

      const result = calc.compute({
        runId: "run_1",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Retry step" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
        plan,
      });

      const retryItems = result.items.filter((i) => i.label.includes("retries"));
      expect(retryItems.length).toBe(1);
      expect(retryItems[0]?.actual).toBe(2);
    });

    it("produces a valid parsed schema result", () => {
      const steps: Step[] = [
        makeStep({
          id: "step_1",
          taskId: "task_1",
          title: "Test step",
          command: "echo hi",
          status: "succeeded",
        }),
      ];

      const result = calc.compute({
        runId: "run_schema",
        steps,
        tasks: [makeTaskInput({ id: "task_1", title: "Test step" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
      });

      const parsed = WorkflowDiffResultSchema.parse(result);
      expect(parsed.runId).toBe("run_schema");
      expect(parsed.summary).toBeDefined();
      expect(parsed.items).toBeDefined();
    });

    it("handles complex diff with all categories", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Complex step",
        command: "npm run build",
        expectedOutput: { result: "success", buildPath: "/dist" },
        output: { result: "success" },
        status: "succeeded",
        errors: [{ message: "warning", timestamp: "2025-01-01T00:00:00.000Z", retryCount: 0 }],
      });

      const plan = makePlan({
        tasks: [
          makePlanTask({
            title: "Complex step",
            commands: ["npm run build", "npm test"],
            targetFiles: ["dist/bundle.js"],
            targetArtifacts: ["dist/bundle.js"],
            riskLevel: "medium",
          }),
        ],
      });

      const fileChanges: FileChange[] = [
        makeFileChange({ filePath: "dist/bundle.js", type: "created", category: "expected" }),
        makeFileChange({ filePath: "tmp/extra.log", type: "created", category: "unexpected" }),
      ];

      const result = calc.compute({
        runId: "run_complex",
        steps: [step],
        tasks: [
          makeTaskInput({
            id: "task_1",
            title: "Complex step",
            acceptanceCriteria: ["build succeeds"],
          }),
        ],
        fileChanges,
        artifacts: [],
        validationResults: [
          makeValidationResult({
            taskId: "task_1",
            status: "passed",
            checks: [{ type: "process", status: "passed", message: "ok" }],
          }),
        ],
        plan,
      });

      expect(result.summary.totalDiffs).toBeGreaterThan(0);

      const byCategory = result.summary.byCategory;
      expect(byCategory.outputs).toBeGreaterThanOrEqual(1);
      expect(byCategory.files).toBeGreaterThanOrEqual(1);
      expect(byCategory.commands).toBeGreaterThanOrEqual(1);

      expect(result.summary.hasMissingOutputs).toBe(true);
      expect(result.summary.hasUnexpectedFileChanges).toBe(true);
      expect(result.summary.hasRiskMismatch).toBe(true);
    });

    it("does not report skipped steps as output issues", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Skipped step",
        command: "should not run",
        expectedResult: "some result",
        output: undefined,
        status: "skipped",
      });

      const result = calc.compute({
        runId: "run_skip",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Skipped step" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
      });

      expect(result.summary.totalDiffs).toBe(0);
    });

    it("does not report cancelled steps as output issues", () => {
      const step = makeStep({
        id: "step_1",
        taskId: "task_1",
        title: "Cancelled step",
        expectedResult: "won't happen",
        output: undefined,
        status: "cancelled",
      });

      const result = calc.compute({
        runId: "run_cancel",
        steps: [step],
        tasks: [makeTaskInput({ id: "task_1", title: "Cancelled step" })],
        fileChanges: [],
        artifacts: [],
        validationResults: [],
      });

      expect(result.summary.totalDiffs).toBe(0);
    });
  });
});
