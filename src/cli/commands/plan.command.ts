import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RunManager } from "../../core/run-manager.js";
import { selectPlanner } from "./run-planner.js";
import { formatErrorBlock } from "../../ui/formatters/error-format.js";

export async function planCommand(
  prompt: string,
  options: {
    template?: string;
    save?: boolean;
    json?: boolean;
    planner?: string;
    output?: string;
  },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const project = await manager.load(rootPath);
  if (!project) {
    console.log(picocolors.red("Failed to load project."));
    process.exitCode = 1;
    return;
  }

  const config = await manager.loadConfig(rootPath);
  const runManager = new RunManager(rootPath);

  const { plannerMode, plannerRegistry, plannerType } = selectPlanner(config, options.planner);

  if (!options.json) {
    console.log(picocolors.cyan(`\nPlanning: ${prompt.slice(0, 100)}`));
    console.log(picocolors.dim(`  Planner: ${plannerType} (${plannerMode})`));
  }

  const { planner } = plannerRegistry.getPlanner(plannerMode);

  let saveRunId: string | undefined;

  if (options.save) {
    const run = await runManager.createRun(project.projectId, prompt, "plan-only", prompt);
    saveRunId = run.runId;
    console.log(picocolors.dim(`  Run ID: ${run.runId}`));
  }

  try {
    const plan = await planner.createPlan({ projectRoot: rootPath, prompt, rulesContext: "" });

    if (options.json) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    if (!plan || !plan.tasks || plan.tasks.length === 0) {
      console.log(picocolors.yellow("\n  No tasks generated."));
      process.exit(0);
    }

    console.log(picocolors.cyan(`\n  Plan: ${plan.tasks.length} tasks`));
    console.log(picocolors.dim("  " + "─".repeat(50)));

    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i]!;
      const num = `${i + 1}`.padStart(2, " ");
      console.log(`  ${picocolors.cyan(num)}. ${picocolors.bold(task.title)}`);
      if (task.description) {
        const desc =
          task.description.length > 80 ? task.description.slice(0, 77) + "..." : task.description;
        console.log(`     ${picocolors.dim(desc)}`);
      }
      if (task.executor) {
        console.log(`     ${picocolors.dim("Executor:")} ${task.executor}`);
      }
      if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
        for (const ac of task.acceptanceCriteria) {
          console.log(`     ${picocolors.dim("✓")} ${picocolors.dim(ac)}`);
        }
      }
    }

    if (options.output) {
      const { writeTextFile } = await import("../../utils/fs.js");
      await writeTextFile(options.output, JSON.stringify(plan, null, 2));
      console.log(picocolors.dim(`\n  Plan saved to: ${options.output}`));
    }

    console.log("");
    console.log(picocolors.dim("  To execute this plan:"));
    console.log(picocolors.dim(`    flowtask run "${prompt.slice(0, 50)}..."`));
    if (saveRunId) {
      console.log(picocolors.dim(`    flowtask run --run ${saveRunId}`));
    }
    console.log("");

    if (saveRunId) {
      try {
        await runManager.saveTasks(saveRunId, plan.tasks);
      } catch {
        // non-critical
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(
      formatErrorBlock("Planning error", errorMessage, [
        { label: "Try simple planner", command: 'flowtask plan --planner simple "<prompt>"' },
        { label: "Check provider", command: "flowtask doctor" },
      ]),
    );
    process.exitCode = 1;
  }
}
