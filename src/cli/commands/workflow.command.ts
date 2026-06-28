import picocolors from "picocolors";
import { readTextFile, writeTextFile } from "../../utils/fs.js";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { EventStore } from "../../core/event-store.js";
import { WorkflowManager } from "../../core/workflow-manager.js";
import { coloredSymbol, coloredStatus } from "../../ui/formatters/status-format.js";
import { WorkflowReplanner, type ReplanStrategy } from "../../core/workflow-replanner.js";
import type { FlowTaskConfig } from "../../schemas/config.schema.js";
import { ConfigLoader } from "../../config/config-loader.js";

function getManagers() {
  const rootPath = process.cwd();
  const runManager = new RunManager(rootPath);
  const eventStore = new EventStore(rootPath);
  const workflowManager = new WorkflowManager(rootPath, runManager, eventStore);
  return { runManager, eventStore, workflowManager };
}

async function getReplanner() {
  const rootPath = process.cwd();
  const configLoader = new ConfigLoader();
  const config = (await configLoader.load(rootPath)) as FlowTaskConfig;
  const runManager = new RunManager(rootPath);
  const eventStore = new EventStore(rootPath);
  const workflowManager = new WorkflowManager(rootPath, runManager, eventStore);
  const replanner = new WorkflowReplanner(
    rootPath,
    config,
    runManager,
    eventStore,
    workflowManager,
  );
  return { replanner, workflowManager, runManager, eventStore };
}

async function resolveRunId(runId?: string): Promise<string> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();
  if (runId) return runId;
  const state = await manager.loadState(rootPath);
  return state?.activeRunId ?? state?.lastRunId ?? "";
}

function formatDiffCounts(diff: {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}): string {
  const parts: string[] = [];
  if (diff.added > 0) parts.push(picocolors.green(`${diff.added} added`));
  if (diff.removed > 0) parts.push(picocolors.red(`${diff.removed} removed`));
  if (diff.modified > 0) parts.push(picocolors.yellow(`${diff.modified} modified`));
  if (diff.unchanged > 0) parts.push(picocolors.dim(`${diff.unchanged} unchanged`));
  return parts.join(", ");
}

async function enquirerConfirm(message: string): Promise<boolean> {
  const m = await import("enquirer");
  const Enquirer = m.default ?? m;
  const enquirer = new (Enquirer as unknown as new () => {
    prompt: (opts: unknown) => Promise<Record<string, unknown>>;
  })();
  const { confirmed } = await enquirer
    .prompt({
      type: "confirm",
      name: "confirmed",
      message,
    })
    .catch(() => ({ confirmed: false }));
  return !!confirmed;
}

async function enquirerSelect(message: string, choices: string[]): Promise<string> {
  const m = await import("enquirer");
  const Enquirer = m.default ?? m;
  const enquirer = new (Enquirer as unknown as new () => {
    prompt: (opts: unknown) => Promise<Record<string, unknown>>;
  })();
  const { selected } = await enquirer
    .prompt({
      type: "select",
      name: "selected",
      message,
      choices,
    })
    .catch(() => ({ selected: choices[0] }));
  return selected as string;
}

export async function workflowShowCommand(
  runId?: string,
  options?: { out?: string; json?: boolean; skipCompleted?: boolean },
): Promise<void> {
  const targetRun = await resolveRunId(runId);
  if (!targetRun) {
    console.log(picocolors.yellow("No active run found. Specify a run ID."));
    process.exit(0);
  }

  const { workflowManager } = getManagers();
  const {
    workflow,
    yaml: yamlStr,
    json: jsonStr,
  } = await workflowManager.exportWorkflow(targetRun, {
    skipCompleted: options?.skipCompleted,
  });

  if (!workflow.tasks.length) {
    console.log(picocolors.yellow("No tasks in workflow."));
    process.exit(0);
  }

  const output = options?.json ? jsonStr : yamlStr;

  if (options?.out) {
    await writeTextFile(options.out, output);
    console.log(picocolors.green(`Workflow written to ${options.out}`));
  } else {
    console.log(output);
  }
}

