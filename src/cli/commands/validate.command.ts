import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { ValidationEngine } from "../../validation/validation-engine.js";
import { coloredStatus } from "../../ui/formatters/status-format.js";
import { now } from "../../utils/time.js";

export async function validateCommand(
  runId: string,
  options: {
    task?: string;
    step?: string;
    verbose?: boolean;
  },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  let resolvedRunId = runId;
  if (!resolvedRunId) {
    const state = await manager.loadState(rootPath);
    resolvedRunId = state?.activeRunId ?? state?.lastRunId ?? "";
    if (!resolvedRunId) {
      console.log(picocolors.yellow("No run specified and no recent run found."));
      process.exit(0);
    }
  }

  const config = await manager.loadConfig(rootPath);
  const runManager = new RunManager(rootPath);
  const validationEngine = new ValidationEngine(config);

  const tasks = await runManager.loadTasks(resolvedRunId);
  if (tasks.length === 0) {
    console.log(picocolors.yellow(`No tasks found for run ${resolvedRunId}`));
    process.exit(0);
  }

  const tasksToValidate = options.task
    ? tasks.filter((t) => t.id === options.task || t.title.includes(options.task!))
    : tasks;

  if (tasksToValidate.length === 0) {
    console.log(picocolors.yellow(`No matching tasks found.`));
    process.exit(0);
  }

  console.log(picocolors.cyan(`\nValidating run ${resolvedRunId}`));
  console.log(picocolors.dim("  " + "─".repeat(50)));

  let allPassed = true;

  for (const task of tasksToValidate) {
    const output = await runManager.loadTaskOutput(resolvedRunId, task.id);

    const timestamp = now();

    const executorResult = {
      exitCode: task.status === "done" ? 0 : 1,
      stdout: output || "",
      stderr: "",
      output: output || "",
      taskId: task.id,
      status: task.status === "done" ? ("done" as const) : ("failed" as const),
      startedAt: timestamp,
      finishedAt: timestamp,
    };

    try {
      const result = await validationEngine.validateTask({
        projectRoot: rootPath,
        task,
        executorResult,
      });

      const statusIcon =
        result.status === "passed"
          ? picocolors.green("\u2713")
          : result.status === "warning"
            ? picocolors.yellow("!")
            : picocolors.red("\u2717");

      console.log(`\n  ${statusIcon} ${picocolors.bold(task.title)}`);
      console.log(`     ${picocolors.dim("Status:")} ${coloredStatus(result.status)}`);
      console.log(`     ${picocolors.dim("Checks:")} ${result.checks?.length ?? 0} total`);

      if (result.checks && options.verbose) {
        for (const check of result.checks) {
          const cs =
            check.status === "passed"
              ? picocolors.green("\u2713")
              : check.status === "failed"
                ? picocolors.red("\u2717")
                : picocolors.yellow("~");
          console.log(
            `       ${cs} ${picocolors.dim(check.type)}: ${check.message?.slice(0, 100) ?? ""}`,
          );
        }
      }

      if (result.status !== "passed") {
        allPassed = false;
        if (result.failureReason) {
          const reason =
            typeof result.failureReason === "string"
              ? result.failureReason
              : result.failureReason.reason;
          console.log(`       ${picocolors.dim("Reason:")} ${reason}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${picocolors.red("\u2717")} ${picocolors.bold(task.title)}`);
      console.log(`     ${picocolors.red("Validation error:")} ${msg}`);
      allPassed = false;
    }
  }

  console.log("");
  if (allPassed) {
    console.log(picocolors.green("  \u2713 All validations passed"));
  } else {
    console.log(picocolors.red("  \u2717 Some validations failed"));
  }
  console.log("");

  process.exitCode = allPassed ? 0 : 1;
}
