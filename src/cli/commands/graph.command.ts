import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { StepManager } from "../../core/step-manager.js";
import { coloredSymbol } from "../../ui/formatters/status-format.js";

export async function graphCommand(
  runId: string,
  options: {
    json?: boolean;
  },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  let resolvedRunId = runId;
  if (!resolvedRunId) {
    const state = await manager.loadState(rootPath);
    resolvedRunId = state?.activeRunId ?? state?.lastRunId ?? "";
    if (!resolvedRunId) {
      console.log(picocolors.yellow("No run specified and no recent run found."));
      process.exit(0);
    }
  }

  const runManager = new RunManager(rootPath);
  const stepManager = new StepManager(rootPath);

  const run = await runManager.loadRun(resolvedRunId);
  if (!run) {
    console.log(picocolors.red(`Run not found: ${resolvedRunId}`));
    process.exit(1);
  }

  const tasks = await runManager.loadTasks(resolvedRunId);
  if (tasks.length === 0) {
    console.log(picocolors.yellow(`No tasks found for run ${resolvedRunId}`));
    process.exit(0);
  }

  const allSteps: Record<string, import("../../schemas/step.schema.js").Step[]> = {};
  for (const task of tasks) {
    allSteps[task.id] = await stepManager.loadSteps(resolvedRunId, task.id);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        { run: { id: run.runId, title: run.title, status: run.status }, tasks, steps: allSteps },
        null,
        2,
      ),
    );
    return;
  }

  console.log(picocolors.cyan(`\nWorkflow Graph: ${run.title}`));
  console.log(picocolors.dim(`  Run: ${run.runId}  Status: ${run.status}`));
  console.log(picocolors.dim("  " + "─".repeat(50)));

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const icon = coloredSymbol(task.status);
    const isLast = i === tasks.length - 1;
    const branch = isLast ? "  └──" : "  ├──";
    const connector = isLast ? "      " : "  │   ";

    console.log(`  ${icon} ${branch} ${picocolors.bold(task.title)}`);
    console.log(`  ${connector} ${picocolors.dim("ID:")} ${task.id}`);
    console.log(`  ${connector} ${picocolors.dim("Status:")} ${task.status}`);
    if (task.executor) {
      console.log(`  ${connector} ${picocolors.dim("Executor:")} ${task.executor}`);
    }
    if (task.retryCount && task.retryCount > 0) {
      console.log(
        `  ${connector} ${picocolors.dim("Retries:")} ${task.retryCount}/${task.maxRetries}`,
      );
    }

    const steps = allSteps[task.id];
    if (steps && steps.length > 0) {
      for (let j = 0; j < steps.length; j++) {
        const step = steps[j]!;
        const sIcon = coloredSymbol(step.status);
        const sIsLast = j === steps.length - 1;
        const sBranch = sIsLast ? "      └──" : "      ├──";
        console.log(`  ${connector} ${sIcon} ${sBranch} ${picocolors.dim(step.title ?? step.id)}`);
        if (step.status) {
          console.log(`  ${connector} ${sIsLast ? "" : "│  "}     ${picocolors.dim(step.status)}`);
        }
        if (step.status !== "pending" && step.status !== "created") {
          console.log(
            `  ${connector} ${sIsLast ? "" : "│  "}     ${picocolors.dim("Dependencies:")} ${step.dependsOn?.length ?? 0}`,
          );
        }
      }
    }

    if (!isLast) {
      console.log(`  ${picocolors.dim("  │")}`);
    }
  }

  console.log(picocolors.dim(`\n  Legend:`));
  console.log(
    `  ${coloredSymbol("done")} ${picocolors.dim("done")}  ${coloredSymbol("running")} ${picocolors.dim("running")}  ${coloredSymbol("failed")} ${picocolors.dim("failed")}  ${coloredSymbol("pending")} ${picocolors.dim("pending")}  ${coloredSymbol("skipped")} ${picocolors.dim("skipped")}`,
  );
  console.log("");
}
