import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";
import { coloredSymbol, projectStatusLabel } from "../../ui/formatters/status-format.js";
import { formatTimeAgo } from "../../ui/formatters/duration-format.js";

export async function statusCommand(runIdArg?: string): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const project = (await manager.load(rootPath))!;
  const state = await manager.loadState(rootPath);
  const config = await manager.loadConfig(rootPath);

  console.log("");
  console.log(picocolors.bold("  FlowTask Project"));
  console.log(picocolors.dim("  " + "─".repeat(50)));
  console.log(`  ${picocolors.dim("Project:")}  ${picocolors.bold(project.name)}`);
  console.log(`  ${picocolors.dim("Status:")}   ${projectStatusLabel(state?.status ?? "unknown")}`);

  const runManager = new RunManager(rootPath);
  const targetRunId = runIdArg ?? state?.activeRunId ?? state?.lastRunId;

  if (targetRunId) {
    const run = await runManager.loadRun(targetRunId);
    if (run) {
      const label =
        !runIdArg && run.runId === state?.activeRunId
          ? "Active Run"
          : !runIdArg && run.runId === state?.lastRunId && !state?.activeRunId
            ? "Last Run"
            : "Run";
      console.log(picocolors.dim(`  ${"─".repeat(50)}`));
      console.log(`  ${picocolors.bold(label)}`);
      console.log(`  ${picocolors.dim("Title:")}    ${picocolors.cyan(run.title)}`);
      console.log(`  ${picocolors.dim("Run ID:")}   ${picocolors.dim(run.runId)}`);
      console.log(`  ${picocolors.dim("Status:")}   ${coloredSymbol(run.status)} ${run.status}`);
      console.log(
        `  ${picocolors.dim("Created:")}  ${new Date(run.createdAt).toLocaleString()} (${formatTimeAgo(run.createdAt)})`,
      );
      console.log(
        `  ${picocolors.dim("Updated:")}  ${new Date(run.updatedAt).toLocaleString()} (${formatTimeAgo(run.updatedAt)})`,
      );
      console.log(
        `  ${picocolors.dim("Progress:")} ${run.completedTaskCount}/${run.taskCount} tasks completed`,
      );

      const tasks = await runManager.loadTasks(run.runId);
      if (tasks.length > 0) {
        console.log(picocolors.dim(`  ${"─".repeat(50)}`));
        console.log(`  Tasks:`);
        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i]!;
          const icon = coloredSymbol(t.status);
          const isCurrent = t.status === "running" ? picocolors.cyan(" ◀ current") : "";
          console.log(`    ${icon} ${t.title}${isCurrent}`);
        }
      }
    } else if (runIdArg) {
      console.log(picocolors.yellow(`  Run not found: ${runIdArg}`));
    }
  }

  console.log(picocolors.dim(`  ${"─".repeat(50)}`));
  console.log(`  ${picocolors.dim("Config:")}`);
  console.log(`    ${picocolors.dim("Default executor:")} ${config.defaultExecutor}`);
  console.log(`    ${picocolors.dim("Planner mode:")}      ${config.planner?.default ?? "auto"}`);
  console.log(
    `    ${picocolors.dim("Planner type:")}      ${config.planner?.type ?? "internal-ai"}`,
  );
  console.log("");

  if (state?.activeRunId) {
    console.log(`  ${picocolors.cyan("Next commands:")}`);
    console.log(`    ${picocolors.dim("flowtask logs --follow")}`);
    console.log(`    ${picocolors.dim("flowtask stop")}`);
    console.log(`    ${picocolors.dim(`flowtask inspect ${state.activeRunId}`)}`);
    console.log("");
  }
}
