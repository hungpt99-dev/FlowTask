export type TaskStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "retrying"
  | "paused"
  | "cancelled";

export interface InkTaskView {
  id: string;
  title: string;
  status: TaskStatus;
  executor?: string;
  attempt?: number;
  maxAttempts?: number;
}

export interface InkOutputLine {
  id: string;
  taskId?: string;
  executor?: string;
  stream?: "stdout" | "stderr";
  text: string;
}

export interface InkRunView {
  runId?: string;
  prompt: string;
  planner?: string;
  executor?: string;
  status: string;
  currentTaskId?: string;
  currentTaskTitle?: string;
  currentTaskExecutor?: string;
  currentAttempt?: number;
  maxAttempts?: number;
  startedAt?: string;
  durationMs?: number;
  reportPath?: string;
  error?: { title: string; message: string };
  tasks: InkTaskView[];
  outputLines: InkOutputLine[];
}
