import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { StepManager } from "../../core/step-manager.js";
import { EventStore } from "../../core/event-store.js";

export async function skipCommand(
  stepId: string,
  options: {
    run?: string;
    task?: string;
    reason?: string;
  },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  let runId = options.run;
  if (!runId) {
    const state = await manager.loadState(rootPath);
    runId = state?.activeRunId ?? state?.lastRunId;
  }

  if (!runId) {
    console.log(picocolors.red("No run specified and no recent run found."));
    console.log(picocolors.yellow("Use: flowtask skip <stepId> --run <runId> --task <taskId>"));
    process.exit(1);
  }

  const runManager = new RunManager(rootPath);
  const stepManager = new StepManager(rootPath);
  const eventStore = new EventStore(rootPath);

  const run = await runManager.loadRun(runId);
  if (!run) {
    console.log(picocolors.red(`Run not found: ${runId}`));
    process.exit(1);
  }

  if (options.task) {
    const step = await stepManager.getStep(runId, options.task, stepId);
    if (!step) {
      console.log(picocolors.red(`Step not found: ${stepId} in task ${options.task}`));
      process.exit(1);
    }

    await stepManager.updateStep(runId, options.task, stepId, { status: "skipped" });

    await eventStore.appendToRun(runId, {
      type: "task_skipped",
      runId,
      taskId: options.task,
      details: { stepId, reason: options.reason },
    });

    console.log(picocolors.yellow(`\n  \u2212 Skipped step: ${step.title ?? stepId}`));
    if (options.reason) {
      console.log(picocolors.dim(`  Reason: ${options.reason}`));
    }
    console.log("");
    return;
  }

  const tasks = await runManager.loadTasks(runId);
  let found = false;

  for (const task of tasks) {
    const step = await stepManager.getStep(runId, task.id, stepId);
    if (step) {
      await stepManager.updateStep(runId, task.id, stepId, { status: "skipped" });

      await eventStore.appendToRun(runId, {
        type: "task_skipped",
        runId,
        taskId: task.id,
        details: { stepId, reason: options.reason },
      });

      console.log(picocolors.yellow(`\n  \u2212 Skipped step: ${step.title ?? stepId}`));
      console.log(picocolors.dim(`  Task: ${task.id}`));
      if (options.reason) {
        console.log(picocolors.dim(`  Reason: ${options.reason}`));
      }
      console.log("");
      found = true;
      break;
    }
  }

  if (!found) {
    console.log(picocolors.red(`Step not found: ${stepId} in any task.`));
    console.log(picocolors.yellow("Use --task <taskId> to specify the containing task."));
    process.exit(1);
  }
}
