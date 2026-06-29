import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";

export async function duplicateCommand(
  runId: string,
  options: { title?: string; noTasks?: boolean; dryRun?: boolean },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runManager = new RunManager(rootPath);
  const source = await runManager.loadRun(runId);

  if (!source) {
    console.log(picocolors.red(`Run not found: ${runId}`));
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(picocolors.cyan(`\n  Would duplicate run:`));
    console.log(`  ${picocolors.dim("Source:")}    ${source.title} (${runId})`);
    console.log(`  ${picocolors.dim("New title:")} ${options.title ?? `${source.title} (copy)`}`);
    console.log(`  ${picocolors.dim("Include tasks:")} ${options.noTasks ? "no" : "yes"}`);
    console.log("");
    return;
  }

  const newRun = await runManager.duplicateRun(runId, options.title, {
    includeTasks: !options.noTasks,
  });

  console.log(picocolors.green(`\n  Run duplicated successfully`));
  console.log(`  ${picocolors.dim("New Run ID:")} ${newRun.runId}`);
  console.log(`  ${picocolors.dim("Title:")}     ${newRun.title}`);
  console.log(`  ${picocolors.dim("Status:")}    ${newRun.status}`);
  console.log(`  ${picocolors.cyan("  flowtask show")} ${newRun.runId}`);
  console.log("");
}
