import picocolors from "picocolors";
import { RunManager } from "../../core/run-manager.js";
import { formatTimeAgo } from "../../ui/formatters/duration-format.js";
import { selectRun, selectFailedTask, promptNumber } from "./repl-selectors.js";

export async function showActionsMenu(rootPath: string, runId: string): Promise<void> {
  const runManager = new RunManager(rootPath);
  const run = await runManager.loadRun(runId);
  if (!run) return;

  const tasks = await runManager.loadTasks(runId);
  const failed = tasks.filter((t) => t.status === "failed");
  const done = tasks.filter((t) => t.status === "done");
  const isComplete = failed.length === 0;
  const taskStatus = isComplete ? "completed" : "failed";

  console.log("");
  console.log(picocolors.dim(`  ${"─".repeat(56)}`));
  console.log(
    `  ${isComplete ? picocolors.green("✓") : picocolors.red("✗")} ${picocolors.bold(taskStatus === "completed" ? "Run Completed" : "Run Failed")}`,
  );
  console.log(picocolors.dim(`  ${"─".repeat(56)}`));
  console.log(`  ${picocolors.dim("Prompt:")}  ${run.title}`);
  console.log(`  ${picocolors.dim("Tasks:")}   ${done.length}/${tasks.length} completed`);

  if (failed.length > 0) {
    console.log(`  ${picocolors.dim("Failed:")}  ${failed.map((t) => t.title).join(", ")}`);
  }

  const ago = formatTimeAgo(run.updatedAt);
  console.log(`  ${picocolors.dim("Time:")}    ${ago}`);
  console.log(picocolors.dim(`  ${"─".repeat(56)}`));
  console.log("");

  if (failed.length > 0) {
    console.log(`  ${picocolors.cyan("Actions:")}`);
    console.log(`    ${picocolors.dim("[r]")} Retry failed tasks`);
    console.log(`    ${picocolors.dim("[l]")} View task logs`);
    console.log(`    ${picocolors.dim("[i]")} Inspect run`);
  } else {
    console.log(`  ${picocolors.cyan("Actions:")}`);
    console.log(`    ${picocolors.dim("[l]")} View logs`);
    console.log(`    ${picocolors.dim("[d]")} View git diff`);
    console.log(`    ${picocolors.dim("[i]")} Inspect run`);
  }

  console.log(`    ${picocolors.dim("[r]")} Run another task`);
  console.log(`    ${picocolors.dim("[q]")} Return to prompt`);
  console.log("");

  const action = await promptAction();
  await handleAction(action, rootPath, runId, failed);
}

async function promptAction(): Promise<string> {
  process.stdout.write(`  ${picocolors.dim("Choose action:")} `);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    const onData = (data: Buffer) => {
      const input = data.toString().trim().toLowerCase();
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onData);
      console.log(input || "q");
      resolve(input || "q");
    };

    stdin.on("data", onData);
  });
}

async function handleAction(
  action: string,
  rootPath: string,
  runId: string,
  failed: Array<{ id: string; title: string }>,
): Promise<void> {
  switch (action) {
    case "r": {
      if (failed.length > 0) {
        for (const task of failed) {
          const { retryCommand } = await import("../commands/retry.command.js");
          await retryCommand(task.id, {});
        }
      } else {
        console.log(picocolors.dim("  Type: run <prompt> to start a new run."));
      }
      break;
    }
    case "l": {
      const { logsCommand } = await import("../commands/logs.command.js");
      await logsCommand({ follow: true, run: runId, tail: "50" });
      break;
    }
    case "i": {
      const { inspectCommand } = await import("../commands/inspect.command.js");
      await inspectCommand(runId);
      break;
    }
    case "d": {
      console.log(picocolors.dim("  Use: git diff to view changes."));
      break;
    }
    case "q":
      break;
    default:
      break;
  }
}

export async function showCommandPalette(rootPath: string): Promise<string | null> {
  console.log("");
  console.log(picocolors.dim(`  ${"─".repeat(50)}`));
  console.log(`  ${picocolors.bold("What do you want to do?")}`);
  console.log(picocolors.dim(`  ${"─".repeat(50)}`));
  console.log(`  ${picocolors.cyan("1.")} New run`);
  console.log(`  ${picocolors.cyan("2.")} Resume latest run`);
  console.log(`  ${picocolors.cyan("3.")} Retry failed task`);
  console.log(`  ${picocolors.cyan("4.")} View recent runs`);
  console.log(`  ${picocolors.cyan("5.")} View failed tasks`);
  console.log(`  ${picocolors.cyan("6.")} Follow logs`);
  console.log(`  ${picocolors.cyan("7.")} Run doctor`);
  console.log(`  ${picocolors.cyan("8.")} Show history`);
  console.log(`  ${picocolors.cyan("0.")} Back to prompt`);
  console.log(picocolors.dim(`  ${"─".repeat(50)}`));
  console.log("");

  const choice = await promptNumber(8);

  switch (choice) {
    case 1:
      return "run";
    case 2: {
      const selected = await selectRun(rootPath, "to resume");
      if (selected) {
        const { resumeCommand } = await import("../commands/resume.command.js");
        await resumeCommand(selected.runId, {});
      }
      return null;
    }
    case 3: {
      const selected = await selectFailedTask(rootPath);
      if (selected) {
        const { retryCommand } = await import("../commands/retry.command.js");
        await retryCommand(selected.taskId, {});
      }
      return null;
    }
    case 4: {
      const { runsCommand } = await import("../commands/runs.command.js");
      await runsCommand({ status: undefined, limit: "20" });
      return null;
    }
    case 5: {
      const task = await selectFailedTask(rootPath);
      if (task) {
        const { logsCommand } = await import("../commands/logs.command.js");
        await logsCommand({ task: task.taskId, run: task.runId, tail: "50" });
      }
      return null;
    }
    case 6: {
      const runMgr = new RunManager(rootPath);
      const runs = await runMgr.listRuns();
      if (runs.length > 0) {
        const { logsCommand } = await import("../commands/logs.command.js");
        await logsCommand({ follow: true, run: runs[0]!.runId, tail: "50" });
      }
      return null;
    }
    case 7: {
      const { doctorCommand } = await import("../commands/doctor.command.js");
      await doctorCommand();
      return null;
    }
    case 8: {
      const { ReplHistory } = await import("./repl-history.js");
      const history = new ReplHistory({ projectRoot: rootPath });
      const lines = await history.load();
      if (lines.length === 0) {
        console.log(picocolors.dim("  No history yet."));
      } else {
        console.log("");
        console.log(picocolors.dim("  Recent commands:"));
        console.log("");
        for (const line of lines.slice(-10).reverse()) {
          console.log(`  ${picocolors.dim("•")} ${line}`);
        }
      }
      return null;
    }
    default:
      return null;
  }
}
