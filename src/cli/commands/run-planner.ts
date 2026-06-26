import type { FlowTaskConfig } from "../../schemas/config.schema.js";
import { PlannerRegistry } from "../../planner/planner-registry.js";
import type { PlannerMode } from "../../planner/planner-registry.js";
import picocolors from "picocolors";

export interface PlannerSelection {
  plannerMode: PlannerMode;
  plannerRegistry: PlannerRegistry;
  plannerType: string;
}

export function selectPlanner(config: FlowTaskConfig, requested?: string): PlannerSelection {
  const plannerRegistry = new PlannerRegistry(config);
  const plannerMode = plannerRegistry.resolveMode(requested);
  const planResult = plannerRegistry.getPlanner(plannerMode);
  const plannerType = config.planner?.type ?? "internal-ai";

  if (plannerMode === "ai" && planResult.mode === "simple") {
    console.log(
      picocolors.yellow(
        "AI planner requested but no AI provider or API key configured. Using simple planner.",
      ),
    );
    if (plannerType === "internal-ai") {
      console.log(picocolors.dim("  Set OPENAI_API_KEY or run with --planner simple"));
    }
  } else if (planResult.mode === "ai") {
    if (plannerType === "internal-ai") {
      const providerName = config.planner?.provider ?? "openai";
      const model = config.planner?.model ?? "gpt-4.1-mini";
      console.log(
        picocolors.cyan(`Using internal AI planner (provider: ${providerName}, model: ${model})`),
      );
    } else {
      console.log(
        picocolors.cyan(
          `Using external AI planner (executor: ${config.planner?.executor ?? "unknown"})`,
        ),
      );
    }
  } else {
    console.log(picocolors.dim("Using simple planner"));
  }

  return {
    plannerMode,
    plannerRegistry,
    plannerType,
  };
}
