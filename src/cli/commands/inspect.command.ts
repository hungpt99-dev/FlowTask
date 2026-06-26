import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { EventStore } from "../../core/event-store.js";
import { LogManager } from "../../core/log-manager.js";
import picocolors from "picocolors";
import { coloredSymbol, coloredStatus } from "../../ui/formatters/status-format.js";
import { formatTimeAgo } from "../../ui/formatters/duration-format.js";

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

  // Section: Summary
  console.log(picocolors.cyan(`\n  Inspect Run`));
  console.log(picocolors.dim(`  ${"─".repeat(60)}`));
  console.log(`  ${picocolors.bold(run.title)}`);
  console.log(`  ${picocolors.dim("Run ID:")}     ${run.runId}`);
  console.log(
    `  ${picocolors.dim("Status:")}     ${coloredSymbol(run.status)} ${coloredStatus(run.status)}`,
  );
  console.log(`  ${picocolors.dim("Mode:")}       ${run.mode}`);
  console.log(
    `  ${picocolors.dim("Created:")}    ${new Date(run.createdAt).toLocaleString()} (${formatTimeAgo(run.createdAt)})`,
  );
  console.log(
    `  ${picocolors.dim("Updated:")}    ${new Date(run.updatedAt).toLocaleString()} (${formatTimeAgo(run.updatedAt)})`,
  );
  console.log(
    `  ${picocolors.dim("Progress:")}   ${run.completedTaskCount}/${run.taskCount} tasks`,
  );

  // Section: Tasks
  const tasks = await runManager.loadTasks(runId);
  if (tasks.length > 0) {
    console.log(picocolors.cyan(`\n  Tasks (${tasks.length})`));
    console.log(picocolors.dim(`  ${"─".repeat(60)}`));
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      const icon = coloredSymbol(t.status);
      console.log(`  ${icon} ${t.title}`);
      console.log(
        `      ${picocolors.dim(`ID: ${t.id}, Status: ${t.status}, Executor: ${t.executor}`)}`,
      );
      if (t.retryCount > 0) {
        console.log(`      ${picocolors.dim(`Retries: ${t.retryCount}/${t.maxRetries}`)}`);
      }
      if (t.dependsOn.length > 0) {
        console.log(`      ${picocolors.dim(`Depends: ${t.dependsOn.join(", ")}`)}`);
      }
    }
  }

  // Section: Events
  const eventStore = new EventStore(rootPath);
  const events = await eventStore.readRunEvents(runId);
  if (events.length > 0) {
    console.log(picocolors.cyan(`\n  Events (${events.length})`));
    console.log(picocolors.dim(`  ${"─".repeat(60)}`));
    const lastEvents = events.slice(-8);
    for (const event of lastEvents) {
      const time = picocolors.dim(new Date(event.time).toLocaleTimeString());
      const msg = event.message ? ` — ${picocolors.dim(event.message)}` : "";
      console.log(`  ${time} ${event.type}${msg}`);
    }
  }

  // Section: Logs
  const logManager = new LogManager(rootPath);
  const logFiles = await logManager.listLogFiles(runId);
  if (logFiles.length > 0) {
    console.log(picocolors.cyan(`\n  Log files (${logFiles.length})`));
    console.log(picocolors.dim(`  ${"─".repeat(60)}`));
    for (const file of logFiles) {
      console.log(`  ${picocolors.dim("•")} ${file}`);
    }
  }

  // Section: Commands
  console.log(picocolors.cyan(`\n  Commands`));
  console.log(picocolors.dim(`  ${"─".repeat(60)}`));
  console.log(`  ${picocolors.cyan("  flowtask logs --run")} ${runId}`);
  console.log(`  ${picocolors.cyan("  flowtask tasks --run")} ${runId}`);
  console.log(`  ${picocolors.cyan("  flowtask resume")} ${runId}`);
  console.log(`  ${picocolors.dim(`  Run directory: .flowtask/runs/${runId}`)}`);
  console.log("");
}
