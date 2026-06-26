import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { RunLifecycle } from "../../core/run-lifecycle.js";
import { EventStore } from "../../core/event-store.js";

export async function resumeCommand(
  runId?: string,
  options?: { from?: string; skipInterrupted?: boolean; dryRun?: boolean },
): Promise<void> {
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

  const eventStore = new EventStore(rootPath);
  await eventStore.appendToRun(targetRunId, {
    type: "resume_started",
    runId: targetRunId,
    message: `Resuming run: ${run.title}`,
  });

  const tasks = await runManager.loadTasks(targetRunId);
  const runningTasks = tasks.filter((t) => t.status === "running" || t.status === "interrupted");
  const pendingTasks = tasks.filter((t) => t.status === "pending");

  if (options?.skipInterrupted) {
    for (const task of runningTasks) {
      await runManager.updateTaskStatus(targetRunId, task.id, "skipped");
      console.log(picocolors.yellow(`  Skipped interrupted task: ${task.title}`));
    }
  } else {
    for (const task of runningTasks) {
      await runManager.updateTaskStatus(targetRunId, task.id, "interrupted");
      console.log(picocolors.yellow(`  Marked interrupted: ${task.title}`));
    }
    await eventStore.appendToRun(targetRunId, {
      type: "resume_task_marked_interrupted",
      runId: targetRunId,
    });
  }

  await eventStore.appendToRun(targetRunId, {
    type: "resume_point_detected",
    runId: targetRunId,
    details: { pendingTasks: pendingTasks.length, interruptedTasks: runningTasks.length },
  });

  if (options?.dryRun) {
    console.log(picocolors.cyan(`\nResume dry-run for run: ${run.title}\n`));
    console.log(picocolors.dim(`  Run ID: ${targetRunId}`));
    console.log(`  Pending tasks: ${pendingTasks.length}`);
    console.log(`  Interrupted tasks: ${runningTasks.length}`);
    for (const task of pendingTasks) {
      console.log(`  · ${task.title}`);
    }
    for (const task of runningTasks) {
      if (options.skipInterrupted) {
        console.log(`  − ${task.title} (skipped)`);
      } else {
        console.log(`  · ${task.title} (will retry)`);
      }
    }
    process.exit(0);
  }

  const project = (await manager.load(rootPath))!;
  const config = await manager.loadConfig(rootPath);
  const lifecycle = new RunLifecycle(rootPath, project.projectId, config);

  const resumeTaskId = options?.from;
  const resumeTasks = pendingTasks.filter((t) => !resumeTaskId || t.id === resumeTaskId);

  if (resumeTasks.length === 0 && !options?.skipInterrupted) {
    for (const task of runningTasks) {
      const updated = await runManager.updateTaskStatus(targetRunId, task.id, "pending");
      resumeTasks.push(updated);
    }
  }

  console.log(picocolors.cyan(`\nResuming run: ${run.title}\n`));

  await runManager.updateRunStatus(targetRunId, "running");
  await eventStore.appendToRun(targetRunId, {
    type: "resume_continued",
    runId: targetRunId,
    message: `Continuing with ${resumeTasks.length} tasks`,
  });

  const result = await lifecycle.continueRun(targetRunId);
  if (result.success) {
    await eventStore.appendToRun(targetRunId, {
      type: "resume_completed",
      runId: targetRunId,
      message: "Resume completed successfully",
    });
    console.log(picocolors.green("\n✓ Resume completed"));
  } else {
    await eventStore.appendToRun(targetRunId, {
      type: "resume_failed",
      runId: targetRunId,
      message: "Resume failed",
    });
    console.log(picocolors.red("\n✗ Resume failed"));
  }
}
