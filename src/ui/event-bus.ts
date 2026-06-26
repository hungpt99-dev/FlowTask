type EventCallback = (event: UiEvent) => void;

export type UiEvent =
  | { type: "run_started"; runId: string; title: string }
  | { type: "rules_loaded"; count: number }
  | { type: "planner_started" }
  | { type: "planner_completed"; taskCount: number }
  | { type: "task_started"; taskId: string; title: string; index: number; total: number }
  | { type: "executor_output"; taskId: string; stream: "stdout" | "stderr"; text: string }
  | { type: "validation_started"; taskId: string }
  | { type: "validation_passed"; taskId: string }
  | { type: "validation_failed"; taskId: string; reason: string }
  | { type: "task_completed"; taskId: string; title: string }
  | { type: "task_failed"; taskId: string; title: string; reason: string }
  | { type: "run_completed"; success: boolean; reason?: string; details?: string }
  | { type: "run_failed"; reason: string; details?: string }
  | { type: "planner_fallback"; reason: string }
  | { type: "info"; message: string };

export class EventBus {
  private listeners: Map<string, EventCallback[]> = new Map();
  private history: UiEvent[] = [];

  on(type: string, callback: EventCallback): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(callback);
    this.listeners.set(type, existing);
  }

  off(type: string, callback: EventCallback): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      existing.filter((c) => c !== callback),
    );
  }

  emit(event: UiEvent): void {
    this.history.push(event);
    const callbacks = this.listeners.get(event.type) ?? [];
    for (const cb of callbacks) {
      try {
        cb(event);
      } catch {
        // ignore callback errors
      }
    }
  }

  getHistory(): UiEvent[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
  }
}

let globalBus: EventBus | undefined;

export function getEventBus(): EventBus {
  if (!globalBus) {
    globalBus = new EventBus();
  }
  return globalBus;
}

export function setEventBus(bus: EventBus): void {
  globalBus = bus;
}
