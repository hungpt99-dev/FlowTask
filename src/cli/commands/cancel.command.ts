import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { EventStore } from "../../core/event-store.js";

export async function cancelCommand(runId: string): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runManager = new RunManager(rootPath);
  const run = await runManager.loadRun(runId);

  if (!run) {
    console.log(picocolors.red(`Run not found: ${runId}`));
    process.exit(1);
  }

  if (run.status === "completed" || run.status === "cancelled") {
    console.log(picocolors.yellow(`Run ${runId} is already ${run.status}.`));
    process.exit(0);
  }

  await runManager.updateRunStatus(runId, "cancelled");

  const tasks = await runManager.loadTasks(runId);
  for (const task of tasks) {
    if (task.status === "running" || task.status === "pending") {
      await runManager.updateTaskStatus(runId, task.id, "cancelled");
    }
  }

  const eventStore = new EventStore(rootPath);
  await eventStore.appendToRun(runId, {
    type: "run_failed",
    runId,
    message: "Run cancelled by user",
  });

  const state = await manager.loadState(rootPath);
  if (state?.activeRunId === runId) {
    await manager.saveState(rootPath, {
      ...state,
      status: "idle",
      activeRunId: undefined,
      lastRunId: runId,
    });
  }

  console.log(picocolors.yellow(`\n✓ Run cancelled: ${run.title}`));
  console.log(picocolors.dim(`  Run ID: ${runId}`));
}
