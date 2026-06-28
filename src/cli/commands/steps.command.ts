import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { StepManager } from "../../core/step-manager.js";
import { coloredSymbol } from "../../ui/formatters/status-format.js";

export async function stepsCommand(
  taskId: string,
  options: { run?: string; status?: string },
): Promise<void> {
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
  }

  if (!runId) {
    console.log(picocolors.red("No run specified and no recent run found."));
    console.log(picocolors.yellow("Use: flowtask steps <taskId> --run <runId>"));
    process.exit(1);
  }

  const runManager = new RunManager(rootPath);
  const tasks = await runManager.loadTasks(runId);
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    console.log(picocolors.red(`Task not found: ${taskId} in run ${runId}`));
    process.exit(1);
  }

  const stepManager = new StepManager(rootPath);
  const allSteps = await stepManager.loadSteps(runId, taskId);

  let steps = allSteps;
  if (options.status) {
    steps = steps.filter((s) => s.status === options.status);
  }

  console.log(picocolors.cyan(`\nSteps for task: ${task.title} (${taskId})`));
  console.log(picocolors.dim(`  ${"─".repeat(60)}`));

  if (steps.length === 0) {
    console.log(picocolors.yellow("  No steps found."));
    if (allSteps.length === 0) {
      console.log(
        picocolors.dim(
          "  Steps are generated during planning. Run a new prompt to generate steps.",
        ),
      );
    } else if (options.status) {
      console.log(picocolors.dim(`  No steps with status "${options.status}".`));
    }
    console.log("");
    process.exit(0);
  }

  const idWidth = Math.max(10, ...steps.map((s) => s.id.length + 2));
  const statusWidth = 18;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const icon = coloredSymbol(
      s.status === "pending_approval"
        ? "waiting_approval"
        : s.status === "approved"
          ? "done"
          : s.status === "denied"
            ? "failed"
            : s.status,
    );
    const id = picocolors.dim(s.id.padEnd(idWidth));
    const status = picocolors.dim(s.status.padEnd(statusWidth));
    const order = picocolors.dim(`${s.order + 1}.`);
    const requiresApproval = s.requiresApproval ? picocolors.yellow(" ⚠") : "";
    const command = s.command ? picocolors.dim(`  ${s.command}`) : "";
    console.log(`  ${order} ${icon} ${id} ${status}${requiresApproval} ${s.title}${command}`);
  }

  const pendingApproval = steps.filter((s) => s.status === "pending_approval");
  if (pendingApproval.length > 0) {
    console.log(picocolors.dim(`\n  ${pendingApproval.length} step(s) pending approval.`));
    console.log(picocolors.dim("  Use: flowtask step approve <stepId>"));
    console.log(picocolors.dim("  Use: flowtask step deny <stepId>"));
  }

  console.log("");
}
