import picocolors from "picocolors";
import type { UiEvent } from "../event-bus.js";
import type { EventBus } from "../event-bus.js";

export interface RichRendererOptions {
  showTimestamp?: boolean;
  maxLineLength?: number;
}

export class RichRenderer {
  private showTimestamp: boolean;
  private maxLineLength: number;

  constructor(options?: RichRendererOptions) {
    this.showTimestamp = options?.showTimestamp ?? false;
    this.maxLineLength = options?.maxLineLength ?? 2000;
  }

  subscribe(eventBus: EventBus): () => void {
    return eventBus.subscribeSync((event: UiEvent) => {
      this.render(event);
    });
  }

  render(event: UiEvent): void {
    if (event.type === "task_started") {
      const line = picocolors.cyan(
        `\u2500\u2500 [${event.index}/${event.total}] ${event.title} \u2500${"\u2500".repeat(50)}`,
      );
      process.stdout.write(`\n${line}\n`);
      return;
    }
    if (event.type === "executor_output") {
      const prefix = event.stream === "stderr" ? picocolors.yellow("!") : picocolors.dim(">");
      const ts = this.showTimestamp
        ? `${picocolors.dim(`[${new Date().toLocaleTimeString()}]`)} `
        : "";
      let text = event.text;
      if (text.length > this.maxLineLength) {
        text = text.slice(0, this.maxLineLength) + "\u2026";
      }
      process.stdout.write(`  ${ts}${prefix} ${text}\n`);
    }
  }
}
