import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { WorkflowValidator } from "../../validation/workflow-validator.js";
import type { FlowTaskConfig } from "../../schemas/config.schema.js";
import picocolors from "picocolors";

export async function tasksEditCommand(
  taskId: string,
  options: {
    run?: string;
    title?: string;
    description?: string;
    executor?: string;
    "acceptance-criteria"?: string;
    "validation-commands"?: string;
    "required-files"?: string;
  },
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
    console.log(picocolors.yellow("Use: flowtask tasks edit <taskId> --run <runId>"));
    process.exit(1);
  }

  const config: FlowTaskConfig = await manager.loadConfig(rootPath);
  const runManager = new RunManager(rootPath);
  const tasks = await runManager.loadTasks(runId);
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    console.log(picocolors.red(`Task not found: ${taskId} in run ${runId}`));
    process.exit(1);
  }

  const isModifiable =
    task.status === "pending" || task.status === "failed" || task.status === "interrupted";
  if (!isModifiable) {
    console.log(
      picocolors.yellow(
        `Task ${taskId} status is "${task.status}". Only pending, failed, or interrupted tasks can be edited.`,
      ),
    );
    process.exit(0);
  }

  const updates: Record<string, unknown> = {};

  if (options.title) {
    updates.title = options.title;
  }
  if (options.description !== undefined) {
    updates.description = options.description;
  }
  if (options.executor) {
    updates.executor = options.executor;
  }
  if (options["acceptance-criteria"]) {
    updates.acceptanceCriteria = options["acceptance-criteria"]
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (options["validation-commands"] !== undefined || options["required-files"] !== undefined) {
    const existingValidation = task.validation ?? {};
    const newValidation: Record<string, unknown> = { ...existingValidation };
    if (options["validation-commands"] !== undefined) {
      newValidation.commands = options["validation-commands"]
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (options["required-files"] !== undefined) {
      newValidation.requiredFiles = options["required-files"]
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const validator = new WorkflowValidator(config);
    const valid = await validator.validateValidationConfig(newValidation);
    if (!valid.valid) {
      console.log(
        picocolors.red(`Validation error: ${valid.error ?? "Invalid validation config"}`),
      );
      process.exit(1);
    }
    updates.validation = newValidation;
  }

  if (Object.keys(updates).length === 0) {
    console.log(
      picocolors.yellow(
        "No changes specified. Use --title, --description, --executor, --acceptance-criteria, --validation-commands, or --required-files.",
      ),
    );
    process.exit(0);
  }

  const updated = await runManager.updateTask(
    runId,
    taskId,
    updates as Parameters<typeof runManager.updateTask>[2],
  );

  console.log(picocolors.green(`\n✓ Task ${taskId} updated:`));
  console.log(`  Title: ${picocolors.cyan(updated.title)}`);
  if (updated.description) {
    console.log(`  Description: ${picocolors.dim(updated.description)}`);
  }
  console.log(`  Executor: ${picocolors.dim(updated.executor)}`);
  console.log(`  Status: ${picocolors.dim(updated.status)}`);
  if (updated.acceptanceCriteria.length > 0) {
    console.log(`  Acceptance criteria:`);
    for (const ac of updated.acceptanceCriteria) {
      console.log(`    - ${picocolors.dim(ac)}`);
    }
  }
  console.log("");
}
