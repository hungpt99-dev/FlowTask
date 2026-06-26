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

  const processMeta = await processManager.read(rootPath, state.activeRunId);

  if (processMeta && processManager.isAlive(processMeta.pid)) {
    console.log(
      picocolors.yellow(
        `\nStopping executor process (PID ${processMeta.pid}) for run: ${run.title}...`,
      ),
    );
    const result = await processManager.stop(rootPath, state.activeRunId, {
      gracefulTimeoutMs: gracefulTimeout,
    });

    let eventType: string;
    if (result.success) {
      eventType = result.finalStatus === "killed" ? "process_force_killed" : "process_stopped";
    } else {
      eventType = result.finalStatus === "stale" ? "process_stale" : "process_stale";
    }
    await eventStore.appendToRun(state.activeRunId, {
      type: eventType as never,
      runId: state.activeRunId,
      message: result.success
        ? `Process ${result.finalStatus}`
        : `Failed to stop process (${result.finalStatus})`,
    });

    if (result.success) {
      console.log(picocolors.green(`  Process ${result.finalStatus}.`));
    } else if (result.finalStatus === "stale") {
      console.log(
        picocolors.yellow(`  Process PID ${processMeta.pid} is stale (no longer running).`),
      );
    } else {
      console.log(picocolors.red(`  Could not stop process (${result.finalStatus}).`));
    }
  } else if (processMeta) {
    console.log(
      picocolors.yellow(
        `  Process PID ${processMeta.pid} is stale (no longer running). Cleaning up.`,
      ),
    );
    await processManager.clear(rootPath, state.activeRunId);
  } else {
    console.log(picocolors.dim("  No active executor process found on disk."));
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
