import type { UiEvent } from "../event-bus.js";
import type { InkRunView, InkOutputLine, TaskStatus } from "./ink-state.js";

export class InkRuntimeStore {
  private state: InkRunView;
  private listeners: Set<() => void> = new Set();
  private lineCounter = 0;
  private taskCounter = 0;
  private maxOutputLines: number;

  constructor(initialState?: Partial<InkRunView>, maxOutputLines = 500) {
    this.maxOutputLines = maxOutputLines;
    this.state = this.defaultState();
    if (initialState) {
      Object.assign(this.state, initialState);
    }
  }

  private defaultState(): InkRunView {
    return {
      prompt: "",
      status: "idle",
      tasks: [],
      outputLines: [],
      durationMs: 0,
    };
  }

  getState(): InkRunView {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }

  dispatch(event: UiEvent): void {
    const prev = this.state;
    let next: InkRunView;

    switch (event.type) {
      case "run_started":
        next = {
          ...prev,
          runId: event.runId,
          prompt: event.title,
          status: "running",
          startedAt: new Date().toISOString(),
          outputLines: [],
        };
        break;

      case "planner_started":
        next = { ...prev, status: "planning" };
        break;

      case "planner_completed":
        next = { ...prev, status: "running" };
        break;

      case "task_started": {
        next = {
          ...prev,
          status: "running",
          currentTaskId: event.taskId,
          currentTaskTitle: event.title,
        };
        next = this.updateOrAddTask(next, event.taskId, event.title, "running");
        break;
      }

      case "task_completed":
        next = this.updateOrAddTask(prev, event.taskId, event.title, "done");
        break;

      case "task_failed":
        next = this.updateOrAddTask(prev, event.taskId, event.title, "failed");
        break;

      case "executor_started":
        next = { ...prev, currentTaskExecutor: event.executor };
        break;

      case "executor_output": {
        this.lineCounter++;
        const line: InkOutputLine = {
          id: `line_${this.lineCounter}`,
          taskId: event.taskId,
          executor: event.executor,
          stream: event.stream,
          text: event.text,
        };
        const lines = [...prev.outputLines, line];
        if (lines.length > this.maxOutputLines) {
          lines.splice(0, lines.length - this.maxOutputLines);
        }
        next = { ...prev, outputLines: lines };
        break;
      }

      case "executor_failed":
        next = { ...prev, error: { title: "Executor failed", message: event.reason } };
        break;

      case "validation_failed":
        next = { ...prev, error: { title: "Validation failed", message: event.reason } };
        break;

      case "run_completed":
        next = { ...prev, status: "completed" };
        break;

      case "run_failed":
        next = { ...prev, status: "failed", error: { title: "Run failed", message: event.reason } };
        break;

      case "info":
        next = prev;
        break;

      default:
        next = prev;
    }

    this.state = next;
    this.notify();
  }

  private updateOrAddTask(
    state: InkRunView,
    id: string,
    title: string,
    status: string,
  ): InkRunView {
    const safeStatus = (
      ["pending", "running", "done", "failed", "retrying", "paused", "cancelled"].includes(status)
        ? status
        : "pending"
    ) as TaskStatus;
    const existing = state.tasks.findIndex((t) => t.id === id);
    let tasks;
    if (existing >= 0) {
      tasks = state.tasks.map((t, i) => (i === existing ? { ...t, status: safeStatus } : t));
    } else {
      this.taskCounter++;
      tasks = [...state.tasks, { id, title, status: safeStatus }];
    }
    return { ...state, tasks };
  }

  close(): void {
    this.listeners.clear();
  }
}
