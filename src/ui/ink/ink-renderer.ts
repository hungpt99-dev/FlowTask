import type { EventBus, UiEvent } from "../event-bus.js";
import { OutputBuffer } from "../output-buffer.js";

/**
 * Ink-based rich renderer.
 *
 * Falls back to line-based output if Ink is not installed or terminal is unsupported.
 */
export class InkRenderer {
  private eventBus?: EventBus;
  private unsubscribe?: () => void;
  private outputBuffer: OutputBuffer;
  private maxVisibleLines: number;
  private lines: string[] = [];
  private inkAvailable = false;

  constructor(maxVisibleLines = 30) {
    this.maxVisibleLines = maxVisibleLines;
    this.outputBuffer = new OutputBuffer({
      maxLines: 500,
      flushIntervalMs: 50,
      onFlush: (events) => this.renderBatch(events),
    });
  }

  subscribe(eventBus: EventBus): () => void {
    this.eventBus = eventBus;
    this.unsubscribe = eventBus.subscribe((event: UiEvent) => {
      this.outputBuffer.push(event);
    });
    return () => {
      this.outputBuffer.close();
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = undefined;
    };
  }

  private renderBatch(events: UiEvent[]): void {
    for (const event of events) {
      const line = this.formatEvent(event);
      if (line) {
        this.lines.push(line);
        if (this.lines.length > 500) {
          this.lines = this.lines.slice(-500);
        }
      }
    }

    // Display latest N lines
    const display = this.lines.slice(-this.maxVisibleLines);
    for (const line of display) {
      process.stdout.write(line + "\n");
    }
  }

  private formatEvent(event: UiEvent): string | null {
    switch (event.type) {
      case "executor_output":
        return `  [${event.executor}][${event.stream}] ${event.text}`;
      case "executor_started":
        return `  [${event.executor}] started`;
      case "executor_exited": {
        const status = event.exitCode === 0 ? "exited" : "failed";
        return `  [${event.executor}] ${status} (code ${event.exitCode})`;
      }
      case "executor_failed":
        return `  [${event.executor}] failed: ${event.reason}`;
      case "task_completed":
        return `  ✓ ${event.title}`;
      case "task_failed":
        return `  ✗ ${event.title} — ${event.reason}`;
      case "validation_passed":
        return "  ✓ Validation passed";
      case "validation_failed":
        return `  ✗ Validation failed: ${event.reason}`;
      default:
        return null;
    }
  }
}