export async function workflowDiffCommand(
  runId?: string,
  file?: string,
  options?: { summaryOnly?: boolean },
): Promise<void> {
  const targetRun = await resolveRunId(runId);
  if (!targetRun) {
    console.log(picocolors.yellow("No active run found. Specify a run ID."));
    process.exit(0);
  }

  const { workflowManager, runManager } = getManagers();
  const currentTasks = await runManager.loadTasks(targetRun);

  let workflow;
  if (file) {
    try {
      workflow = await workflowManager.loadWorkflowFromFile(file);
    } catch (e) {
      console.log(picocolors.red(`Error loading workflow file: ${(e as Error).message}`));
      process.exit(1);
    }
  } else {
    const exported = await workflowManager.exportWorkflow(targetRun);
    workflow = exported.workflow;
  }

  const diff = await workflowManager.buildDiff(targetRun, workflow);

  console.log(picocolors.cyan(`\nWorkflow Diff for ${targetRun}\n`));

  const counts = {
    added: diff.added.length,
    removed: diff.removed.length,
    modified: diff.modified.length,
    unchanged: diff.unchanged.length,
  };
  console.log(`  ${formatDiffCounts(counts)}\n`);

  if (options?.summaryOnly) {
    return;
  }

  for (const t of diff.added) {
    console.log(picocolors.green(`  + ${t.id}: ${t.title}`));
  }

  for (const t of diff.removed) {
    console.log(picocolors.red(`  - ${t.id}: ${t.title}${t.reason ? ` (${t.reason})` : ""}`));
  }

  for (const m of diff.modified) {
    console.log(picocolors.yellow(`  ~ ${m.id}:`));
    for (const change of m.changes) {
      console.log(picocolors.yellow(`      ${change}`));
    }
  }

  const currentCount = currentTasks.length;
  const newCount = currentCount + diff.added.length - diff.removed.length;
  console.log(picocolors.dim(`\n  ${currentCount} tasks → ${newCount} tasks`));
}

export async function workflowApplyCommand(
  runId?: string,
  file?: string,
  options?: { dryRun?: boolean; noConfirm?: boolean; force?: boolean; strict?: boolean },
): Promise<void> {
  const targetRun = await resolveRunId(runId);
  if (!targetRun) {
    console.log(picocolors.yellow("No active run found. Specify a run ID."));
    process.exit(0);
  }

  const { workflowManager, runManager } = getManagers();

  const run = await runManager.loadRun(targetRun);
  if (!run) {
    console.log(picocolors.red(`Run not found: ${targetRun}`));
    process.exit(1);
  }

  let workflow;
  if (file) {
    try {
      workflow = await workflowManager.loadWorkflowFromFile(file);
    } catch (e) {
      console.log(picocolors.red(`Error loading workflow file: ${(e as Error).message}`));
      process.exit(1);
    }
  } else {
    console.log(
      picocolors.yellow("No workflow file provided. Use: flowtask workflow apply <runId> <file>"),
    );
    process.exit(0);
  }

  const validation = workflowManager.validateWorkflow(
    workflow,
    await runManager.loadTasks(targetRun),
  );
  if (!validation.valid && options?.strict) {
    console.log(picocolors.red("Workflow validation failed:"));
    for (const err of validation.errors) {
      console.log(picocolors.red(`  ✗ ${err}`));
    }
    process.exit(1);
  }

  const diff = await workflowManager.buildDiff(targetRun, workflow);
  const counts = {
    added: diff.added.length,
    removed: diff.removed.length,
    modified: diff.modified.length,
    unchanged: diff.unchanged.length,
  };

  if (!options?.dryRun) {
    console.log(picocolors.cyan(`\nWorkflow changes for ${run.title}\n`));
    console.log(`  ${formatDiffCounts(counts)}\n`);

    if (validation.warnings.length > 0) {
      for (const w of validation.warnings) {
        console.log(picocolors.yellow(`  ⚠ ${w}`));
      }
      console.log("");
    }

    if (!options?.noConfirm) {
      console.log(picocolors.dim("Existing completed tasks will be preserved."));
      const confirmed = await enquirerConfirm("Apply this workflow?");
      if (!confirmed) {
        console.log(picocolors.yellow("Workflow not applied."));
        process.exit(0);
      }
    }
  }

  const result = await workflowManager.applyWorkflow(targetRun, workflow, {
    dryRun: options?.dryRun,
    noConfirm: true,
    force: options?.force,
  });

  if (options?.dryRun) {
    console.log(picocolors.cyan("\nDry-run: No changes applied.\n"));
    console.log(`  Changes that would be made:`);
    console.log(`  ${formatDiffCounts(counts)}`);
    return;
  }

  if (result.applied) {
    console.log(picocolors.green(`\n✓ Workflow applied successfully`));
    console.log(`  ${formatDiffCounts(counts)}`);
    if (result.snapshotPath) {
      console.log(picocolors.dim(`  Snapshot saved: ${result.snapshotPath}`));
    }
  } else {
    console.log(picocolors.red("\n✗ Workflow application failed:"));
    for (const err of result.errors) {
      console.log(picocolors.red(`  ✗ ${err}`));
    }
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.log(picocolors.yellow(`  ⚠ ${w}`));
    }
  }
}

