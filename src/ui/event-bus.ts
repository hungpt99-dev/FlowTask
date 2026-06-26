type EventCallback = (event: UiEvent) => void;

export type UiEvent =
  | { type: "run_started"; runId: string; title: string }
  | { type: "rules_loaded"; count: number }
  | { type: "planner_started" }
  | { type: "planner_completed"; taskCount: number }
  | { type: "task_started"; taskId: string; title: string; index: number; total: number }
  | {
      type: "executor_started";
      runId: string;
      taskId: string;
      executor: string;
      command: string;
      args: string[];
    }
  | {
      type: "executor_output";
      runId: string;
      taskId: string;
      executor: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "executor_exited";
      runId: string;
      taskId: string;
      executor: string;
      exitCode: number | null;
    }
  | {
      type: "executor_failed";
      runId: string;
      taskId: string;
      executor: string;
      reason: string;
    }
  | { type: "validation_started"; taskId: string }
  | { type: "validation_passed"; taskId: string }
  | { type: "validation_failed"; taskId: string; reason: string }
  | { type: "task_completed"; taskId: string; title: string }
  | { type: "task_failed"; taskId: string; title: string; reason: string }
  | { type: "run_completed"; success: boolean; reason?: string; details?: string }
  | { type: "run_failed"; reason: string; details?: string }
  | { type: "planner_fallback"; reason: string }
  | { type: "info"; message: string }
  | {
      type: "ai_provider_stream_started";
      provider: string;
      model: string;
      runId?: string;
      taskId?: string;
      timestamp: string;
    }
  | {
      type: "ai_provider_stream_delta";
      provider: string;
      model: string;
      runId?: string;
      taskId?: string;
      textDelta: string;
      timestamp: string;
    }
  | {
      type: "ai_provider_stream_completed";
      provider: string;
      model: string;
      runId?: string;
      taskId?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      timestamp: string;
    }
  | {
      type: "ai_provider_stream_failed";
      provider: string;
      model: string;
      runId?: string;
      taskId?: string;
      reason: string;
      timestamp: string;
    };

export interface EventBusOptions {
  maxHistory?: number;
  maxAsyncQueueSize?: number;
  maxListenerErrors?: number;
  debug?: boolean;
}

export interface SubscriberOptions {
  delivery?: "sync" | "async";
  name?: string;
}

interface ListenerEntry {
  callback: EventCallback;
  delivery: "sync" | "async";
  name: string;
  errorCount: number;
}

export class EventBus {
  private listeners: Map<string, Set<ListenerEntry>> = new Map();
  private history: UiEvent[] = [];
  private options: Required<EventBusOptions>;
  private disabledListeners: Set<EventCallback> = new Set();

  constructor(options: EventBusOptions = {}) {
    this.options = {
      maxHistory: options.maxHistory ?? 1000,
      maxAsyncQueueSize: options.maxAsyncQueueSize ?? 10000,
      maxListenerErrors: options.maxListenerErrors ?? 10,
      debug: options.debug ?? false,
    };
  }

  on(type: string, callback: EventCallback): void {
    this.addListener(type, callback, { delivery: "async", name: "anonymous" });
  }

  private addListener(type: string, callback: EventCallback, opts: SubscriberOptions): void {
    const existing = this.listeners.get(type) ?? new Set();
    existing.add({
      callback,
      delivery: opts.delivery ?? "async",
      name: opts.name ?? "anonymous",
      errorCount: 0,
    });
    this.listeners.set(type, existing);
  }

  off(type: string, callback: EventCallback): void {
    const existing = this.listeners.get(type);
    if (existing) {
      for (const entry of existing) {
        if (entry.callback === callback) {
          existing.delete(entry);
          break;
        }
      }
      if (existing.size === 0) {
        this.listeners.delete(type);
      }
    }
  }

  subscribe(callback: EventCallback): () => void {
    return this.subscribeWithOptions(callback, { delivery: "async" });
  }

  subscribeSync(callback: EventCallback): () => void {
    return this.subscribeWithOptions(callback, { delivery: "sync" });
  }

  private subscribeWithOptions(callback: EventCallback, opts: SubscriberOptions): () => void {
    const types = [
      "executor_started",
      "executor_output",
      "executor_exited",
      "executor_failed",
      "task_started",
      "task_completed",
      "task_failed",
      "validation_started",
      "validation_passed",
      "validation_failed",
      "run_completed",
      "run_failed",
      "info",
    ];
    for (const t of types) {
      this.addListener(t, callback, opts);
    }
    return () => {
      for (const t of types) {
        this.off(t, callback);
      }
    };
  }

  emit(event: UiEvent): void {
    if (this.history.length >= this.options.maxHistory) {
      this.history.shift();
    }
    this.history.push(event);

    const entries = this.listeners.get(event.type);
    if (!entries || entries.size === 0) return;

    const snapshot = [...entries];

    for (const entry of snapshot) {
      if (entry.delivery !== "sync") continue;
      if (this.disabledListeners.has(entry.callback)) continue;
      try {
        entry.callback(event);
      } catch {
        entry.errorCount++;
        if (entry.errorCount >= this.options.maxListenerErrors) {
          this.disabledListeners.add(entry.callback);
          if (this.options.debug) {
            console.error(
              `[flowtask] Disabling listener "${entry.name}" after ${entry.errorCount} errors`,
            );
          }
        }
      }
    }

    for (const entry of snapshot) {
      if (entry.delivery !== "async") continue;
      if (this.disabledListeners.has(entry.callback)) continue;
      queueMicrotask(() => {
        try {
          entry.callback(event);
        } catch {
          entry.errorCount++;
          if (entry.errorCount >= this.options.maxListenerErrors) {
            this.disabledListeners.add(entry.callback);
          }
        }
      });
    }
  }

  getHistory(): UiEvent[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
    this.disabledListeners.clear();
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
