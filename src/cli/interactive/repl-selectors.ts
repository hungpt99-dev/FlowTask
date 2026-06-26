import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";
import { coloredStatus } from "../../ui/formatters/status-format.js";
import { formatTimeAgo } from "../../ui/formatters/duration-format.js";

export interface SelectedRun {
  runId: string;
  title: string;
}

export interface SelectedTask {
  taskId: string;
  title: string;
  runId: string;
}

export async function selectRun(rootPath: string, label?: string): Promise<SelectedRun | null> {
  const runManager = new RunManager(rootPath);
  const runs = await runManager.listRuns();

  if (runs.length === 0) {
    console.log(picocolors.yellow("  No runs found."));
    return null;
  }

  const recent = runs.slice(0, 10);
  console.log("");
  console.log(picocolors.dim(`  Select a run${label ? ` ${label}` : ""}:`));
  console.log("");

  // Simple numbered list — enquirer works but avoiding extra dep issues
  for (let i = 0; i < recent.length; i++) {
    const run = recent[i]!;
    const status = coloredStatus(run.status.padEnd(12));
    const ago = formatTimeAgo(run.updatedAt);
    console.log(
      `  ${picocolors.cyan(`${i + 1}.`)} ${status} ${picocolors.dim(run.title.slice(0, 30))} ${picocolors.dim(ago)}`,
    );
  }
  console.log(`  ${picocolors.dim("  0. Cancel")}`);
  console.log("");

  const answer = await promptNumber(recent.length);
  if (answer === null || answer === 0) {
    console.log(picocolors.dim("  Cancelled."));
    return null;
  }

  const selected = recent[answer - 1]!;
  return { runId: selected.runId, title: selected.title };
}

export async function selectFailedTask(
  rootPath: string,
  runId?: string,
): Promise<SelectedTask | null> {
  const runManager = new RunManager(rootPath);

  let tasks;

  if (runId) {
    tasks = await runManager.loadTasks(runId);
  } else {
    const runs = await runManager.listRuns();
    // Collect failed tasks from recent runs
    const failed: SelectedTask[] = [];
    for (const run of runs.slice(0, 5)) {
      const runTasks = await runManager.loadTasks(run.runId);
      for (const t of runTasks) {
        if (t.status === "failed") {
          failed.push({ taskId: t.id, title: t.title, runId: run.runId });
        }
      }
    }
    tasks = []; // Not actually Task[] but SelectedTask[]
    // Convert to display format
    return await selectFromFailedList(rootPath, failed);
  }

  const failedTasks = tasks.filter((t) => t.status === "failed");
  return await selectFromFailedList(
    rootPath,
    failedTasks.map((t) => ({ taskId: t.id, title: t.title, runId: t.runId })),
  );
}

async function selectFromFailedList(
  rootPath: string,
  failed: SelectedTask[],
): Promise<SelectedTask | null> {
  if (failed.length === 0) {
    console.log(picocolors.yellow("  No failed tasks found."));
    return null;
  }

  console.log("");
  console.log(picocolors.dim("  Select a failed task:"));
  console.log("");

  for (let i = 0; i < failed.length && i < 10; i++) {
    const t = failed[i]!;
    console.log(
      `  ${picocolors.cyan(`${i + 1}.`)} ${picocolors.red("✗")} ${picocolors.dim(t.title)} ${picocolors.dim(`(${t.taskId})`)}`,
    );
  }
  console.log(`  ${picocolors.dim("  0. Cancel")}`);
  console.log("");

  const answer = await promptNumber(failed.length);
  if (answer === null || answer === 0) {
    console.log(picocolors.dim("  Cancelled."));
    return null;
  }

  return failed[answer - 1]!;
}

export async function confirmAction(message: string, defaultYes?: boolean): Promise<boolean> {
  const prompt = defaultYes ? "[Y/n]" : "[y/N]";
  process.stdout.write(`\n  ${picocolors.yellow("?")} ${message} ${picocolors.dim(prompt)} `);

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

      if (input === "" || input === "y" || input === "yes") {
        console.log(defaultYes !== false ? "yes" : "y");
        resolve(defaultYes !== false);
      } else if (input === "n" || input === "no") {
        console.log("no");
        resolve(false);
      } else {
        resolve(defaultYes === true);
      }
    };

    stdin.on("data", onData);
  });
}

export async function promptNumber(max: number): Promise<number | null> {
  process.stdout.write(`  ${picocolors.dim("Enter number:")} `);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    const onData = (data: Buffer) => {
      const input = data.toString().trim();
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onData);

      if (input === "0") {
        resolve(0);
      } else {
        const num = parseInt(input, 10);
        if (!isNaN(num) && num >= 1 && num <= max) {
          resolve(num);
        } else {
          console.log(picocolors.yellow(`  Invalid choice. Enter 1-${max} or 0 to cancel.`));
          resolve(null);
        }
      }
    };

    stdin.on("data", onData);
  });
}
