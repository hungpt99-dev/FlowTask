import type { Task } from "../schemas/task.schema.js";

export interface PlannerInput {
  projectRoot: string;
  prompt: string;
  rulesContext: string;
  template?: string;
}

export interface PlannerResult {
  title: string;
  planMarkdown: string;
  tasks: Task[];
}

export interface Planner {
  createPlan(input: PlannerInput): Promise<PlannerResult>;
}