export async function workflowAddCommand(
  runId?: string,
  options?: {
    title?: string;
    after?: string;
    executor?: string;
    description?: string;
    criteria?: string;
    commands?: string;
    maxRetries?: string;
  },
): Promise<void> {
  const targetRun = await resolveRunId(runId);
  if (!targetRun) {
    console.log(picocolors.yellow("No active run found. Specify a run ID."));
    process.exit(0);
  }

  const { workflowManager } = getManagers();

  const taskDef: Record<string, unknown> = {};
  if (options?.title) taskDef.title = options.title;
  if (options?.executor) taskDef.executor = options.executor;
  if (options?.description) taskDef.description = options.description;
  if (options?.criteria) taskDef.acceptanceCriteria = options.criteria.split("|").filter(Boolean);
  if (options?.maxRetries) taskDef.maxRetries = parseInt(options.maxRetries, 10);

  if (!options?.title) {
    taskDef.title = options?.executor === "shell" ? "Shell task" : "New task";
  }

  const task = await workflowManager.addTask(targetRun, taskDef, { after: options?.after });

  console.log(picocolors.green(`\n✓ Task added: ${task.id} — ${task.title}`));
}

export async function workflowRemoveCommand(
  runId?: string,
  taskId?: string,
  options?: { delete?: boolean; force?: boolean },
): Promise<void> {
  const targetRun = await resolveRunId(runId);
  if (!targetRun) {
    console.log(picocolors.yellow("No active run found. Specify a run ID."));
    process.exit(0);
  }

  if (!taskId) {
    console.log(picocolors.yellow("Specify a task ID to remove."));
    process.exit(0);
  }

  const { workflowManager } = getManagers();

  try {
    await workflowManager.removeTask(targetRun, taskId, {
      delete: options?.delete,
      force: options?.force,
    });
    console.log(picocolors.green(`\n✓ Task ${taskId} ${options?.delete ? "deleted" : "skipped"}`));
  } catch (e) {
    console.log(picocolors.red(`\n✗ ${(e as Error).message}`));
    process.exit(1);
  }
}

export async function workflowReorderCommand(runId?: string, orderedIds?: string[]): Promise<void> {
  const targetRun = await resolveRunId(runId);
  if (!targetRun) {
    console.log(picocolors.yellow("No active run found. Specify a run ID."));
    process.exit(0);
  }

  const { workflowManager, runManager } = getManagers();

  if (orderedIds && orderedIds.length > 0) {
    await workflowManager.reorderTasks(targetRun, orderedIds);
    console.log(picocolors.green(`\n✓ Tasks reordered successfully`));
    return;
  }

  const tasks = await runManager.loadTasks(targetRun);
  if (tasks.length === 0) {
    console.log(picocolors.yellow("No tasks to reorder."));
    process.exit(0);
  }

  console.log(picocolors.cyan(`\nCurrent task order for ${targetRun}:\n`));
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    const statusColor =
      t.status === "done"
        ? picocolors.green
        : t.status === "failed"
          ? picocolors.red
          : t.status === "running"
            ? picocolors.cyan
            : picocolors.dim;
    console.log(`  ${i + 1}. ${statusColor(`[${t.status}]`)} ${t.id} — ${t.title}`);
  }
}

