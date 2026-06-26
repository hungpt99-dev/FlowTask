import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { EventStore } from "../../core/event-store.js";
import { LogManager } from "../../core/log-manager.js";
import picocolors from "picocolors";

export async function inspectCommand(runId: string): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runManager = new RunManager(rootPath);
  const run = await runManager.loadRun(runId);

  if (!run) {
    console.log(picocolors.red(`Run not found: ${runId}`));
    process.exit(1);
  }

  console.log(picocolors.cyan(`\nInspect Run: ${run.title}`));
  console.log(picocolors.dim("─".repeat(60)));
  console.log(`  Run ID:     ${run.runId}`);
  console.log(`  Status:     ${runStatusColor(run)}`);
  console.log(`  Mode:       ${run.mode}`);
  console.log(`  Created:    ${new Date(run.createdAt).toLocaleString()}`);
  console.log(`  Updated:    ${new Date(run.updatedAt).toLocaleString()}`);
  console.log(`  Progress:   ${run.completedTaskCount}/${run.taskCount} tasks`);

  const tasks = await runManager.loadTasks(runId);
  if (tasks.length > 0) {
    console.log(picocolors.cyan("\n  Tasks:"));
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      console.log(`    ${taskIcon(t.status)} ${t.title}`);
      console.log(`       ID: ${t.id}, Status: ${t.status}, Executor: ${t.executor}`);
      if (t.retryCount > 0) {
        console.log(`       Retries: ${t.retryCount}/${t.maxRetries}`);
      }
    }
  }

  const eventStore = new EventStore(rootPath);
  const events = await eventStore.readRunEvents(runId);
  if (events.length > 0) {
    console.log(picocolors.cyan(`\n  Events (${events.length}):`));
    const lastEvents = events.slice(-5);
    for (const event of lastEvents) {
      console.log(
        `    ${picocolors.dim(new Date(event.time).toLocaleTimeString())} ${event.type}${event.message ? ` — ${event.message}` : ""}`,
      );
    }
  }

  const logManager = new LogManager(rootPath);
  const logFiles = await logManager.listLogFiles(runId);
  if (logFiles.length > 0) {
    console.log(picocolors.cyan(`\n  Log files (${logFiles.length}):`));
    for (const file of logFiles) {
      console.log(`    📄 ${file}`);
    }
  }

  console.log(picocolors.dim(`\n  Run directory: .flowtask/runs/${runId}`));
  console.log("");
  console.log(picocolors.cyan("  Commands:"));
  console.log(picocolors.cyan(`    flowtask logs --run ${runId}`));
  console.log(picocolors.cyan(`    flowtask tasks --run ${runId}`));
  console.log(picocolors.cyan(`    flowtask runs`));
}

function runStatusColor(run: { status: string }): string {
  switch (run.status) {
    case "completed":
      return picocolors.green("completed");
    case "running":
      return picocolors.cyan("running");
    case "failed":
      return picocolors.red("failed");
    case "cancelled":
      return picocolors.yellow("cancelled");
    default:
      return picocolors.dim(run.status);
  }
}

function taskIcon(status: string): string {
  switch (status) {
    case "done":
      return picocolors.green("✓");
    case "running":
      return picocolors.cyan("◌");
    case "failed":
      return picocolors.red("✗");
    case "pending":
      return picocolors.dim("·");
    default:
      return picocolors.dim("·");
  }
}
