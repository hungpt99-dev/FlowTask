import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { StepManager } from "../../core/step-manager.js";
import { WorkflowDiffCalculator, type WorkflowDiffInputs } from "../../core/workflow-diff.js";
import { ArtifactManager } from "../../core/artifact-manager.js";
import { DatabaseManager } from "../../core/database-manager.js";
import { FileTracker } from "../../core/file-tracker.js";
import { ValidationEngine } from "../../validation/validation-engine.js";
import picocolors from "picocolors";
import { coloredStatus } from "../../ui/formatters/status-format.js";
import { dbPath } from "../../utils/paths.js";
import { now } from "../../utils/time.js";

export async function diffCommand(
  runId1: string,
  runId2: string | undefined,
  options: { json?: boolean; detailed?: boolean; workflow?: boolean },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  if (options.workflow || !runId2) {
    await showWorkflowDiff(rootPath, runId1, options);
    return;
  }

  const runManager = new RunManager(rootPath);
  await showRunComparison(rootPath, runId1, runId2, runManager, options);
}

async function showWorkflowDiff(
  rootPath: string,
  runId: string,
  options: { json?: boolean; detailed?: boolean },
): Promise<void> {
  const manager = new ProjectManager();
  const config = await manager.loadConfig(rootPath);
  const runManager = new RunManager(rootPath);

  const run = await runManager.loadRun(runId);
  if (!run) {
    console.log(picocolors.red(`Run not found: ${runId}`));
    process.exit(1);
  }

  const stepManager = new StepManager(rootPath);
  const allStepsByTask = await stepManager.loadAllSteps(runId);
  const allSteps = Object.values(allStepsByTask).flat();

  const tasks = await runManager.loadTasks(runId);

  const db = await DatabaseManager.create(dbPath(rootPath));
  const artifactManager = new ArtifactManager();
  artifactManager.setDatabase(db);

  const validationEngine = new ValidationEngine(config);

  const fileTracker = new FileTracker();
  const fileChanges = await fileTracker.getChangesByRun(rootPath, runId);
  const artifacts = artifactManager.getArtifactsByRun(rootPath, runId);

  const validationResults: WorkflowDiffInputs["validationResults"] = [];

  for (const task of tasks) {
    try {
      const output = await runManager.loadTaskOutput(runId, task.id);
      const timestamp = now();
      const result = await validationEngine.validateTask({
        projectRoot: rootPath,
        task,
        executorResult: {
          status: task.status === "done" ? ("done" as const) : ("failed" as const),
          output: output || "",
          exitCode: task.status === "done" ? 0 : 1,
          startedAt: timestamp,
          finishedAt: timestamp,
        },
      });
      validationResults.push(result as (typeof validationResults)[number]);
    } catch {
      // skip failed validation
    }
  }

  const calculator = new WorkflowDiffCalculator();
  const diffResult = calculator.compute({
    runId,
    steps: allSteps,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      expectedResult: t.acceptanceCriteria?.join("; "),
      acceptanceCriteria: t.acceptanceCriteria,
    })),
    fileChanges,
    artifacts,
    validationResults,
  });

  db.close();

  if (options.json) {
    console.log(JSON.stringify(diffResult, null, 2));
    return;
  }

  const { summary } = diffResult;

  console.log(picocolors.cyan(`\nWorkflow Diff: ${run.title}`));
  console.log(picocolors.dim(`  Run: ${run.runId} \u00B7 Status: ${run.status}`));
  console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));

  console.log(`\n  ${picocolors.dim("Summary:")}`);
  console.log(`    Total diffs:   ${diffResult.items.length}`);
  console.log(`    Errors:        ${summary.bySeverity.error ?? 0}`);
  console.log(`    Warnings:      ${summary.bySeverity.warning ?? 0}`);
  console.log(`    Info:          ${summary.bySeverity.info ?? 0}`);

  const issueFlags: Array<{ key: string; value: boolean }> = [
    { key: "missing_outputs", value: summary.hasMissingOutputs },
    { key: "extra_outputs", value: summary.hasExtraOutputs },
    { key: "unexpected_file_changes", value: summary.hasUnexpectedFileChanges },
    { key: "skipped_verification", value: summary.hasSkippedVerification },
    { key: "plan_drift", value: summary.hasPlanDrift },
    { key: "executor_drift", value: summary.hasExecutorDrift },
    { key: "validation_drift", value: summary.hasValidationDrift },
    { key: "risk_mismatch", value: summary.hasRiskMismatch },
  ];

  const detectedIssues = issueFlags.filter((f) => f.value).map((f) => f.key);

  if (detectedIssues.length > 0) {
    console.log(`\n  ${picocolors.dim("Issues detected:")}`);
    for (const issue of detectedIssues) {
      console.log(`    ${picocolors.yellow("!")} ${issue.replace(/_/g, " ")}`);
    }
  }

  if (diffResult.items.length > 0) {
    const itemsByCategory = groupBy(diffResult.items, (i) => i.category);
    for (const [category, items] of Object.entries(itemsByCategory)) {
      const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
      console.log(picocolors.cyan(`\n  ${catLabel} (${items.length})`));
      console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));

      const maxShow = options.detailed ? 50 : 15;
      for (const item of items.slice(0, maxShow)) {
        const icon =
          item.severity === "error"
            ? picocolors.red("\u2717")
            : item.severity === "warning"
              ? picocolors.yellow("!")
              : picocolors.dim("\u2022");
        console.log(`  ${icon} ${item.label}`);
        if (options.detailed && item.detail) {
          console.log(`     ${picocolors.dim(item.detail)}`);
        }
      }
      if (items.length > maxShow) {
        console.log(picocolors.dim(`     ... and ${items.length - maxShow} more`));
      }
    }
  }

  console.log(
    picocolors.dim(`\n  Tip: flowtask diff --workflow --json ${runId} for machine-readable output`),
  );
  console.log("");
}

