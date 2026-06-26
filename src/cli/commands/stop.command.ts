import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { EventStore } from "../../core/event-store.js";

export async function stopCommand(): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const state = await manager.loadState(rootPath);

  if (!state?.activeRunId) {
    console.log(picocolors.yellow("No active run to stop."));
    process.exit(0);
  }

  const runManager = new RunManager(rootPath);
  const run = await runManager.loadRun(state.activeRunId);

  if (!run) {
    console.log(picocolors.red(`Active run not found: ${state.activeRunId}`));
    process.exit(1);
  }

  await runManager.updateRunStatus(state.activeRunId, "interrupted");
  const eventStore = new EventStore(rootPath);
  await eventStore.appendToRun(state.activeRunId, {
    type: "run_interrupted",
    runId: state.activeRunId,
    message: "Run stopped by user",
  });

  const tasks = await runManager.loadTasks(state.activeRunId);
  const runningTasks = tasks.filter((t) => t.status === "running");
  for (const task of runningTasks) {
    await runManager.updateTaskStatus(state.activeRunId, task.id, "interrupted");
  }

  if (state) {
    await manager.saveState(rootPath, {
      ...state,
      status: "has_interrupted_run",
      activeRunId: state.activeRunId,
    });
  }

  console.log(picocolors.yellow(`\nRun stopped: ${run.title}`));
  console.log(picocolors.dim(`  Run ID: ${state.activeRunId}`));
  console.log(picocolors.cyan(`  Resume: flowtask resume ${state.activeRunId}`));
}
