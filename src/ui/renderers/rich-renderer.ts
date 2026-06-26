import picocolors from "picocolors";
import type { UiEvent } from "../event-bus.js";
import type { EventBus } from "../event-bus.js";
import { OutputBuffer } from "../output-buffer.js";

export class RichRenderer {
  private maxLines: number;
  private maxVisible: number;
  private lines: string[] = [];
  private outputBuffer: OutputBuffer;

  constructor(maxLines = 500, maxVisible = 30, debounceMs = 50) {
    this.maxLines = maxLines;
    this.maxVisible = maxVisible;
    this.outputBuffer = new OutputBuffer({
      maxLines,
      flushIntervalMs: debounceMs,
      onFlush: (events) => this.renderBatch(events),
    });
  }

  subscribe(eventBus: EventBus): () => void {
    const unsubscribe = eventBus.subscribe((event: UiEvent) => {
      this.outputBuffer.push(event);
    });
    return () => {
      this.outputBuffer.close();
      unsubscribe();
    };
  }

  private renderBatch(events: UiEvent[]): void {
    for (const event of events) {
      const line = this.formatEvent(event);
      if (line) {
        this.lines.push(line);
        if (this.lines.length > this.maxLines) {
          this.lines = this.lines.slice(-this.maxLines);
        }
      }
    }

    const display = this.lines.slice(-this.maxVisible);
    for (const line of display) {
      process.stdout.write(line + "\n");
    }
  }

  private formatEvent(event: UiEvent): string | null {
    switch (event.type) {
      case "executor_output":
        return `  ${picocolors.dim(`[${event.executor}][${event.stream}]`)} ${event.text}`;
      case "executor_started":
        return `  ${picocolors.dim(`[${event.executor}] started`)}`;
      case "executor_exited": {
        const status = event.exitCode === 0 ? picocolors.green("exited") : picocolors.red("exited");
        return `  ${picocolors.dim(`[${event.executor}]`)} ${status} (code ${event.exitCode})`;
      }
      case "executor_failed":
        return `  ${picocolors.red(`[${event.executor}] failed: ${event.reason}`)}`;
      case "task_completed":
        return `  ${picocolors.green("✓")} ${picocolors.dim(event.title)}`;
      case "task_failed":
        return `  ${picocolors.red("✗")} ${picocolors.dim(event.title)} — ${event.reason}`;
      case "validation_passed":
        return `  ${picocolors.green("✓")} ${picocolors.dim("Validation passed")}`;
      case "validation_failed":
        return `  ${picocolors.red("✗")} ${picocolors.dim(`Validation failed: ${event.reason}`)}`;
      case "info":
        return `  ${picocolors.cyan("◇")} ${event.message}`;
      default:
        return null;
    }
  }

  getLines(): string[] {
    return [...this.lines];
  }

  clear(): void {
    this.lines = [];
  }
}
