import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";

export async function resumeCommand(runId?: string): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const state = await manager.loadState(rootPath);
  const targetRunId = runId ?? state?.activeRunId ?? state?.lastRunId;

  if (!targetRunId) {
    console.log(picocolors.yellow("No run to resume."));
    process.exit(0);
  }

  const runManager = new RunManager(rootPath);
  const run = await runManager.loadRun(targetRunId);

  if (!run) {
    console.log(picocolors.red(`Run not found: ${targetRunId}`));
    process.exit(1);
  }

  if (run.status === "completed") {
    console.log(picocolors.green(`Run ${targetRunId} is already completed.`));
    process.exit(0);
  }

  const tasks = await runManager.loadTasks(targetRunId);
  const pendingTasks = tasks.filter((t) => t.status === "pending" || t.status === "interrupted");
  const runningTasks = tasks.filter((t) => t.status === "running");

  for (const task of runningTasks) {
    await runManager.updateTaskStatus(targetRunId, task.id, "interrupted");
    console.log(picocolors.yellow(`  Marked task ${task.id} as interrupted (was running)`));
  }

  if (pendingTasks.length === 0 && runningTasks.length === 0) {
    console.log(picocolors.yellow(`No pending or interrupted tasks in run ${targetRunId}.`));
    process.exit(0);
  }

  console.log(picocolors.cyan(`\nResume ready for run: ${run.title}`));
  console.log(`  Run ID: ${targetRunId}`);
  console.log(`  Pending tasks: ${pendingTasks.length}`);
  if (runningTasks.length > 0) {
    console.log(`  Interrupted tasks: ${runningTasks.length}`);
  }
  console.log(picocolors.cyan(`\n  Run: flowtask run "${run.title}" to continue`));
  console.log(picocolors.cyan(`  Or: flowtask inspect ${targetRunId} to review`));
}
