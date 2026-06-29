import type { Task } from "../schemas/task.schema.js";
import type { OutputPlanItem } from "../schemas/output-plan.schema.js";

export interface ExecutorInput {
  projectRoot: string;
  runId: string;
  task: Task;
  contextPackPath: string;
  contextPackContent: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  allowShellMetachars?: boolean;
  interactiveSessionId?: string;
  interactiveInput?: string;
}

export interface OutputPlanResult {
  target: string;
  action: "create" | "modify" | "delete";
  description?: string;
  produced: boolean;
  evidence?: string;
}

export interface ExecutorResult {
  status:
    | "done"
    | "failed"
    | "skipped"
    | "cancelled"
    | "timeout"
    | "waiting_input"
    | "waiting_approval";
  exitCode?: number;
  output?: string;
  error?: string;
  errorEvidence?: string;
  suggestedFix?: string;
  artifacts?: string[];
  outputPlanResults?: OutputPlanResult[];
  startedAt: string;
  finishedAt: string;
  interactiveSessionId?: string;
  detectedPrompt?: string;
}

export function serializeOutputPlan(outputPlan: OutputPlanItem[] | undefined): string {
  if (!outputPlan || outputPlan.length === 0) return "";
  return JSON.stringify(outputPlan);
}

export interface Executor {
  name: string;
  execute(input: ExecutorInput): Promise<ExecutorResult>;
}
