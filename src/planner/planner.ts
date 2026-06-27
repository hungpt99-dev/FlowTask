import type { Task } from "../schemas/task.schema.js";
import type { UseCaseDetection } from "../usecase/usecase-types.js";

export interface PlannerInput {
  projectRoot: string;
  prompt: string;
  rulesContext: string;
  template?: string;
  projectFiles?: string[];
  availableExecutors?: string[];
  runId?: string;
  useCase?: UseCaseDetection;
}

export interface PlannerResult {
  title: string;
  planMarkdown: string;
  tasks: Task[];
}

export interface Planner {
  createPlan(input: PlannerInput): Promise<PlannerResult>;
}
