import { z } from "zod";
import type { Step } from "../schemas/step.schema.js";
import type { FileChange } from "./file-tracker.js";
import type { ArtifactRecord } from "../schemas/artifact.schema.js";
import type { ValidationResult } from "../schemas/validation.schema.js";
import type { AiPlannerOutput } from "../schemas/planner.schema.js";
import { now } from "../utils/time.js";

export const DiffCategorySchema = z.enum([
  "outputs",
  "files",
  "artifacts",
  "commands",
  "validation",
  "risk",
]);

export const DiffSeveritySchema = z.enum(["info", "warning", "error"]);

export const DiffTypeSchema = z.enum([
  "missing_output",
  "extra_output",
  "unexpected_file_change",
  "missing_file_change",
  "missing_artifact",
  "extra_artifact",
  "skipped_verification",
  "plan_drift",
  "executor_drift",
  "validation_drift",
  "risk_level_mismatch",
  "missing_command",
  "extra_command",
  "output_value_mismatch",
  "validation_status_mismatch",
]);

export const WorkflowDiffItemSchema = z.object({
  category: DiffCategorySchema,
  severity: DiffSeveritySchema,
  type: DiffTypeSchema,
  stepId: z.string().optional(),
  taskId: z.string().optional(),
  label: z.string(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  detail: z.string().optional(),
});

export const WorkflowDiffSummarySchema = z.object({
  totalDiffs: z.number().int().min(0),
  byCategory: z.record(z.number().int()),
  bySeverity: z.record(z.number().int()),
  byType: z.record(z.number().int()),
  hasMissingOutputs: z.boolean(),
  hasExtraOutputs: z.boolean(),
  hasUnexpectedFileChanges: z.boolean(),
  hasSkippedVerification: z.boolean(),
  hasPlanDrift: z.boolean(),
  hasExecutorDrift: z.boolean(),
  hasValidationDrift: z.boolean(),
  hasRiskMismatch: z.boolean(),
});

export const WorkflowDiffResultSchema = z.object({
  runId: z.string(),
  generatedAt: z.string().datetime(),
  summary: WorkflowDiffSummarySchema,
  items: z.array(WorkflowDiffItemSchema),
});

export type DiffCategory = z.infer<typeof DiffCategorySchema>;
export type DiffSeverity = z.infer<typeof DiffSeveritySchema>;
export type DiffType = z.infer<typeof DiffTypeSchema>;
export type WorkflowDiffItem = z.infer<typeof WorkflowDiffItemSchema>;
export type WorkflowDiffSummary = z.infer<typeof WorkflowDiffSummarySchema>;
export type WorkflowDiffResult = z.infer<typeof WorkflowDiffResultSchema>;

export interface WorkflowDiffTaskInput {
  id: string;
  title: string;
  expectedResult?: string;
  outputPlan?: Array<{ action: string; target: string }>;
  acceptanceCriteria?: string[];
}

export interface WorkflowDiffInputs {
  runId: string;
  steps: Step[];
  tasks: WorkflowDiffTaskInput[];
  fileChanges: FileChange[];
  artifacts: ArtifactRecord[];
  validationResults: ValidationResult[];
  plan?: AiPlannerOutput;
}

export class WorkflowDiffCalculator {
  compute(inputs: WorkflowDiffInputs): WorkflowDiffResult {
    const items: WorkflowDiffItem[] = [];

    const outputDiffs = this.diffOutputs(inputs);
    items.push(...outputDiffs);

    const fileDiffs = this.diffFiles(inputs);
    items.push(...fileDiffs);

    const artifactDiffs = this.diffArtifacts(inputs);
    items.push(...artifactDiffs);

    const commandDiffs = this.diffCommands(inputs);
    items.push(...commandDiffs);

    const validationDiffs = this.diffValidation(inputs);
    items.push(...validationDiffs);

    const riskDiffs = this.diffRisk(inputs);
    items.push(...riskDiffs);

    const summary = this.buildSummary(items);

    return {
      runId: inputs.runId,
      generatedAt: now(),
      summary,
      items,
    };
  }

  private diffOutputs(inputs: WorkflowDiffInputs): WorkflowDiffItem[] {
    const items: WorkflowDiffItem[] = [];

    for (const step of inputs.steps) {
      const expectedOutput = step.expectedOutput;
      const actualOutput = step.output;

      if (expectedOutput && !actualOutput) {
        items.push({
          category: "outputs",
          severity: "error",
          type: "missing_output",
          stepId: step.id,
          taskId: step.taskId,
          label: `Step "${step.title}": expected output not produced`,
          expected: expectedOutput,
          actual: undefined,
          detail: "Step has expectedOutput defined but no actual output was recorded",
        });
      }

      if (expectedOutput && actualOutput) {
        const expectedKeys = Object.keys(expectedOutput);
        for (const key of expectedKeys) {
          const expectedVal = JSON.stringify(expectedOutput[key]);
          const actualVal = JSON.stringify(actualOutput[key]);
          if (!(key in actualOutput)) {
            items.push({
              category: "outputs",
              severity: "warning",
              type: "missing_output",
              stepId: step.id,
              taskId: step.taskId,
              label: `Step "${step.title}": missing expected output key "${key}"`,
              expected: expectedOutput[key],
              actual: undefined,
              detail: `Expected output key "${key}" was not found in actual output`,
            });
          } else if (expectedVal !== actualVal) {
            items.push({
              category: "outputs",
              severity: "warning",
              type: "output_value_mismatch",
              stepId: step.id,
              taskId: step.taskId,
              label: `Step "${step.title}": output value mismatch for key "${key}"`,
              expected: expectedOutput[key],
              actual: actualOutput[key],
              detail: `Expected "${expectedVal}" but got "${actualVal}"`,
            });
          }
        }

        const actualKeys = Object.keys(actualOutput);
        for (const key of actualKeys) {
          if (!(key in expectedOutput)) {
            items.push({
              category: "outputs",
              severity: "info",
              type: "extra_output",
              stepId: step.id,
              taskId: step.taskId,
              label: `Step "${step.title}": unexpected output key "${key}"`,
              expected: undefined,
              actual: actualOutput[key],
              detail: `Extra output key "${key}" was not part of the expected output plan`,
            });
          }
        }
      }

      if (
        step.expectedResult &&
        !step.output &&
        step.status !== "skipped" &&
        step.status !== "cancelled"
      ) {
        items.push({
          category: "outputs",
          severity: "warning",
          type: "missing_output",
          stepId: step.id,
          taskId: step.taskId,
          label: `Step "${step.title}": expected result not reflected in output`,
          expected: step.expectedResult,
          actual: undefined,
          detail: `Step expected "${step.expectedResult}" but no output was produced`,
        });
      }
    }

    if (inputs.plan) {
      const plannedOutputTargets = new Set<string>();
      for (const task of inputs.plan.tasks) {
        if (task.outputPlan) {
          for (const op of task.outputPlan) {
            plannedOutputTargets.add(`${task.title}:${op.target}`);
          }
        }
      }

      const stepTargets = new Set<string>();
      for (const step of inputs.steps) {
        if (step.outputPlan) {
          for (const op of step.outputPlan) {
            stepTargets.add(`${step.title}:${op.target}`);
          }
        }
      }

      for (const planned of plannedOutputTargets) {
        if (!stepTargets.has(planned)) {
          const [taskTitle, target] = planned.split(":");
          items.push({
            category: "outputs",
            severity: "warning",
            type: "plan_drift",
            label: `Planned output "${target}" from task "${taskTitle}" was not found in executed steps`,
            expected: planned,
            actual: undefined,
            detail: "The plan specified this output but no step produced it",
          });
        }
      }
    }

    return items;
  }

  private diffFiles(inputs: WorkflowDiffInputs): WorkflowDiffItem[] {
    const items: WorkflowDiffItem[] = [];

    const expectedFiles = new Set<string>();
    const plannedFiles = new Set<string>();

    for (const step of inputs.steps) {
      const stepFiles = step.metadata?.targetFiles;
      if (Array.isArray(stepFiles)) {
        for (const f of stepFiles) {
          expectedFiles.add(f);
        }
      }
      if (step.outputPlan) {
        for (const op of step.outputPlan) {
          if (op.action === "create" || op.action === "modify") {
            expectedFiles.add(op.target);
          }
        }
      }
    }

    if (inputs.plan) {
      for (const task of inputs.plan.tasks) {
        for (const f of task.targetFiles ?? []) {
          plannedFiles.add(f);
          expectedFiles.add(f);
        }
        for (const op of task.outputPlan ?? []) {
          if (op.action === "create" || op.action === "modify") {
            expectedFiles.add(op.target);
          }
        }
      }
    }

    const actualChangedFiles = new Set<string>();
    const unexpectedChanges: FileChange[] = [];

    for (const change of inputs.fileChanges) {
      actualChangedFiles.add(change.filePath);
      if (change.category === "unexpected") {
        unexpectedChanges.push(change);
      }
    }

    const actualCreatedOrModified = new Set<string>();
    for (const change of inputs.fileChanges) {
      if (change.type === "created" || change.type === "modified") {
        actualCreatedOrModified.add(change.filePath);
      }
    }

    for (const expected of expectedFiles) {
      const matched = Array.from(actualCreatedOrModified).some(
        (a) => a.includes(expected) || expected.includes(a),
      );
      if (!matched) {
        items.push({
          category: "files",
          severity: "warning",
          type: "missing_file_change",
          label: `Expected file change not found: "${expected}"`,
          expected,
          actual: undefined,
          detail:
            "Expected this file to be created or modified but no matching change was detected",
        });
      }
    }

    for (const change of unexpectedChanges) {
      items.push({
        category: "files",
        severity: "warning",
        type: "unexpected_file_change",
        stepId: change.stepId,
        taskId: change.taskId,
        label: `Unexpected file change: "${change.filePath}" (${change.type})`,
        expected: undefined,
        actual: { filePath: change.filePath, type: change.type, summary: change.summary },
        detail: change.summary,
      });
    }

    const sensitiveChanges = inputs.fileChanges.filter((c) => c.category === "sensitive");
    for (const change of sensitiveChanges) {
      const isExpected = Array.from(expectedFiles).some((e) => change.filePath.includes(e));
      if (!isExpected) {
        items.push({
          category: "files",
          severity: "error",
          type: "unexpected_file_change",
          stepId: change.stepId,
          taskId: change.taskId,
          label: `Sensitive file changed: "${change.filePath}"`,
          expected: undefined,
          actual: { filePath: change.filePath, type: change.type },
          detail: `Sensitive file ${change.filePath} was ${change.type}. Verify this change is authorized.`,
        });
      }
    }

    return items;
  }

  private diffArtifacts(inputs: WorkflowDiffInputs): WorkflowDiffItem[] {
    const items: WorkflowDiffItem[] = [];

    const expectedArtifactPaths = new Set<string>();
    const plannedArtifactPaths = new Set<string>();

    for (const step of inputs.steps) {
      if (step.outputPlan) {
        for (const op of step.outputPlan) {
          expectedArtifactPaths.add(op.target);
        }
      }
    }

    if (inputs.plan) {
      for (const task of inputs.plan.tasks) {
        for (const a of task.targetArtifacts ?? []) {
          plannedArtifactPaths.add(a);
          expectedArtifactPaths.add(a);
        }
      }
    }

    const actualArtifactPaths = new Set(inputs.artifacts.map((a) => a.filePath));
    const actualArtifactTitles = new Set(inputs.artifacts.map((a) => a.title));

    for (const expected of expectedArtifactPaths) {
      const found = Array.from(actualArtifactPaths).some(
        (a) => a.includes(expected) || expected.includes(a),
      );
      if (!found) {
        const foundByTitle = Array.from(actualArtifactTitles).some(
          (t) => t.includes(expected) || expected.includes(t),
        );
        if (!foundByTitle) {
          items.push({
            category: "artifacts",
            severity: "warning",
            type: "missing_artifact",
            label: `Expected artifact not found: "${expected}"`,
            expected,
            actual: undefined,
            detail: "No artifact matching this path or title was created during execution",
          });
        }
      }
    }

    const unexpectedArtifacts = inputs.artifacts.filter((a) => a.origin === "unexpected");
    for (const artifact of unexpectedArtifacts) {
      items.push({
        category: "artifacts",
        severity: "info",
        type: "extra_artifact",
        stepId: artifact.stepId,
        taskId: artifact.taskId,
        label: `Unexpected artifact: "${artifact.title}" (${artifact.type})`,
        expected: undefined,
        actual: { path: artifact.filePath, type: artifact.type },
        detail:
          artifact.summary ?? `Artifact "${artifact.title}" was not part of the expected plan`,
      });
    }

    return items;
  }

  private diffCommands(inputs: WorkflowDiffInputs): WorkflowDiffItem[] {
    const items: WorkflowDiffItem[] = [];
    const plannedCommands = new Map<string, string[]>();

    if (inputs.plan) {
      for (const task of inputs.plan.tasks) {
        const cmds = task.commands ?? [];
        if (cmds.length > 0) {
          plannedCommands.set(task.title, cmds);
        }
      }
    }

    const executedCommands = new Map<string, string[]>();
    for (const step of inputs.steps) {
      if (step.command) {
        const arr = executedCommands.get(step.taskId) ?? [];
        arr.push(step.command);
        executedCommands.set(step.taskId, arr);
      }
    }

    if (inputs.plan) {
      for (const [taskTitle, cmds] of plannedCommands) {
        const matchingTask = inputs.steps.find(
          (s) => s.title === taskTitle || s.taskId === taskTitle,
        );
        if (matchingTask) {
          const actualCmds = executedCommands.get(matchingTask.taskId) ?? [];
          for (const plannedCmd of cmds) {
            const found = actualCmds.some((a) => a.includes(plannedCmd) || plannedCmd.includes(a));
            if (!found) {
              items.push({
                category: "commands",
                severity: "warning",
                type: "missing_command",
                stepId: matchingTask.id,
                taskId: matchingTask.taskId,
                label: `Planned command not executed: "${plannedCmd}"`,
                expected: plannedCmd,
                actual: undefined,
                detail: `The plan specified "${plannedCmd}" but this command was not found in step execution`,
              });
            }
          }

          const stepForTask = inputs.steps.find((s) => s.id === matchingTask.id);
          if (stepForTask?.command && cmds.length > 0) {
            const executed = stepForTask.command;
            const anyPlannedMatch = cmds.some((c) => executed.includes(c) || c.includes(executed));
            if (!anyPlannedMatch && cmds.length > 0) {
              items.push({
                category: "commands",
                severity: "info",
                type: "extra_command",
                stepId: stepForTask.id,
                taskId: stepForTask.taskId,
                label: `Executed command differs from planned: "${executed}"`,
                expected: cmds.join("; "),
                actual: executed,
                detail: "The executed command does not match any of the planned commands",
              });
            }
          }
        }
      }
    }

    for (const step of inputs.steps) {
      if (step.command && inputs.plan) {
        const planTask = inputs.plan.tasks.find(
          (t) =>
            t.title === step.title ||
            inputs.tasks.some((it) => it.id === step.taskId && it.title === t.title),
        );
        if (!planTask) {
          continue;
        }

        const plannedType = planTask.taskType;
        const stepType = step.type;
        if (plannedType && stepType) {
          const typeMap: Record<string, string> = {
            general: "command",
            coding: "command",
            documentation: "command",
            research: "command",
            data: "command",
            writing: "command",
            design: "command",
            qa: "command",
            release: "command",
            operations: "command",
            testing: "command",
            analysis: "ai",
            review: "ai",
            approval: "manual",
            validation: "command",
          };
          const expectedStepType = typeMap[plannedType] ?? "command";
          if (stepType !== expectedStepType && stepType !== "command") {
            items.push({
              category: "commands",
              severity: "info",
              type: "executor_drift",
              stepId: step.id,
              taskId: step.taskId,
              label: `Step "${step.title}" type mismatch: planned type "${plannedType}" mapped to executor "${expectedStepType}" but step type is "${stepType}"`,
              expected: expectedStepType,
              actual: stepType,
              detail:
                "The step's executor type differs from what the plan expected for this task type",
            });
          }
        }
      }
    }

    return items;
  }

  private diffValidation(inputs: WorkflowDiffInputs): WorkflowDiffItem[] {
    const items: WorkflowDiffItem[] = [];

    const taskValidationMap = new Map<string, { expected: string[]; actual?: ValidationResult }>();
    for (const task of inputs.tasks) {
      const validations: string[] = [...(task.acceptanceCriteria ?? [])];
      if (task.expectedResult) {
        validations.push(task.expectedResult);
      }
      taskValidationMap.set(task.id, { expected: validations });
    }

    for (const vr of inputs.validationResults) {
      const existing = taskValidationMap.get(vr.taskId);
      if (existing) {
        existing.actual = vr;
      } else {
        taskValidationMap.set(vr.taskId, { expected: [], actual: vr });
      }
    }

    for (const [taskId, entry] of taskValidationMap) {
      const task = inputs.tasks.find((t) => t.id === taskId);
      if (!task) continue;

      if (entry.expected.length > 0 && !entry.actual) {
        items.push({
          category: "validation",
          severity: "error",
          type: "skipped_verification",
          taskId,
          label: `Validation skipped for task "${task.title}"`,
          expected: entry.expected.join("; "),
          actual: undefined,
          detail: `Task has ${entry.expected.length} expected validation criteria but no validation result was recorded`,
        });
      }

      if (entry.actual && entry.expected.length > 0) {
        if (entry.actual.status === "passed") {
          const passedChecks = entry.actual.checks.filter((c) => c.status === "passed");
          const totalChecks = entry.actual.checks.length;

          if (passedChecks.length < totalChecks) {
            const failedChecks = entry.actual.checks.filter(
              (c) => c.status !== "passed" && c.status !== "running" && c.status !== "pending",
            );
            for (const check of failedChecks) {
              items.push({
                category: "validation",
                severity: "warning",
                type: "validation_drift",
                taskId,
                label: `Validation check "${check.type}" had status "${check.status}" for task "${task.title}"`,
                expected: "passed",
                actual: check.status,
                detail: check.message ?? `${check.type} validation check did not pass`,
              });
            }
          }
        } else {
          items.push({
            category: "validation",
            severity: "error",
            type: "validation_drift",
            taskId,
            label: `Overall validation result was "${entry.actual.status}" for task "${task.title}"`,
            expected: "passed",
            actual: entry.actual.status,
            detail:
              (typeof entry.actual.failureReason === "string"
                ? entry.actual.failureReason
                : entry.actual.failureReason?.reason) ?? "Validation did not pass",
          });
        }
      }
    }

    const checkedTaskIds = new Set(inputs.validationResults.map((v) => v.taskId));
    for (const step of inputs.steps) {
      if (
        step.expectedResult &&
        !checkedTaskIds.has(step.taskId) &&
        step.status !== "skipped" &&
        step.status !== "cancelled"
      ) {
        items.push({
          category: "validation",
          severity: "warning",
          type: "skipped_verification",
          stepId: step.id,
          taskId: step.taskId,
          label: `No validation result for step "${step.title}" despite having expected result`,
          expected: step.expectedResult,
          actual: undefined,
          detail: "Step has an expected result but no validation was performed",
        });
      }
    }

    if (inputs.plan) {
      for (const task of inputs.plan.tasks) {
        const matchingTask = inputs.tasks.find((t) => t.title === task.title);
        if (!matchingTask) continue;

        const vr = inputs.validationResults.find((v) => v.taskId === matchingTask.id);
        if (!vr && task.validation?.commands && task.validation.commands.length > 0) {
          items.push({
            category: "validation",
            severity: "warning",
            type: "skipped_verification",
            taskId: matchingTask.id,
            label: `Planned validation commands not executed for task "${task.title}"`,
            expected: task.validation.commands.join("; "),
            actual: undefined,
            detail: `Plan specified ${task.validation.commands.length} validation command(s) but no validation was run`,
          });
        }
      }
    }

    return items;
  }

  private diffRisk(inputs: WorkflowDiffInputs): WorkflowDiffItem[] {
    const items: WorkflowDiffItem[] = [];

    if (!inputs.plan) return items;

    for (const task of inputs.plan.tasks) {
      const plannedRisk = task.riskLevel ?? "safe";
      const matchingTask = inputs.tasks.find((t) => t.title === task.title);
      if (!matchingTask) continue;

      const step = inputs.steps.find((s) => s.taskId === matchingTask.id);
      if (!step) continue;

      const stepErrors = step.errors ?? [];
      const hasErrors = stepErrors.length > 0;
      const retryCount = stepErrors.length;
      const isFailed = step.status === "failed";
      const isStuck = step.status === "stuck";

      const riskOrder: Record<string, number> = {
        safe: 0,
        low: 0,
        risky: 1,
        medium: 1,
        dangerous: 2,
        high: 2,
      };
      const plannedRiskLevel = riskOrder[plannedRisk] ?? 0;

      if (plannedRiskLevel >= 2 && !step.requiresApproval) {
        items.push({
          category: "risk",
          severity: "warning",
          type: "risk_level_mismatch",
          stepId: step.id,
          taskId: step.taskId,
          label: `High-risk task "${task.title}" did not require approval`,
          expected: { riskLevel: plannedRisk, requiresApproval: true },
          actual: { riskLevel: plannedRisk, requiresApproval: false },
          detail: `Task was planned as "${plannedRisk}" risk but no approval gate was configured`,
        });
      }

      if (isFailed || isStuck) {
        items.push({
          category: "risk",
          severity: "error",
          type: "risk_level_mismatch",
          stepId: step.id,
          taskId: step.taskId,
          label: `Task "${task.title}" failed during execution`,
          expected: "succeeded",
          actual: step.status,
          detail: hasErrors
            ? `Step encountered ${retryCount} error(s) and ended with status "${step.status}"`
            : `Step ended with status "${step.status}"`,
        });
      }

      if (hasErrors) {
        items.push({
          category: "risk",
          severity: "info",
          type: "risk_level_mismatch",
          stepId: step.id,
          taskId: step.taskId,
          label: `Task "${task.title}" required ${retryCount} retries`,
          expected: 0,
          actual: retryCount,
          detail: `Step was retried ${retryCount} time(s)`,
        });
      }
    }

    return items;
  }

  private buildSummary(items: WorkflowDiffItem[]): WorkflowDiffSummary {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const item of items) {
      byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
      bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
      byType[item.type] = (byType[item.type] ?? 0) + 1;
    }

    return {
      totalDiffs: items.length,
      byCategory,
      bySeverity,
      byType,
      hasMissingOutputs: items.some((i) => i.type === "missing_output"),
      hasExtraOutputs: items.some((i) => i.type === "extra_output"),
      hasUnexpectedFileChanges: items.some((i) => i.type === "unexpected_file_change"),
      hasSkippedVerification: items.some((i) => i.type === "skipped_verification"),
      hasPlanDrift: items.some((i) => i.type === "plan_drift"),
      hasExecutorDrift: items.some((i) => i.type === "executor_drift"),
      hasValidationDrift: items.some((i) => i.type === "validation_drift"),
      hasRiskMismatch: items.some((i) => i.type === "risk_level_mismatch"),
    };
  }
}
