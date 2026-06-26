import { ProjectManager } from "../../core/project-manager.js";
import { LogManager } from "../../core/log-manager.js";
import picocolors from "picocolors";

export async function logsCommand(options: {
  follow?: boolean;
  run?: string;
  task?: string;
  validation?: boolean;
}): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  let runId = options.run;
  if (!runId) {
    const state = await manager.loadState(rootPath);
    runId = state?.activeRunId ?? state?.lastRunId;
    if (!runId) {
      console.log(picocolors.yellow("No run specified and no recent run found."));
      process.exit(0);
    }
  }

  const logManager = new LogManager(rootPath);

  if (options.task) {
    const logContent = await logManager.readTaskLog(runId, options.task);
    if (!logContent) {
      console.log(picocolors.yellow(`No logs found for task ${options.task} in run ${runId}`));
      process.exit(0);
    }
    console.log(picocolors.cyan(`\nLogs for task ${options.task} in run ${runId}:`));
    console.log(picocolors.dim("─".repeat(60)));
    console.log(logContent);
  } else if (options.validation) {
    const logContent = await logManager.readValidation(runId);
    if (!logContent) {
      console.log(picocolors.yellow(`No validation logs for run ${runId}`));
      process.exit(0);
    }
    console.log(picocolors.cyan(`\nValidation logs for run ${runId}:`));
    console.log(picocolors.dim("─".repeat(60)));
    console.log(logContent);
  } else {
    const logFiles = await logManager.listLogFiles(runId);
    if (logFiles.length === 0) {
      console.log(picocolors.yellow(`No log files found for run ${runId}`));
      process.exit(0);
    }

    console.log(picocolors.cyan(`\nLog files for run ${runId}:`));
    console.log(picocolors.dim("─".repeat(60)));
    for (const file of logFiles) {
      console.log(`  ${picocolors.dim("📄")} ${file}`);
    }
    console.log(picocolors.dim("\nUse --task <taskId> to view specific task logs."));
    console.log(picocolors.dim("Use --validation to view validation logs."));
    console.log(picocolors.dim("Use --follow for real-time log streaming (coming soon)."));

    if (logFiles.includes("runtime.log")) {
      const runtime = await logManager.readRuntime(runId);
      if (runtime) {
        const lines = runtime.trim().split("\n").slice(-10);
        console.log(picocolors.cyan("\nRecent runtime log entries:"));
        console.log(picocolors.dim("─".repeat(60)));
        for (const line of lines) {
          console.log(`  ${line}`);
        }
      }
    }
  }
}
