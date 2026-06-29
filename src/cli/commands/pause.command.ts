import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { WorkflowManager } from "../../core/workflow-manager.js";
import { EventStore } from "../../core/event-store.js";
import { ProcessManager } from "../../core/process-manager.js";

export async function pauseCommand(
  runId: string,
  options: {
    reason?: string;
  },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  let resolvedRunId = runId;
  if (!resolvedRunId) {
    const state = await manager.loadState(rootPath);
    resolvedRunId = state?.activeRunId ?? "";
    if (!resolvedRunId) {
      console.log(picocolors.yellow("No active run to pause."));
      process.exit(0);
    }
  }

  const runManager = new RunManager(rootPath);
  const run = await runManager.loadRun(resolvedRunId);

  if (!run) {
    console.log(picocolors.red(`Run not found: ${resolvedRunId}`));
    process.exit(1);
  }

  if (run.status === "paused") {
    console.log(picocolors.yellow(`Run ${resolvedRunId} is already paused.`));
    process.exit(0);
  }

  if (run.status !== "running" && run.status !== "created") {
    console.log(picocolors.yellow(`Run ${resolvedRunId} is ${run.status} — cannot pause.`));
    process.exit(0);
  }

  const processManager = new ProcessManager();
  await processManager.stop(rootPath, resolvedRunId);

  const eventStore = new EventStore(rootPath);

  await runManager.updateRunStatus(resolvedRunId, "paused");

  await eventStore.appendToRun(resolvedRunId, {
    type: "run_paused",
    runId: resolvedRunId,
    message: options.reason ?? "Paused by user",
  });

  const workflowManager = new WorkflowManager(rootPath, runManager, eventStore);
  await workflowManager.pauseWorkflow(resolvedRunId);

  console.log(picocolors.yellow(`\n  \u23F8 Run paused: ${resolvedRunId}`));
  if (options.reason) {
    console.log(picocolors.dim(`  Reason: ${options.reason}`));
  }
  console.log(picocolors.dim(`  Resume with: flowtask resume ${resolvedRunId}`));
  console.log("");
}
