import { type Planner } from "./planner.js";
import { SimplePlanner } from "./simple-planner.js";
import { InternalAiPlanner } from "./internal-ai-planner.js";
import { AiPlanner } from "./ai-planner.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { ProviderRegistry } from "../ai/provider-registry.js";

export type PlannerMode = "simple" | "ai" | "auto";

export class PlannerRegistry {
  private simplePlanner: SimplePlanner;
  private internalAiPlanner?: InternalAiPlanner;
  private externalAiPlanner?: AiPlanner;
  private config: FlowTaskConfig;

  constructor(config: FlowTaskConfig) {
    this.config = config;
    this.simplePlanner = new SimplePlanner();
  }

  getPlanner(mode: PlannerMode): { planner: Planner; mode: PlannerMode } {
    switch (mode) {
      case "simple":
        return { planner: this.simplePlanner, mode: "simple" };

      case "ai": {
        const plannerType = this.config.planner?.type ?? "internal-ai";
        if (plannerType === "internal-ai") {
          if (!this.internalAiPlanner) {
            this.internalAiPlanner = new InternalAiPlanner(this.config);
          }
          return { planner: this.internalAiPlanner, mode: "ai" };
        }
        if (!this.externalAiPlanner) {
          this.externalAiPlanner = new AiPlanner(this.config);
        }
        return { planner: this.externalAiPlanner, mode: "ai" };
      }

      case "auto": {
        const plannerType = this.config.planner?.type ?? "internal-ai";

        if (plannerType === "internal-ai") {
          const providers = new ProviderRegistry(this.config);
          const hasProvider =
            this.config.planner?.provider &&
            this.config.ai?.providers?.[this.config.planner.provider] !== undefined;

          if (!hasProvider) {
            return { planner: this.simplePlanner, mode: "simple" };
          }

          const apiKeyEnv = providers.getApiKeyEnv();
          const hasKey = apiKeyEnv ? !!process.env[apiKeyEnv] : false;

          if (!hasKey) {
            return { planner: this.simplePlanner, mode: "simple" };
          }

          if (!this.internalAiPlanner) {
            this.internalAiPlanner = new InternalAiPlanner(this.config);
          }
          return { planner: this.internalAiPlanner, mode: "ai" };
        }

        if (plannerType === "external-ai") {
          const hasAiExecutor =
            this.config.planner?.executor &&
            this.config.executors?.[this.config.planner.executor] !== undefined;

          if (!hasAiExecutor) {
            return { planner: this.simplePlanner, mode: "simple" };
          }

          if (!this.externalAiPlanner) {
            this.externalAiPlanner = new AiPlanner(this.config);
          }
          return { planner: this.externalAiPlanner, mode: "ai" };
        }

        return { planner: this.simplePlanner, mode: "simple" };
      }

      default:
        return { planner: this.simplePlanner, mode: "simple" };
    }
  }

  resolveMode(requested?: string): PlannerMode {
    if (requested === "simple") return "simple";
    if (requested === "ai") return "ai";
    if (requested === "auto") return "auto";
    return (this.config.planner?.default as PlannerMode) ?? "auto";
  }

  shouldFallback(mode: PlannerMode): boolean {
    if (mode === "ai") return false;
    return this.config.planner?.fallbackToSimple ?? true;
  }
}
