import { RunLifecycle } from "../../core/run-lifecycle.js";
import { ProjectManager } from "../../core/project-manager.js";
import { EventStore } from "../../core/event-store.js";
import { PlannerRegistry } from "../../planner/planner-registry.js";
import picocolors from "picocolors";
import type { Run } from "../../schemas/run.schema.js";

export async function runCommand(
  prompt: string,
  options: {
    executor?: string;
    mode?: string;
    planner?: string;
    quality?: boolean;
    planOnly?: boolean;
    dryRun?: boolean;
    debug?: boolean;
    template?: string;
  },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.red("FlowTask project not initialized."));
    console.log(picocolors.yellow("Run: flowtask init"));
    process.exit(1);
  }

  const project = (await manager.load(rootPath))!;
  const config = await manager.loadConfig(rootPath);

  const eventStore = new EventStore(rootPath);
  await eventStore.appendGlobal({
    type: "run_created",
    runId: "",
    message: `Prompt: ${prompt.slice(0, 100)}`,
  });

  let resolvedMode: Run["mode"] = (options.mode as Run["mode"]) ?? "auto";
  if (options.planOnly) resolvedMode = "plan-only";
  if (options.dryRun) resolvedMode = "dry-run";
  if (options.debug) resolvedMode = "debug";

  const plannerRegistry = new PlannerRegistry(config);
  const plannerMode = plannerRegistry.resolveMode(options.planner);
  const planResult = plannerRegistry.getPlanner(plannerMode);

  if (plannerMode === "ai" && planResult.mode === "simple") {
    console.log(
      picocolors.yellow(
        "AI planner requested but no AI executor configured. Using simple planner.",
      ),
    );
  } else if (plannerMode === "ai") {
    console.log(
      picocolors.cyan(`Using AI planner (executor: ${config.planner?.executor ?? "unknown"})`),
    );
  } else {
    console.log(picocolors.dim("Using simple planner"));
  }

  const lifecycle = new RunLifecycle(rootPath, project.projectId, config, planResult.planner);

  try {
    const result = await lifecycle.executeRun(prompt, {
      mode: resolvedMode,
      template: options.template,
      debug: options.debug,
      plannerMode: planResult.mode,
    });

    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    console.error(
      picocolors.red(`\n✗ Run error:`),
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}
