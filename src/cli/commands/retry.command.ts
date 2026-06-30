import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { RunLifecycle } from "../../core/run-lifecycle.js";
import { ContextPackBuilder } from "../../context/context-pack-builder.js";
import { EventStore } from "../../core/event-store.js";
import { ensureDir, writeTextFile } from "../../utils/fs.js";
import { getContextDir } from "../../utils/paths.js";

export async function retryCommand(
  taskIdOrRunId: string,
  options: {
    run?: string;
    continue?: boolean;
    force?: boolean;
    dryRun?: boolean;
    failedOnly?: boolean;
    from?: string;
    skipValidation?: boolean;
    instruction?: string | string[];
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
  const taskId = taskIdOrRunId;

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

  const allTasks = await runManager.loadTasks(runId);
  let tasksToRetry: typeof allTasks = [];

  if (options.failedOnly) {
    tasksToRetry = allTasks.filter((t) => t.status === "failed" || t.status === "interrupted");
    if (tasksToRetry.length === 0) {
      console.log(picocolors.yellow(`No failed or interrupted tasks in run ${runId}.`));
      process.exit(0);
    }
    console.log(picocolors.cyan(`\nRetrying ${tasksToRetry.length} failed tasks...`));
  } else if (options.from) {
    const fromIdx = allTasks.findIndex(
      (t) => t.id === options.from || t.title.includes(options.from!),
    );
    if (fromIdx === -1) {
      console.log(picocolors.red(`Task not found: ${options.from}`));
      process.exit(1);
    }
    tasksToRetry = allTasks.slice(fromIdx);
    console.log(picocolors.cyan(`\nRetrying from task "${tasksToRetry[0]!.title}"...`));
  } else {
    const task = allTasks.find((t) => t.id === taskId || t.title.includes(taskId));
    if (task) {
      tasksToRetry = [task];
    }
  }

  if (tasksToRetry.length === 0) {
    console.log(picocolors.red(`Task not found: ${taskId} in run ${runId}`));
    process.exit(1);
  }

  const retryableTasks = tasksToRetry.filter(
    (t) => t.status === "failed" || t.status === "interrupted" || options.force,
  );

  if (retryableTasks.length === 0 && !options.failedOnly && !options.from) {
    console.log(
      picocolors.yellow(
        `Task "${tasksToRetry[0]!.title}" status is "${tasksToRetry[0]!.status}", not "failed" or "interrupted".`,
      ),
    );
    console.log(picocolors.yellow("Use --force to retry anyway."));
    process.exit(0);
  }

  const instructions = options.instruction
    ? Array.isArray(options.instruction)
      ? options.instruction
      : [options.instruction]
    : [];

  if (options.dryRun) {
    if (tasksToRetry.length === 1) {
      const t = tasksToRetry[0]!;
      console.log(picocolors.cyan(`\nRetry dry-run for task: ${t.title}`));
      console.log(picocolors.dim(`  Task ID: ${t.id}`));
      console.log(picocolors.dim(`  Run ID: ${runId}`));
      console.log(`  Retry count: ${t.retryCount + 1}/${t.maxRetries}`);
      console.log(`  Executor: ${t.executor}`);
      if (instructions.length > 0) {
        console.log(picocolors.cyan(`  Instruction: ${instructions.join(", ")}`));
      }
    } else {
      console.log(picocolors.cyan(`\nRetry dry-run for ${tasksToRetry.length} tasks`));
      console.log(picocolors.dim(`  Run ID: ${runId}`));
      for (const t of tasksToRetry) {
        console.log(
          `  ${picocolors.dim("\u2022")} ${t.title} (attempt ${t.retryCount + 1}/${t.maxRetries})`,
        );
      }
      if (instructions.length > 0) {
        console.log(picocolors.cyan(`  Instruction: ${instructions.join(", ")}`));
      }
    }
    if (options.continue) {
      const remaining = allTasks.filter((t) => t.status === "pending");
      console.log(`  Will continue with ${remaining.length} pending tasks after retry.`);
    }
    process.exit(0);
  }

  const project = (await manager.load(rootPath))!;
  const config = await manager.loadConfig(rootPath);
  const runLifecycle = new RunLifecycle(rootPath, project.projectId, config, undefined, {
    skipValidation: options.skipValidation,
  });

  let anySuccess = false;
  let anyFailed = false;

  for (const task of tasksToRetry) {
    if (!(task.status === "failed" || task.status === "interrupted" || options.force)) {
      console.log(picocolors.yellow(`Skipping "${task.title}" (status: ${task.status})`));
      continue;
    }

    if (task.retryCount >= task.maxRetries && !options.force) {
      console.log(picocolors.red(`Task ${task.id} has reached max retries (${task.maxRetries}).`));
      console.log(picocolors.yellow("Use --force to bypass."));
      if (!options.failedOnly && !options.from) {
        process.exit(1);
      }
      continue;
    }

    const indTaskId = task.id;
    const newRetryCount = task.retryCount + 1;
    const eventStore = new EventStore(rootPath);

    await eventStore.appendToRun(runId, {
      type: "retry_started",
      runId,
      taskId: indTaskId,
      details: { retryCount: newRetryCount },
    });

    if (instructions.length > 0) {
      const instructionNote = instructions
        .map((i) => `**Additional instruction:** ${i}`)
        .join("\n\n");
      task.description = [task.description, instructionNote].filter(Boolean).join("\n\n");
      await runManager.updateTask(runId, indTaskId, { description: task.description });
      console.log(picocolors.cyan(`  Instruction: ${instructions.join(", ")}`));
    }

    const previousTaskLog = await runManager.loadTaskOutput(runId, indTaskId);

    const contextBuilder = new ContextPackBuilder();
    const rulesContext = await runManager.loadRulesContext(runId);
    const completedTasks = allTasks.filter((t) => t.status === "done");

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
    const contextPackPath = `${contextDir}/context-pack.${indTaskId}.retry_${newRetryCount}.md`;
    await writeTextFile(contextPackPath, retryPack.markdown);

    await eventStore.appendToRun(runId, {
      type: "retry_context_created",
      runId,
      taskId: indTaskId,
      details: { retryCount: newRetryCount, contextPackPath },
    });

    await runManager.updateTaskStatus(runId, indTaskId, "pending");

    await eventStore.appendToRun(runId, {
      type: "retry_executor_started",
      runId,
      taskId: indTaskId,
      message: `Retrying task: ${task.title}`,
    });

    console.log(
      picocolors.cyan(
        `\nRetrying task: ${task.title} (attempt ${newRetryCount}/${task.maxRetries})`,
      ),
    );

    const success = await runLifecycle.executeSingleTask(runId, indTaskId);

    if (success) {
      await eventStore.appendToRun(runId, {
        type: "retry_completed",
        runId,
        taskId: indTaskId,
        message: "Retry succeeded",
      });
      console.log(picocolors.green(`\n\u2713 Retry successful: ${task.title}`));
      anySuccess = true;
    } else {
      await eventStore.appendToRun(runId, {
        type: "retry_failed",
        runId,
        taskId: indTaskId,
        message: "Retry failed",
      });

      if (newRetryCount >= task.maxRetries) {
        await eventStore.appendToRun(runId, {
          type: "retry_limit_reached",
          runId,
          taskId: indTaskId,
          message: `Max retries (${task.maxRetries}) reached`,
        });
      }

      console.log(picocolors.red(`\n\u2717 Retry failed: ${task.title}`));
      anyFailed = true;
    }
  }

  if (options.continue && anySuccess) {
    const remaining = allTasks.filter((t) => t.status === "pending");
    if (remaining.length > 0) {
      console.log(picocolors.cyan(`\nContinuing with ${remaining.length} remaining tasks...`));
      const continueResult = await runLifecycle.continueRun(runId);
      if (continueResult.success) {
        console.log(picocolors.green("\n\u2713 Run completed after retry"));
      } else {
        console.log(picocolors.red("\n\u2717 Run failed after retry"));
      }
    }
  }

  process.exit(anySuccess && !anyFailed ? 0 : 1);
}
