import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";
import { coloredStatus } from "../../ui/formatters/status-format.js";
import { formatTimeAgo } from "../../ui/formatters/duration-format.js";

export async function historyCommand(options: {
  status?: string;
  limit?: string;
  mode?: string;
  query?: string;
  offset?: string;
  createdAfter?: string;
  createdBefore?: string;
  hasErrors?: boolean;
  unfinished?: boolean;
  json?: boolean;
}): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runManager = new RunManager(rootPath);
  const allRuns = await runManager.listRuns();

  if (allRuns.length === 0) {
    console.log(picocolors.yellow("No runs yet."));
    process.exit(0);
  }

  const limit = parseInt(options.limit ?? "30", 10);
  const offset = parseInt(options.offset ?? "0", 10);

  let filtered = allRuns;

  if (options.status) {
    const statuses = options.status.split(",");
    filtered = filtered.filter((r) => statuses.includes(r.status));
  }

  if (options.mode) {
    const modes = options.mode.split(",");
    filtered = filtered.filter((r) => r.mode && modes.includes(r.mode));
  }

  if (options.query) {
    const q = options.query.toLowerCase();
    filtered = filtered.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.userGoal?.toLowerCase().includes(q) ?? false),
    );
  }

  if (options.createdAfter) {
    const after = new Date(options.createdAfter).getTime();
    filtered = filtered.filter((r) => new Date(r.createdAt).getTime() >= after);
  }

  if (options.createdBefore) {
    const before = new Date(options.createdBefore).getTime();
    filtered = filtered.filter((r) => new Date(r.createdAt).getTime() <= before);
  }

  if (options.hasErrors) {
    filtered = filtered.filter((r) => (r.errorCount ?? 0) > 0);
  }

  if (options.unfinished) {
    filtered = filtered.filter(
      (r) => !["completed", "succeeded", "failed", "cancelled", "skipped"].includes(r.status),
    );
  }

  const display = filtered.slice(offset, offset + limit);

  if (options.json) {
    console.log(JSON.stringify(display, null, 2));
    return;
  }

  console.log(
    picocolors.cyan(
      `\nRun History (${display.length}/${filtered.length} shown, ${allRuns.length} total)`,
    ),
  );
  if (options.query) {
    console.log(picocolors.dim(`  Search: "${options.query}"`));
  }
  console.log("");
  console.log(
    `  ${picocolors.bold("Status".padEnd(14))} ${picocolors.bold("Title".padEnd(34))} ${picocolors.bold("Tasks".padEnd(7))} ${picocolors.bold("Updated")}`,
  );
  console.log(picocolors.dim(`  ${"─".repeat(78)}`));

  for (const run of display) {
    const statusStr = coloredStatus(run.status.padEnd(12));
    const title = picocolors.cyan(run.title.slice(0, 33).padEnd(33));
    const tasksStr = picocolors.dim(
      `${run.completedTaskCount ?? 0}/${run.taskCount ?? 0}`.padStart(5),
    );
    const ago = run.finishedAt
      ? `${formatTimeAgo(run.finishedAt)} ${picocolors.green("✓")}`
      : formatTimeAgo(run.updatedAt);
    console.log(`  ${statusStr} ${title} ${tasksStr}  ${ago}`);
  }

  if (display.length > 0) {
    console.log("");
    console.log(picocolors.dim(`  Tip: flowtask show <runId> for details`));
  }
  console.log("");
}
