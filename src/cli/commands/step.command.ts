import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { StepManager } from "../../core/step-manager.js";

async function resolveRunId(manager: ProjectManager, options: { run?: string }): Promise<string> {
  const rootPath = process.cwd();
  let runId = options.run;
  if (!runId) {
    const state = await manager.loadState(rootPath);
    runId = state?.activeRunId ?? state?.lastRunId;
  }
  if (!runId) {
    console.log(picocolors.red("No run specified and no recent run found."));
    console.log(picocolors.yellow("Use: flowtask step <action> <stepId> --run <runId>"));
    process.exit(1);
  }
  return runId;
}

async function resolveTaskId(
  runManager: RunManager,
  runId: string,
  stepId: string,
): Promise<string> {
  const stepManager = new StepManager(process.cwd());
  const allSteps = await stepManager.loadAllSteps(runId);
  for (const [taskId, steps] of Object.entries(allSteps)) {
    if (steps.some((s) => s.id === stepId)) return taskId;
  }
  console.log(picocolors.red(`Step not found: ${stepId} in run ${runId}`));
  process.exit(1);
}

export async function stepEditCommand(
  stepId: string,
  options: {
    run?: string;
    title?: string;
    description?: string;
    command?: string;
    type?: string;
  },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runId = await resolveRunId(manager, options);
  const runManager = new RunManager(rootPath);
  const taskId = await resolveTaskId(runManager, runId, stepId);

  const stepManager = new StepManager(rootPath);
  const existing = await stepManager.getStep(runId, taskId, stepId);
  if (!existing) {
    console.log(picocolors.red(`Step not found: ${stepId} in task ${taskId}`));
    process.exit(1);
  }

  if (existing.status === "done" || existing.status === "running") {
    console.log(picocolors.yellow(`Step ${stepId} status is "${existing.status}". Cannot edit.`));
    process.exit(0);
  }

  const updates: Record<string, unknown> = {};
  if (options.title) updates.title = options.title;
  if (options.description !== undefined) updates.description = options.description;
  if (options.command !== undefined) updates.command = options.command;
  if (options.type) updates.type = options.type;

  if (Object.keys(updates).length === 0) {
    console.log(
      picocolors.yellow("No changes specified. Use --title, --description, --command, or --type."),
    );
    process.exit(0);
  }

  const updated = await stepManager.updateStep(
    runId,
    taskId,
    stepId,
    updates as Parameters<typeof stepManager.updateStep>[3],
  );

  console.log(picocolors.green(`\n✓ Step ${stepId} updated:`));
  console.log(`  Title: ${picocolors.cyan(updated.title)}`);
  if (updated.description) {
    console.log(`  Description: ${picocolors.dim(updated.description)}`);
  }
  if (updated.command) {
    console.log(`  Command: ${picocolors.dim(updated.command)}`);
  }
  console.log(`  Type: ${picocolors.dim(updated.type)}`);
  console.log(`  Status: ${picocolors.dim(updated.status)}`);
  console.log("");
}

export async function stepApproveCommand(stepId: string, options: { run?: string }): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runId = await resolveRunId(manager, options);
  const runManager = new RunManager(rootPath);
  const taskId = await resolveTaskId(runManager, runId, stepId);

  const stepManager = new StepManager(rootPath);
  const existing = await stepManager.getStep(runId, taskId, stepId);
  if (!existing) {
    console.log(picocolors.red(`Step not found: ${stepId} in task ${taskId}`));
    process.exit(1);
  }

  if (existing.status !== "pending_approval") {
    console.log(
      picocolors.yellow(
        `Step ${stepId} status is "${existing.status}", not "pending_approval". Nothing to approve.`,
      ),
    );
    process.exit(0);
  }

  await stepManager.approveStep(runId, taskId, stepId);
  console.log(picocolors.green(`\n✓ Step ${stepId} approved.`));
  console.log(picocolors.dim(`  Title: ${existing.title}`));
  console.log("");
}

export async function stepApproveAllCommand(options: { run?: string }): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runId = await resolveRunId(manager, options);

  const stepManager = new StepManager(rootPath);
  const approved = await stepManager.approveAllPendingForRun(runId);

  if (approved.length === 0) {
    console.log(picocolors.yellow("No steps pending approval found."));
    process.exit(0);
  }

  console.log(picocolors.green(`\n✓ Approved ${approved.length} step(s):`));
  for (const step of approved) {
    console.log(`  · ${picocolors.cyan(step.title)} (${step.id})`);
  }
  console.log("");
}

export async function stepDenyCommand(stepId: string, options: { run?: string }): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runId = await resolveRunId(manager, options);
  const runManager = new RunManager(rootPath);
  const taskId = await resolveTaskId(runManager, runId, stepId);

  const stepManager = new StepManager(rootPath);
  const existing = await stepManager.getStep(runId, taskId, stepId);
  if (!existing) {
    console.log(picocolors.red(`Step not found: ${stepId} in task ${taskId}`));
    process.exit(1);
  }

  if (existing.status !== "pending_approval") {
    console.log(
      picocolors.yellow(
        `Step ${stepId} status is "${existing.status}", not "pending_approval". Nothing to deny.`,
      ),
    );
    process.exit(0);
  }

  await stepManager.denyStep(runId, taskId, stepId);
  console.log(picocolors.yellow(`\n✗ Step ${stepId} denied.`));
  console.log(picocolors.dim(`  Title: ${existing.title}`));
  console.log("");
}
