import { type Planner } from "./planner.js";
import { SimplePlanner } from "./simple-planner.js";
import { AiPlanner } from "./ai-planner.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";

export type PlannerMode = "simple" | "ai" | "auto";

export class PlannerRegistry {
  private simplePlanner: SimplePlanner;
  private aiPlanner?: AiPlanner;
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
        if (!this.aiPlanner) {
          this.aiPlanner = new AiPlanner(this.config);
        }
        return { planner: this.aiPlanner, mode: "ai" };
      }

      case "auto": {
        const hasAiExecutor =
          this.config.planner?.executor &&
          this.config.executors?.[this.config.planner.executor] !== undefined;

        if (!hasAiExecutor) {
          return { planner: this.simplePlanner, mode: "simple" };
        }

        if (!this.aiPlanner) {
          this.aiPlanner = new AiPlanner(this.config);
        }
        return { planner: this.aiPlanner, mode: "ai" };
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