export async function workflowEditCommand(
  runId?: string,
  options?: { dryRun?: boolean; noConfirm?: boolean; interactive?: boolean },
): Promise<void> {
  const targetRun = await resolveRunId(runId);
  if (!targetRun) {
    console.log(picocolors.yellow("No active run found. Specify a run ID."));
    process.exit(0);
  }

  if (options?.interactive) {
    await workflowEditInteractiveCommand(targetRun, options);
    return;
  }

  const { workflowManager } = getManagers();
  const { workflow } = await workflowManager.exportWorkflow(targetRun);

  const os = await import("node:os");
  const path = await import("node:path");
  const tmpFile = path.join(os.tmpdir(), `flowtask-workflow-${targetRun}.yaml`);

  const yamlModule = await import("js-yaml");
  await writeTextFile(
    tmpFile,
    yamlModule.dump(workflow, { indent: 2, lineWidth: 120, noRefs: true }),
  );

  const editor = process.env.FLOWTASK_EDITOR || process.env.VISUAL || process.env.EDITOR || "vim";

  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [tmpFile], { stdio: "inherit", shell: true });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Editor exited with code ${code}`));
    });
    child.on("error", reject);
  });

  const newContent = await readTextFile(tmpFile);
  const parsed = yamlModule.load(newContent);
  const { WorkflowFileSchema } = await import("../../schemas/workflow.schema.js");
  const result = WorkflowFileSchema.safeParse(parsed);

  if (!result.success) {
    console.log(picocolors.red(`Invalid workflow after edit: ${result.error.message}`));
    process.exit(1);
  }

  const newWorkflow = result.data;
  const diff = await workflowManager.buildDiff(targetRun, newWorkflow);
  const counts = {
    added: diff.added.length,
    removed: diff.removed.length,
    modified: diff.modified.length,
    unchanged: diff.unchanged.length,
  };

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
    console.log(picocolors.yellow("No changes detected."));
    return;
  }

  console.log(picocolors.cyan(`\nWorkflow changes:\n`));
  console.log(`  ${formatDiffCounts(counts)}\n`);

  if (options?.dryRun) {
    console.log(picocolors.cyan("Dry-run complete. No changes applied."));
    return;
  }

  if (!options?.noConfirm) {
    const confirmed = await enquirerConfirm("Apply these changes?");
    if (!confirmed) {
      console.log(picocolors.yellow("Changes not applied."));
      return;
    }
  }

  const applyResult = await workflowManager.applyWorkflow(targetRun, newWorkflow, {
    noConfirm: true,
  });

  if (applyResult.applied) {
    console.log(picocolors.green(`\n✓ Workflow updated`));
    console.log(`  ${formatDiffCounts(counts)}`);
  } else {
    console.log(picocolors.red("\n✗ Failed to apply:"));
    for (const err of applyResult.errors) {
      console.log(picocolors.red(`  ✗ ${err}`));
    }
  }
}

async function workflowEditInteractiveCommand(
  runId: string,
  _options?: { dryRun?: boolean; noConfirm?: boolean },
): Promise<void> {
  const { workflowManager, runManager } = getManagers();
  const run = await runManager.loadRun(runId);
  const runTitle = run?.title ?? runId;

  let pendingChanges: Map<string, unknown> | null = null;

  while (true) {
    const tasks = await runManager.loadTasks(runId);

    console.log(picocolors.cyan(`\nCurrent workflow for "${runTitle}" (${tasks.length} tasks):\n`));
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      const statusColor =
        t.status === "done"
          ? picocolors.green
          : t.status === "failed"
            ? picocolors.red
            : t.status === "running"
              ? picocolors.cyan
              : t.status === "pending"
                ? picocolors.dim
                : picocolors.dim;
      console.log(`  ${i + 1}. ${statusColor(`[${t.status}]`)} ${t.id} — ${t.title}`);
    }

    console.log(picocolors.dim(`\nActions:`));
    console.log(`  1. Add task`);
    console.log(`  2. Remove task`);
    console.log(`  3. Edit task`);
    console.log(`  4. Reorder tasks`);
    console.log(`  5. Replan with AI`);
    console.log(`  6. Show task details`);
    console.log(`  q. Done — apply changes`);
    console.log(`  x. Exit without saving`);

    const action = await enquirerSelect("Select action", ["1", "2", "3", "4", "5", "6", "q", "x"]);

    if (action === "x") {
      if (pendingChanges !== null) {
        const confirmed = await enquirerConfirm("Exit without saving changes?");
        if (!confirmed) continue;
      }
      console.log(picocolors.yellow("\nExited without changes."));
      return;
    }

    if (action === "q") {
      if (pendingChanges !== null) {
        console.log(picocolors.green("\n✓ Changes applied."));
      } else {
        console.log(picocolors.yellow("\nNo changes to apply."));
      }
      return;
    }

    if (action === "1") {
      const m = await import("enquirer");
      const Enquirer = m.default ?? m;
      const enquirer = new (Enquirer as unknown as new () => {
        prompt: (opts: unknown) => Promise<Record<string, unknown>>;
      })();
      const answers = await enquirer
        .prompt([
          { type: "input", name: "title", message: "Task title:" },
          { type: "input", name: "description", message: "Description (optional):" },
          {
            type: "input",
            name: "executor",
            message: "Executor (shell/opencode/claude):",
            initial: "shell",
          },
          { type: "input", name: "after", message: "Place after task ID (optional):" },
        ])
        .catch(() => ({ title: "", description: "", executor: "shell", after: "" }));

      const addTitle = answers.title as string;
      if (addTitle) {
        const task = await workflowManager.addTask(
          runId,
          {
            title: addTitle,
            description: (answers.description as string) || undefined,
            executor: (answers.executor as string) || "shell",
          },
          { after: (answers.after as string) || undefined },
        );
        console.log(picocolors.green(`  ✓ Added task: ${task.id} — ${task.title}`));
        pendingChanges = pendingChanges ?? new Map();
        pendingChanges.set(task.id, task);
      }
    } else if (action === "2") {
      if (tasks.length === 0) {
        console.log(picocolors.yellow("No tasks to remove."));
        continue;
      }
      const choices = tasks.map((t) => ({
        name: t.id,
        message: `${t.id} — ${t.title} [${t.status}]`,
      }));
      const m = await import("enquirer");
      const Enquirer = m.default ?? m;
      const enquirer = new (Enquirer as unknown as new () => {
        prompt: (opts: unknown) => Promise<Record<string, unknown>>;
      })();
      const removeResult = await enquirer
        .prompt({
          type: "select",
          name: "taskId",
          message: "Select task to remove:",
          choices,
        })
        .catch(() => ({ taskId: "" }));
      const taskIdToRemove = removeResult.taskId as string;

      if (taskIdToRemove) {
        try {
          await workflowManager.removeTask(runId, taskIdToRemove);
          console.log(picocolors.green(`  ✓ Removed task: ${taskIdToRemove}`));
          pendingChanges = pendingChanges ?? new Map();
        } catch (e) {
          console.log(picocolors.red(`  ✗ ${(e as Error).message}`));
          const forceConfirm = await enquirerConfirm("Remove with --force?");
          if (forceConfirm) {
            await workflowManager.removeTask(runId, taskIdToRemove, { force: true });
            console.log(picocolors.green(`  ✓ Removed task: ${taskIdToRemove} (forced)`));
            pendingChanges = pendingChanges ?? new Map();
          }
        }
      }
    } else if (action === "3") {
      if (tasks.length === 0) {
        console.log(picocolors.yellow("No tasks to edit."));
        continue;
      }
      const choices = tasks.map((t) => ({
        name: t.id,
        message: `${t.id} — ${t.title} [${t.status}]`,
      }));
      const m = await import("enquirer");
      const Enquirer = m.default ?? m;
      const enquirer = new (Enquirer as unknown as new () => {
        prompt: (opts: unknown) => Promise<Record<string, unknown>>;
      })();
      const editResult = await enquirer
        .prompt({
          type: "select",
          name: "taskId",
          message: "Select task to edit:",
          choices,
        })
        .catch(() => ({ taskId: "" }));
      const editTaskId = editResult.taskId as string;

      if (editTaskId) {
        const task = tasks.find((t) => t.id === editTaskId);
        if (!task) continue;
        const answers = await enquirer
          .prompt([
            { type: "input", name: "title", message: "Title:", initial: task.title },
            {
              type: "input",
              name: "description",
              message: "Description:",
              initial: task.description ?? "",
            },
            { type: "input", name: "executor", message: "Executor:", initial: task.executor },
          ])
          .catch(() => ({
            title: task.title,
            description: task.description ?? "",
            executor: task.executor,
          }));

        const updates: Record<string, unknown> = {};
        if (answers.title && answers.title !== task.title) updates.title = answers.title;
        if (answers.description !== (task.description ?? ""))
          updates.description = answers.description || undefined;
        if (answers.executor !== task.executor) updates.executor = answers.executor;

        if (Object.keys(updates).length > 0) {
          await runManager.updateTask(
            runId,
            editTaskId,
            updates as Parameters<typeof runManager.updateTask>[2],
          );
          console.log(picocolors.green(`  ✓ Updated task: ${editTaskId}`));
          pendingChanges = pendingChanges ?? new Map();
        } else {
          console.log(picocolors.yellow("  No changes."));
        }
      }
    } else if (action === "4") {
      if (tasks.length < 2) {
        console.log(picocolors.yellow("Need at least 2 tasks to reorder."));
        continue;
      }
      const choices = tasks.map((t) => ({ name: t.id, message: `${t.id} — ${t.title}` }));
      const m = await import("enquirer");
      const Enquirer = m.default ?? m;
      const enquirer = new (Enquirer as unknown as new () => {
        prompt: (opts: unknown) => Promise<Record<string, unknown>>;
      })();
      const moveResult = await enquirer
        .prompt({
          type: "select",
          name: "taskId",
          message: "Select a task to move:",
          choices,
        })
        .catch(() => ({ taskId: "" }));
      const moveTaskId = moveResult.taskId as string;

      if (moveTaskId) {
        const posChoices = tasks.map((_, i) => ({
          name: String(i + 1),
          message: `Position ${i + 1}`,
        }));
        const posResult = await enquirer
          .prompt({
            type: "select",
            name: "position",
            message: "Move to position:",
            choices: posChoices,
          })
          .catch(() => ({ position: "1" }));
        const movePosition = posResult.position as string;

        if (movePosition) {
          try {
            await workflowManager.reorderTask(runId, moveTaskId, parseInt(movePosition, 10) - 1);
            console.log(
              picocolors.green(`  ✓ Moved task ${moveTaskId} to position ${movePosition}`),
            );
            pendingChanges = pendingChanges ?? new Map();
          } catch (e) {
            console.log(picocolors.red(`  ✗ ${(e as Error).message}`));
          }
        }
      }
    } else if (action === "5") {
      const m = await import("enquirer");
      const Enquirer = m.default ?? m;
      const enquirer = new (Enquirer as unknown as new () => {
        prompt: (opts: unknown) => Promise<Record<string, unknown>>;
      })();
      const { strategy } = await enquirer
        .prompt({
          type: "select",
          name: "strategy",
          message: "Replan strategy:",
          choices: [
            {
              name: "keep-completed",
              message: "Keep completed tasks, replace failed/pending (default)",
            },
            { name: "keep-all", message: "Keep all existing tasks, append new ones" },
            { name: "replace-all", message: "Replace all tasks (except running)" },
          ],
        })
        .catch(() => ({ strategy: "keep-completed" }));

      const { confirmed } = await enquirer
        .prompt({
          type: "confirm",
          name: "confirmed",
          message: `Replan with ${strategy} strategy? This will call the AI planner.`,
        })
        .catch(() => ({ confirmed: false }));

      if (confirmed) {
        console.log(picocolors.cyan("\n  Replanning with AI..."));
        try {
          const { replanner } = await getReplanner();
          const result = await replanner.replan(runId, { strategy: strategy as ReplanStrategy });
          await workflowManager.applyWorkflow(runId, result.workflow, { noConfirm: true });
          console.log(picocolors.green(`\n✓ Replanned: ${formatDiffCounts(result.changes)}`));
          pendingChanges = pendingChanges ?? new Map();
        } catch (e) {
          console.log(picocolors.red(`\n✗ Replan failed: ${(e as Error).message}`));
        }
      }
    } else if (action === "6") {
      if (tasks.length === 0) {
        console.log(picocolors.yellow("No tasks to show."));
        continue;
      }
      const choices = tasks.map((t) => ({ name: t.id, message: `${t.id} — ${t.title}` }));
      const m = await import("enquirer");
      const Enquirer = m.default ?? m;
      const enquirer = new (Enquirer as unknown as new () => {
        prompt: (opts: unknown) => Promise<Record<string, unknown>>;
      })();
      const { taskId } = await enquirer
        .prompt({
          type: "select",
          name: "taskId",
          message: "Select task:",
          choices,
        })
        .catch(() => ({ taskId: "" }));

      if (taskId) {
        const task = tasks.find((t) => t.id === taskId);
        if (task) {
          console.log(picocolors.cyan(`\nTask Details:`));
          console.log(`  ID: ${task.id}`);
          console.log(`  Title: ${task.title}`);
          console.log(`  Description: ${task.description ?? "(none)"}`);
          console.log(`  Status: ${task.status}`);
          console.log(`  Executor: ${task.executor}`);
          console.log(
            `  Dependencies: ${task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "(none)"}`,
          );
          console.log(`  Acceptance Criteria:`);
          for (const ac of task.acceptanceCriteria) {
            console.log(`    - ${ac}`);
          }
          console.log(`  Retries: ${task.retryCount}/${task.maxRetries}`);
        }
      }
    }
  }
}

export async function workflowListCommand(
  runId?: string,
  options?: { status?: string; tree?: boolean },
): Promise<void> {
  const targetRun = await resolveRunId(runId);
  if (!targetRun) {
    console.log(picocolors.yellow("No active run found. Specify a run ID."));
    process.exit(0);
  }

  const { runManager } = getManagers();
  const run = await runManager.loadRun(targetRun);
  const tasks = await runManager.loadTasks(targetRun);

  if (tasks.length === 0) {
    console.log(picocolors.yellow(`No tasks in workflow for run: ${targetRun}`));
    process.exit(0);
  }

  const filtered = options?.status ? tasks.filter((t) => t.status === options.status) : tasks;

  const runTitle = run?.title ?? targetRun;
  const totalCount = tasks.length;
  const completedCount = tasks.filter((t) => t.status === "done").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  console.log(picocolors.cyan(`\n  Workflow: ${picocolors.bold(runTitle)}`));
  console.log(picocolors.dim(`  Run ID: ${targetRun}`));
  console.log(picocolors.dim(`  ${"─".repeat(60)}`));

  const progressBar = buildProgressBar(completedCount, totalCount, failedCount);
  console.log(`  Progress: ${progressBar} ${completedCount}/${totalCount} (${progressPct}%)`);

  if (run?.status) {
    console.log(`  Status:   ${coloredSymbol(run.status)} ${coloredStatus(run.status)}`);
  }

  console.log(picocolors.dim(`\n  Tasks (${filtered.length} shown):`));
  console.log(picocolors.dim(`  ${"─".repeat(60)}`));

  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i]!;
    const icon = coloredSymbol(t.status);
    const statusLabel = coloredStatus(t.status.padEnd(14));
    const idLabel = picocolors.dim(t.id);

    console.log(`  ${icon}  ${idLabel}  ${statusLabel} ${picocolors.cyan(t.title)}`);

    if (t.dependsOn.length > 0) {
      console.log(`      ${picocolors.dim("depends:")} ${picocolors.dim(t.dependsOn.join(", "))}`);
    }

    if (t.retryCount > 0) {
      console.log(
        `      ${picocolors.dim("retries:")} ${picocolors.yellow(`${t.retryCount}/${t.maxRetries}`)}`,
      );
    }

    if (t.executor && t.executor !== "shell") {
      console.log(`      ${picocolors.dim("via:")}     ${picocolors.dim(t.executor)}`);
    }
  }

  console.log(picocolors.dim(`\n  ${"─".repeat(60)}`));
  console.log(picocolors.dim("  Navigation:"));
  console.log(picocolors.dim(`    flowtask workflow show ${targetRun}         — export as YAML`));
  console.log(
    picocolors.dim(`    flowtask tasks --run ${targetRun}           — compact task list`),
  );
  console.log(picocolors.dim(`    flowtask inspect ${targetRun}               — full run details`));
  console.log(picocolors.dim(`    flowtask resume ${targetRun}                — resume this run`));
  console.log("");
}

function buildProgressBar(completed: number, total: number, failed: number): string {
  const barWidth = 20;
  const completeWidth = total > 0 ? Math.round((completed / total) * barWidth) : 0;
  const failedWidth = total > 0 ? Math.round((failed / total) * barWidth) : 0;
  const remainingWidth = barWidth - completeWidth - failedWidth;

  const done = picocolors.green("█".repeat(Math.max(0, completeWidth)));
  const fail = picocolors.red("█".repeat(Math.max(0, failedWidth)));
  const rest = picocolors.dim("░".repeat(Math.max(0, remainingWidth)));

  return `${done}${fail}${rest}`;
}

export async function workflowReplanCommand(
  runId?: string,
  options?: {
    strategy?: string;
    provider?: string;
    model?: string;
    dryRun?: boolean;
    noConfirm?: boolean;
  },
): Promise<void> {
  const targetRun = await resolveRunId(runId);
  if (!targetRun) {
    console.log(picocolors.yellow("No active run found. Specify a run ID."));
    process.exit(0);
  }

  const { replanner, workflowManager, runManager } = await getReplanner();

  const run = await runManager.loadRun(targetRun);
  if (!run) {
    console.log(picocolors.red(`Run not found: ${targetRun}`));
    process.exit(1);
  }

  const strategy = (options?.strategy ?? "keep-completed") as ReplanStrategy;

  if (!["keep-completed", "keep-all", "replace-all"].includes(strategy)) {
    console.log(
      picocolors.red(
        `Invalid strategy: ${strategy}. Use: keep-completed, keep-all, or replace-all`,
      ),
    );
    process.exit(1);
  }

  console.log(picocolors.cyan(`\nReplanning "${run.title}" with strategy: ${strategy}\n`));

  if (options?.provider) console.log(picocolors.dim(`  Provider: ${options.provider}`));
  if (options?.model) console.log(picocolors.dim(`  Model: ${options.model}`));

  try {
    const result = await replanner.replan(targetRun, {
      strategy,
      provider: options?.provider,
      model: options?.model,
    });

    const counts = result.changes;
    console.log(`\n  ${formatDiffCounts(counts)}\n`);

    if (options?.dryRun) {
      console.log(picocolors.cyan("Dry-run complete. No changes applied."));
      return;
    }

    if (!options?.noConfirm) {
      const confirmed = await enquirerConfirm("Apply this replanned workflow?");
      if (!confirmed) {
        console.log(picocolors.yellow("Replan not applied."));
        return;
      }
    }

    const applyResult = await workflowManager.applyWorkflow(targetRun, result.workflow, {
      noConfirm: true,
    });

    if (applyResult.applied) {
      console.log(picocolors.green(`\n✓ Replanned and applied: ${formatDiffCounts(counts)}`));
      if (applyResult.snapshotPath) {
        console.log(picocolors.dim(`  Snapshot saved: ${applyResult.snapshotPath}`));
      }
    } else {
      console.log(picocolors.red("\n✗ Failed to apply replan:"));
      for (const err of applyResult.errors) {
        console.log(picocolors.red(`  ✗ ${err}`));
      }
      process.exit(1);
    }
  } catch (e) {
    console.log(picocolors.red(`\n✗ Replan failed: ${(e as Error).message}`));
    process.exit(1);
  }
}
