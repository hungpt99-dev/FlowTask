import type { Task } from "../schemas/task.schema.js";

export interface ExecutorInput {
  projectRoot: string;
  runId: string;
  task: Task;
  contextPackPath: string;
  contextPackContent: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ExecutorResult {
  status: "done" | "failed" | "cancelled" | "timeout";
  exitCode?: number;
  output?: string;
  error?: string;
  artifacts?: string[];
  startedAt: string;
  finishedAt: string;
}

export interface Executor {
  name: string;
  execute(input: ExecutorInput): Promise<ExecutorResult>;
}
