import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";
import { coloredStatus } from "../../ui/formatters/status-format.js";
import { formatTimeAgo } from "../../ui/formatters/duration-format.js";

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
  console.log("");
  console.log(
    `  ${picocolors.bold("Status".padEnd(12))} ${picocolors.bold("Title".padEnd(36))} ${picocolors.bold("Updated")}`,
  );
  console.log(picocolors.dim(`  ${"─".repeat(72)}`));

  for (const run of display) {
    const statusStr = coloredStatus(run.status.padEnd(10));
    const title = picocolors.cyan(run.title.slice(0, 35).padEnd(35));
    const ago = formatTimeAgo(run.updatedAt);
    console.log(`  ${statusStr} ${title} ${ago}`);
  }
  console.log("");
}