async function showRunComparison(
  rootPath: string,
  runId1: string,
  runId2: string,
  runManager: RunManager,
  options: { json?: boolean; detailed?: boolean },
): Promise<void> {
  const run1 = await runManager.loadRun(runId1);
  const run2 = await runManager.loadRun(runId2);

  if (!run1) {
    console.log(picocolors.red(`Run not found: ${runId1}`));
    process.exit(1);
  }
  if (!run2) {
    console.log(picocolors.red(`Run not found: ${runId2}`));
    process.exit(1);
  }

  const comparison = await runManager.compareRuns(runId1, runId2);

  if (options.json) {
    const detailed = options.detailed ? await runManager.compareRunsDetailed(runId1, runId2) : null;
    console.log(JSON.stringify(detailed ?? comparison, null, 2));
    return;
  }

  console.log(picocolors.cyan(`\n  Run Comparison`));
  console.log(picocolors.dim(`  ${"\u2500".repeat(62)}`));
  console.log(
    `  ${picocolors.dim("Run 1:")}     ${coloredStatus(run1.status.padEnd(12))} ${picocolors.cyan(run1.title)} (${run1.runId})`,
  );
  console.log(
    `  ${picocolors.dim("Run 2:")}     ${coloredStatus(run2.status.padEnd(12))} ${picocolors.cyan(run2.title)} (${run2.runId})`,
  );
  console.log("");

  console.log(
    `  Same project:  ${comparison.sameProject ? picocolors.green("Yes") : picocolors.yellow("No")}`,
  );
  console.log(
    `  Status match:   ${comparison.statusMatch ? picocolors.green("Yes") : picocolors.yellow("No")}`,
  );
  console.log("");

  console.log(`  Task count diff:      ${fmtDiff(comparison.taskCountDiff)}`);
  console.log(`  Completed diff:       ${fmtDiff(comparison.completedDiff)}`);
  console.log(`  Error diff:           ${fmtDiff(comparison.errorDiff)}`);
  if (comparison.timeBetween != null) {
    const hours = Math.floor(comparison.timeBetween / 3600000);
    const mins = Math.floor((comparison.timeBetween % 3600000) / 60000);
    console.log(`  Time between:        ${hours}h ${mins}m`);
  }

  if (options.detailed) {
    const detailed = await runManager.compareRunsDetailed(runId1, runId2);
    const { taskDiff } = detailed;

    if (taskDiff.onlyIn1.length > 0) {
      console.log(picocolors.yellow(`\n  Only in Run 1 (${taskDiff.onlyIn1.length}):`));
      for (const t of taskDiff.onlyIn1) {
        console.log(`    ${picocolors.yellow("\u2022")} ${t.title} (${t.status})`);
      }
    }

    if (taskDiff.onlyIn2.length > 0) {
      console.log(picocolors.green(`\n  Only in Run 2 (${taskDiff.onlyIn2.length}):`));
      for (const t of taskDiff.onlyIn2) {
        console.log(`    ${picocolors.green("\u2022")} ${t.title} (${t.status})`);
      }
    }

    const changed = taskDiff.both.filter((b) => b.changed);
    if (changed.length > 0) {
      console.log(picocolors.cyan(`\n  Changed Tasks (${changed.length}):`));
      for (const b of changed) {
        console.log(`    ${picocolors.cyan("\u2022")} ${b.id}: ${b.status1} \u2192 ${b.status2}`);
      }
    }
  }

  console.log("");
}

function fmtDiff(diff: number): string {
  if (diff > 0) return picocolors.green(`+${diff}`);
  if (diff < 0) return picocolors.red(`${diff}`);
  return picocolors.dim("0");
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}
