import { RunLifecycle } from "../../core/run-lifecycle.js";
import { ProjectManager } from "../../core/project-manager.js";
import { EventStore } from "../../core/event-store.js";
import picocolors from "picocolors";
import type { Run } from "../../schemas/run.schema.js";
import { selectPlanner } from "./run-planner.js";
import { getEventBus } from "../../ui/event-bus.js";
import { formatErrorBlock } from "../../ui/formatters/error-format.js";
import { createOutputOptions, type OutputOptions } from "../../ui/output-mode.js";
import type { EventBus } from "../../ui/event-bus.js";

export async function runCommand(
  prompt: string,
  options: {
    executor?: string;
    mode?: string;
    planner?: string;
    plannerProvider?: string;
    plannerModel?: string;
    plannerBaseUrl?: string;
    plannerTimeout?: string;
    plannerStream?: boolean;
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
  if (options.plannerBaseUrl) {
    config.planner = { ...config.planner!, baseUrl: options.plannerBaseUrl };
    if (config.ai?.providers) {
      const providerName = config.planner!.provider ?? "openai";
      const existingProvider = config.ai.providers[providerName];
      config.ai.providers[providerName] = {
        type: existingProvider?.type ?? "openai",
        ...(existingProvider ?? {}),
        baseUrl: options.plannerBaseUrl,
      };
    }
  }
  if (options.plannerTimeout) {
    const timeoutMs = parseInt(options.plannerTimeout, 10);
    if (!isNaN(timeoutMs)) {
      config.planner = { ...config.planner!, timeoutMs };
    }
  }
  if (options.plannerStream !== undefined) {
    config.planner = { ...config.planner!, stream: options.plannerStream };
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

  // Subscribe renderer
  const unsubscribeRenderer = await subscribeRenderer(eventBus, out.mode);

  try {
    const result = await lifecycle.executeRun(prompt, {
      mode: resolvedMode,
      template: options.template,
      debug: options.debug,
      plannerMode: plannerMode,
    });

    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(
      formatErrorBlock("Run error", errorMessage, [
        { label: "Check logs", command: `flowtask logs --run <runId>` },
        { label: "Retry", command: `flowtask run "${prompt.slice(0, 40)}..."` },
      ]),
    );
    process.exit(1);
  } finally {
    unsubscribeRenderer();
    await lifecycle.flushLogs();
  }
}

async function subscribeRenderer(eventBus: EventBus, mode: string): Promise<() => void> {
  switch (mode) {
    case "json": {
      const { JsonRenderer } = await import("../../ui/renderers/json-renderer.js");
      const renderer = new JsonRenderer();
      return renderer.subscribe(eventBus);
    }
    case "rich": {
      const { RichRenderer } = await import("../../ui/renderers/rich-renderer.js");
      const renderer = new RichRenderer();
      return renderer.subscribe(eventBus);
    }
    default: {
      const { PlainRenderer } = await import("../../ui/renderers/plain-renderer.js");
      const renderer = new PlainRenderer();
      return renderer.subscribe(eventBus);
    }
  }
}

function printRunHeader(
  prompt: string,
  executor?: string,
  plannerMode?: string,
  plannerType?: string,
  config?: { planner?: { provider?: string; model?: string; stream?: boolean } },
  out?: OutputOptions,
): void {
  if (out?.quiet) return;

  console.log(picocolors.cyan(`\nFlowTask Run`));
  console.log(picocolors.dim(`  Prompt: ${prompt.slice(0, 100)}`));

  if (out?.verbose) {
    console.log(picocolors.dim(`  Planner: ${plannerType ?? "simple"}`));
    if (plannerMode === "ai") {
      console.log(picocolors.dim(`  Provider: ${config?.planner?.provider ?? "openai"}`));
      console.log(picocolors.dim(`  Model: ${config?.planner?.model ?? "default"}`));
      if (config?.planner?.stream) {
        console.log(picocolors.dim(`  Streaming: enabled`));
      }
    }
    console.log(picocolors.dim(`  Executor: ${executor ?? "shell"}`));
  }
}
