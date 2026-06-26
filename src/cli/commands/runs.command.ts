import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";

export async function runsCommand(options: { status?: string; limit?: string }): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runManager = new RunManager(rootPath);
  const runs = await runManager.listRuns();

  if (runs.length === 0) {
    console.log(picocolors.yellow('No runs yet. Start one with: flowtask run "<prompt>"'));
    process.exit(0);
  }

  const limit = parseInt(options.limit ?? "20", 10);
  const filtered = options.status ? runs.filter((r) => r.status === options.status) : runs;

  const display = filtered.slice(0, limit);

  console.log(picocolors.cyan(`\nRuns (${display.length}/${filtered.length} shown)`));
  console.log(picocolors.dim("─".repeat(60)));

  if (display.length === 0) {
    console.log(picocolors.yellow("No runs matching filter."));
    process.exit(0);
  }

  for (const run of display) {
    const statusColor = getStatusColor(run.status);
    const date = new Date(run.createdAt).toLocaleString();
    console.log(
      `  ${statusColor(run.status.padEnd(12))} ${picocolors.dim(run.runId.slice(0, 40).padEnd(42))} ${picocolors.cyan(run.title.slice(0, 30))}`,
    );
    console.log(`  ${"".padEnd(12)} ${picocolors.dim(date)}`);
    console.log("");
  }
}

function getStatusColor(status: string): (s: string) => string {
  switch (status) {
    case "completed":
      return picocolors.green;
    case "running":
      return picocolors.cyan;
    case "failed":
      return picocolors.red;
    case "cancelled":
      return picocolors.yellow;
    case "interrupted":
      return picocolors.yellow;
    default:
      return picocolors.dim;
  }
}
