import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { RunLifecycle } from "../../core/run-lifecycle.js";
import { ContextPackBuilder } from "../../context/context-pack-builder.js";
import { EventStore } from "../../core/event-store.js";
import { ensureDir, writeTextFile } from "../../utils/fs.js";
import { getContextDir } from "../../utils/paths.js";

export async function retryCommand(
  taskId: string,
  options: { run?: string; continue?: boolean; force?: boolean; dryRun?: boolean },
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

  const isRetryable = task.status === "failed" || task.status === "interrupted" || options.force;

  if (!isRetryable && !options.force) {
    console.log(
      picocolors.yellow(
        `Task ${taskId} status is "${task.status}", not "failed" or "interrupted".`,
      ),
    );
    console.log(picocolors.yellow("Use --force to retry anyway."));
    process.exit(0);
  }

  if (task.retryCount >= task.maxRetries && !options.force) {
    console.log(picocolors.red(`Task ${taskId} has reached max retries (${task.maxRetries}).`));
    console.log(picocolors.yellow("Use --force to bypass."));
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(picocolors.cyan(`\nRetry dry-run for task: ${task.title}`));
    console.log(picocolors.dim(`  Task ID: ${taskId}`));
    console.log(picocolors.dim(`  Run ID: ${runId}`));
    console.log(`  Retry count: ${task.retryCount + 1}/${task.maxRetries}`);
    console.log(`  Executor: ${task.executor}`);
    if (options.continue) {
      const remaining = tasks.filter((t) => t.status === "pending");
      console.log(`  Will continue with ${remaining.length} pending tasks after retry.`);
    }
    process.exit(0);
  }

  const newRetryCount = task.retryCount + 1;
  const project = (await manager.load(rootPath))!;
  const config = await manager.loadConfig(rootPath);
  const eventStore = new EventStore(rootPath);

  await eventStore.appendToRun(runId, {
    type: "retry_started",
    runId,
    taskId,
    details: { retryCount: newRetryCount },
  });

  const previousTaskLog = await runManager.loadTaskOutput(runId, taskId);

  const contextBuilder = new ContextPackBuilder();
  const rulesContext = "";
  const completedTasks = tasks.filter((t) => t.status === "done");

  const retryPack = contextBuilder.build({
    prompt: run.title,
    rulesContext,
    run,
    task: { ...task, retryCount: newRetryCount },
    completedTasks,
    isRetry: true,
    errorLog: previousTaskLog.slice(0, 2000),
  });

  const contextDir = getContextDir(rootPath, runId);
  await ensureDir(contextDir);
  const contextPackPath = `${contextDir}/context-pack.${taskId}.retry_${newRetryCount}.md`;
  await writeTextFile(contextPackPath, retryPack.markdown);

  await eventStore.appendToRun(runId, {
    type: "retry_context_created",
    runId,
    taskId,
    details: { retryCount: newRetryCount, contextPackPath },
  });

  await runManager.updateTaskStatus(runId, taskId, "pending");
  const runLifecycle = new RunLifecycle(rootPath, project.projectId, config);

  await eventStore.appendToRun(runId, {
    type: "retry_executor_started",
    runId,
    taskId,
    message: `Retrying task: ${task.title}`,
  });

  console.log(
    picocolors.cyan(`\nRetrying task: ${task.title} (attempt ${newRetryCount}/${task.maxRetries})`),
  );

  const success = await runLifecycle.executeSingleTask(runId, taskId);

  if (success) {
    await eventStore.appendToRun(runId, {
      type: "retry_completed",
      runId,
      taskId,
      message: "Retry succeeded",
    });
    console.log(picocolors.green(`\n✓ Retry successful: ${task.title}`));
  } else {
    await eventStore.appendToRun(runId, {
      type: "retry_failed",
      runId,
      taskId,
      message: "Retry failed",
    });

    if (newRetryCount >= task.maxRetries) {
      await eventStore.appendToRun(runId, {
        type: "retry_limit_reached",
        runId,
        taskId,
        message: `Max retries (${task.maxRetries}) reached`,
      });
    }

    console.log(picocolors.red(`\n✗ Retry failed: ${task.title}`));
  }

  if (options.continue && success) {
    const remaining = tasks.filter((t) => t.status === "pending" && t.id !== taskId);
    if (remaining.length > 0) {
      console.log(picocolors.cyan(`\nContinuing with ${remaining.length} remaining tasks...`));
      const continueResult = await runLifecycle.continueRun(runId);
      if (continueResult.success) {
        console.log(picocolors.green("\n✓ Run completed after retry"));
      } else {
        console.log(picocolors.red("\n✗ Run failed after retry"));
      }
    }
  }

  process.exit(success ? 0 : 1);
}
