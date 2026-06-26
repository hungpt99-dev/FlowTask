import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { ProcessManager } from "../../core/process-manager.js";
import { EventStore } from "../../core/event-store.js";
import { ConfigLoader } from "../../config/config-loader.js";

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

  const configLoader = new ConfigLoader();
  const config = await configLoader.load(rootPath);
  const gracefulTimeout = config.process?.gracefulStopTimeoutMs ?? 5000;

  const eventStore = new EventStore(rootPath);
  const processManager = new ProcessManager();

  const hasProcess = processManager.hasActiveProcess(state.activeRunId);

  if (hasProcess) {
    console.log(picocolors.yellow(`\nStopping executor process for run: ${run.title}...`));
    const stopped = await processManager.stopProcess(rootPath, state.activeRunId, gracefulTimeout);

    await eventStore.appendToRun(state.activeRunId, {
      type: stopped ? "process_stopped" : "process_stop_failed",
      runId: state.activeRunId,
      message: stopped ? "Process stopped" : "Failed to stop process",
    });

    if (stopped) {
      console.log(picocolors.green("  Executor process stopped."));
    } else {
      console.log(picocolors.red("  Could not stop executor process."));
    }
  } else {
    console.log(picocolors.dim("  No active executor process found."));
  }

  await runManager.updateRunStatus(state.activeRunId, "interrupted");

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

  await eventStore.appendToRun(state.activeRunId, {
    type: "run_interrupted",
    runId: state.activeRunId,
    message: "Run stopped by user via flowtask stop",
  });

  console.log(picocolors.yellow(`\n✓ Run stopped: ${run.title}`));
  console.log(picocolors.dim(`  Run ID: ${state.activeRunId}`));
  console.log(picocolors.cyan(`  Resume: flowtask resume ${state.activeRunId}`));
}
