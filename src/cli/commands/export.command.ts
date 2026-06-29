import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";

export async function exportCommand(
  runId: string,
  options: { format?: string; out?: string; json?: boolean },
): Promise<void> {
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

  const format =
    options.format === "yaml" || options.json
      ? "json"
      : ((options.format as "json" | "yaml" | undefined) ?? "json");

  if (options.out) {
    const result = await runManager.exportRunToFile(runId, options.out, format as "json" | "yaml");
    console.log(picocolors.green(`\n  Run exported to ${picocolors.cyan(result)}`));
    console.log("");
  } else {
    const { content } = await runManager.exportRun(runId, format);
    console.log(content);
  }
}
