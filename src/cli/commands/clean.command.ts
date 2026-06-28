import picocolors from "picocolors";
import Enquirer from "enquirer";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";

export async function cleanCommand(options: {
  olderThan?: string;
  status?: string;
  dryRun?: boolean;
  yes?: boolean;
}): Promise<void> {
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
    console.log(picocolors.yellow("No runs to clean."));
    process.exit(0);
  }

  let toDelete = runs;

  if (options.status) {
    toDelete = toDelete.filter((r) => r.status === options.status);
  }

  if (options.olderThan) {
    const match = options.olderThan.match(/^(\d+)([dhms])$/);
    if (!match) {
      console.log(
        picocolors.red(`Invalid duration format: ${options.olderThan}. Use e.g. 30d, 7d, 24h`),
      );
      process.exit(1);
    }
    const amount = parseInt(match[1]!, 10);
    const unit = match[2]!;
    const multipliers: Record<string, number> = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
    const cutoff = Date.now() - amount * (multipliers[unit] ?? 86400000);
    toDelete = toDelete.filter((r) => new Date(r.createdAt).getTime() < cutoff);
  }

  if (toDelete.length === 0) {
    console.log(picocolors.yellow("No runs match the filter criteria."));
    process.exit(0);
  }

  if (options.dryRun) {
    console.log(picocolors.cyan(`\nDry run: would delete ${toDelete.length} run(s):`));
    for (const run of toDelete) {
      console.log(`  ${picocolors.dim(run.runId)} ${run.title} (${run.status})`);
    }
    console.log(picocolors.dim("\nRun without --dry-run to actually delete."));
    process.exit(0);
  }

  if (!options.yes) {
    const enquirer = new Enquirer();
    let confirmed = false;
    try {
      const response = await enquirer.prompt({
        type: "confirm" as const,
        name: "confirm",
        message: `Delete ${toDelete.length} run(s)? This cannot be undone.`,
      });
      confirmed = (response as Record<string, boolean>).confirm ?? false;
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      console.log(picocolors.yellow("Clean cancelled."));
      process.exit(0);
    }
  }

  console.log(picocolors.yellow(`\nCleaning ${toDelete.length} run(s)...`));

  for (const run of toDelete) {
    const { removeDir } = await import("../../utils/fs.js");
    const runDir = await runManager.getRunDir(run.runId);
    await removeDir(runDir);
    console.log(`  Deleted: ${run.runId}`);
  }

  console.log(picocolors.green(`\n✓ Cleaned ${toDelete.length} run(s).`));
}
