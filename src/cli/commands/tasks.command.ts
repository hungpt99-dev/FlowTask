import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";

export async function tasksCommand(options: {
  run?: string;
  all?: boolean;
  status?: string;
}): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runManager = new RunManager(rootPath);

  if (!options.run) {
    const state = await manager.loadState(rootPath);
    if (state?.activeRunId || state?.lastRunId) {
      options.run = state?.activeRunId ?? state?.lastRunId;
    } else {
      const runs = await runManager.listRuns();
      if (runs.length > 0) {
        options.run = runs[0]!.runId;
      } else {
        console.log(picocolors.yellow('No runs found. Start one with: flowtask run "<prompt>"'));
        process.exit(0);
      }
    }
  }

  const tasks = await runManager.loadTasks(options.run!);

  if (tasks.length === 0) {
    console.log(picocolors.yellow(`No tasks found for run: ${options.run}`));
    process.exit(0);
  }

  const filtered = options.status ? tasks.filter((t) => t.status === options.status) : tasks;

  console.log(picocolors.cyan(`\nTasks for run: ${options.run}`));
  console.log(picocolors.dim("─".repeat(60)));

  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i]!;
    const icon = statusIcon(t.status);
    const statusColor = taskStatusColor(t.status);
    const deps = t.dependsOn.length > 0 ? ` [depends: ${t.dependsOn.join(", ")}]` : "";
    console.log(
      `  ${icon} ${statusColor(t.status.padEnd(14))} ${picocolors.cyan(t.title)}${picocolors.dim(deps)}`,
    );
    if (t.description) {
      console.log(`  ${"".padEnd(16)}${picocolors.dim(t.description)}`);
    }
    console.log("");
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "done":
      return "✓";
    case "running":
      return "◌";
    case "failed":
      return "✗";
    case "pending":
      return "·";
    case "skipped":
      return "−";
    case "cancelled":
      return "−";
    default:
      return "·";
  }
}

function taskStatusColor(status: string): (s: string) => string {
  switch (status) {
    case "done":
      return picocolors.green;
    case "running":
      return picocolors.cyan;
    case "failed":
      return picocolors.red;
    case "pending":
      return picocolors.dim;
    case "skipped":
      return picocolors.yellow;
    default:
      return picocolors.dim;
  }
}
