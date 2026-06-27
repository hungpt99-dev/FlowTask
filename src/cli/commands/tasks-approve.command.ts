import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";

export async function tasksApproveCommand(
  taskId: string,
  options: { run?: string },
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
    console.log(picocolors.yellow("Use: flowtask tasks approve <taskId> --run <runId>"));
    process.exit(1);
  }

  const runManager = new RunManager(rootPath);
  const tasks = await runManager.loadTasks(runId);
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    console.log(picocolors.red(`Task not found: ${taskId} in run ${runId}`));
    process.exit(1);
  }

  if (task.status !== "waiting_approval") {
    console.log(
      picocolors.yellow(
        `Task ${taskId} status is "${task.status}", not "waiting_approval". Nothing to approve.`,
      ),
    );
    process.exit(0);
  }

  await runManager.updateTaskStatus(runId, taskId, "pending");
  console.log(picocolors.green(`\n✓ Task ${taskId} approved and set to pending.`));
  console.log(picocolors.dim(`  Title: ${task.title}`));
  console.log("");
}

export async function tasksDenyCommand(taskId: string, options: { run?: string }): Promise<void> {
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
    console.log(picocolors.yellow("Use: flowtask tasks deny <taskId> --run <runId>"));
    process.exit(1);
  }

  const runManager = new RunManager(rootPath);
  const tasks = await runManager.loadTasks(runId);
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    console.log(picocolors.red(`Task not found: ${taskId} in run ${runId}`));
    process.exit(1);
  }

  if (task.status !== "waiting_approval") {
    console.log(
      picocolors.yellow(
        `Task ${taskId} status is "${task.status}", not "waiting_approval". Nothing to deny.`,
      ),
    );
    process.exit(0);
  }

  await runManager.updateTaskStatus(runId, taskId, "skipped");
  console.log(picocolors.yellow(`\n✗ Task ${taskId} denied and set to skipped.`));
  console.log(picocolors.dim(`  Title: ${task.title}`));
  console.log("");
}
