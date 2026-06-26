import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import picocolors from "picocolors";

export async function statusCommand(): Promise<void> {
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

  console.log(picocolors.cyan("\nFlowTask Status"));
  console.log(picocolors.dim("─".repeat(40)));
  console.log(`  Project: ${picocolors.bold(project.name)}`);
  console.log(`  ID:      ${picocolors.dim(project.projectId)}`);
  console.log(`  Status:  ${formatStatus(state?.status ?? "unknown")}`);

  const runManager = new RunManager(rootPath);
  const targetRunId = state?.activeRunId ?? state?.lastRunId;

  if (targetRunId) {
    const run = await runManager.loadRun(targetRunId);
    if (run) {
      const label = run.runId === state?.activeRunId ? "Active Run" : "Last Run";
      console.log(`\n  ${label}: ${picocolors.cyan(run.title)}`);
      console.log(`  Run ID:     ${picocolors.dim(run.runId)}`);
      console.log(`  Status:     ${formatRunStatus(run.status)}`);
      console.log(`  Mode:       ${picocolors.dim(run.mode)}`);
      console.log(`  Progress:   ${run.completedTaskCount}/${run.taskCount} tasks`);

      const tasks = await runManager.loadTasks(run.runId);
      if (tasks.length > 0) {
        console.log(picocolors.dim("\n  Tasks:"));
        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i]!;
          const icon = statusIcon(t.status);
          console.log(`    ${icon} [${i + 1}/${tasks.length}] ${t.title}`);
        }
      }
    }
  }

  console.log(picocolors.dim("\n  Config:"));
  console.log(`    Default executor: ${config.defaultExecutor}`);
  console.log(`    Log level:        ${config.logLevel}`);
  console.log(`    Auto resume:      ${config.autoResume ? "yes" : "no"}`);
  console.log("");
}

function formatStatus(status: string): string {
  switch (status) {
    case "idle":
      return picocolors.green("idle");
    case "has_running_run":
      return picocolors.cyan("running");
    case "has_failed_run":
      return picocolors.red("failed");
    case "has_interrupted_run":
      return picocolors.yellow("interrupted");
    default:
      return picocolors.dim(status);
  }
}

function formatRunStatus(status: string): string {
  switch (status) {
    case "completed":
      return picocolors.green("completed");
    case "running":
      return picocolors.cyan("running");
    case "failed":
      return picocolors.red("failed");
    case "cancelled":
      return picocolors.yellow("cancelled");
    case "paused":
      return picocolors.yellow("paused");
    case "interrupted":
      return picocolors.yellow("interrupted");
    default:
      return picocolors.dim(status);
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "done":
      return "✓";
    case "running":
      return "◌";
    case "failed":
      return "✗";
    case "pending":
      return "·";
    case "skipped":
      return "−";
    case "cancelled":
      return "−";
    case "blocked":
      return "⊘";
    default:
      return "·";
  }
}
