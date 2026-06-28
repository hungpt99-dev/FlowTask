import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";
import { coloredStatus } from "../../ui/formatters/status-format.js";

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
        const firstRun = runs[0];
        if (!firstRun) {
          console.log(picocolors.yellow('No runs found. Start one with: flowtask run "<prompt>"'));
          process.exit(0);
        }
        options.run = firstRun.runId;
      } else {
        console.log(picocolors.yellow('No runs found. Start one with: flowtask run "<prompt>"'));
        process.exit(0);
      }
    }
  }

  const runId = options.run;
  if (!runId) {
    console.log(picocolors.yellow('No runs found. Start one with: flowtask run "<prompt>"'));
    process.exit(0);
  }

  const tasks = await runManager.loadTasks(runId);

  if (tasks.length === 0) {
    console.log(picocolors.yellow(`No tasks found for run: ${runId}`));
    process.exit(0);
  }

  const filtered = options.status ? tasks.filter((t) => t.status === options.status) : tasks;

  console.log(picocolors.cyan(`\nTasks for run: ${runId}`));
  console.log("");
  console.log(
    `  ${picocolors.bold("ID".padEnd(14))} ${picocolors.bold("Status".padEnd(12))} ${picocolors.bold("Executor".padEnd(12))} ${picocolors.bold("Title")}`,
  );
  console.log(picocolors.dim(`  ${"─".repeat(72)}`));

  for (const t of filtered) {
    console.log(
      `  ${picocolors.dim(t.id.padEnd(14))} ${coloredStatus(t.status.padEnd(10))} ${picocolors.dim((t.executor ?? "shell").padEnd(12))} ${picocolors.cyan(t.title)}`,
    );
    if (t.description) {
      console.log(`  ${"".padEnd(38)}${picocolors.dim(t.description)}`);
    }
  }
  console.log("");
}
