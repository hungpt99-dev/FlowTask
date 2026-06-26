import { RunLifecycle } from "../../core/run-lifecycle.js";
import { ProjectManager } from "../../core/project-manager.js";
import { EventStore } from "../../core/event-store.js";
import picocolors from "picocolors";
import type { Run } from "../../schemas/run.schema.js";
import { selectPlanner } from "./run-planner.js";
import { JsonRenderer } from "../../ui/renderers/json-renderer.js";
import { getEventBus, type UiEvent } from "../../ui/event-bus.js";
import { formatErrorBlock } from "../../ui/formatters/error-format.js";
import { createOutputOptions, type OutputOptions } from "../../ui/output-mode.js";

export async function runCommand(
  prompt: string,
  options: {
    executor?: string;
    mode?: string;
    planner?: string;
    plannerProvider?: string;
    plannerModel?: string;
    ui?: boolean;
    noUi?: boolean;
    json?: boolean;
    quiet?: boolean;
    verbose?: boolean;
    quality?: boolean;
    planOnly?: boolean;
    dryRun?: boolean;
    debug?: boolean;
    template?: string;
  },
): Promise<void> {
  const out = createOutputOptions(options);
  const eventBus = getEventBus();
  const jsonRenderer = new JsonRenderer();

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

  if (options.plannerProvider) {
    config.planner = { ...config.planner!, provider: options.plannerProvider };
  }
  if (options.plannerModel) {
    config.planner = { ...config.planner!, model: options.plannerModel };
  }

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

  const { plannerMode, plannerRegistry, plannerType } = selectPlanner(config, options.planner);
  const { planner } = plannerRegistry.getPlanner(plannerMode);

  if (out.mode !== "json") {
    printRunHeader(prompt, options.executor, plannerMode, plannerType, config, out);
  }

  const lifecycle = new RunLifecycle(rootPath, project.projectId, config, planner);

  if (out.mode === "plain") {
    eventBus.on("planner_fallback", (e) => {
      if ("reason" in e) {
        console.log(picocolors.yellow(`  ${(e as { reason: string }).reason}`));
      }
    });
  }

  try {
    const result = await lifecycle.executeRun(prompt, {
      mode: resolvedMode,
      template: options.template,
      debug: options.debug,
      plannerMode: plannerMode,
    });

    if (out.mode === "json") {
      jsonRenderer.write({
        type: "run_completed",
        success: result.success,
        reason: result.success ? undefined : "Run completed with failures",
      } as UiEvent);
    }

    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (out.mode === "json") {
      jsonRenderer.write({
        type: "run_failed",
        reason: errorMessage,
      } as UiEvent);
    } else {
      console.log(
        formatErrorBlock("Run error", errorMessage, [
          { label: "Check logs", command: `flowtask logs --run <runId>` },
          { label: "Retry", command: `flowtask run "${prompt.slice(0, 40)}..."` },
        ]),
      );
    }

    process.exit(1);
  }
}

function printRunHeader(
  prompt: string,
  executor?: string,
  plannerMode?: string,
  plannerType?: string,
  config?: { planner?: { provider?: string; model?: string } },
  out?: OutputOptions,
): void {
  if (out?.quiet) {
    return;
  }

  console.log(picocolors.cyan(`\nFlowTask Run`));
  console.log(picocolors.dim(`  Prompt: ${prompt.slice(0, 100)}`));

  if (out?.verbose) {
    console.log(picocolors.dim(`  Planner: ${plannerType ?? "simple"}`));
    if (plannerMode === "ai") {
      console.log(picocolors.dim(`  Provider: ${config?.planner?.provider ?? "openai"}`));
      console.log(picocolors.dim(`  Model: ${config?.planner?.model ?? "default"}`));
    }
    console.log(picocolors.dim(`  Executor: ${executor ?? "shell"}`));
  }
}
