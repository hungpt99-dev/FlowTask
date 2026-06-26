import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";

export async function retryCommand(
  taskId: string,
  options: { run?: string; force?: boolean },
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
    console.log(picocolors.yellow("Use: flowtask retry <taskId> --run <runId>"));
    process.exit(1);
  }

  const runManager = new RunManager(rootPath);
  const run = await runManager.loadRun(runId);

  if (!run) {
    console.log(picocolors.red(`Run not found: ${runId}`));
    process.exit(1);
  }

  const tasks = await runManager.loadTasks(runId);
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    console.log(picocolors.red(`Task not found: ${taskId} in run ${runId}`));
    process.exit(1);
  }

  if (task.status !== "failed" && !options.force) {
    console.log(picocolors.yellow(`Task ${taskId} status is "${task.status}", not "failed".`));
    console.log(picocolors.yellow("Use --force to retry anyway."));
    process.exit(0);
  }

  await runManager.updateTaskStatus(runId, taskId, "pending");
  await runManager.updateRunStatus(runId, "running");
  console.log(picocolors.green(`\n✓ Task ${taskId} reset to pending for retry.`));
  console.log(picocolors.cyan(`  Run: flowtask run "${run.title}" to retry`));
  console.log(picocolors.cyan(`  Or restart with: flowtask run "${run.title}"`));
}
