import type { UiEvent } from "../event-bus.js";
import type { EventBus } from "../event-bus.js";
import { stripAnsi } from "../../utils/stream-lines.js";

export interface PlainRendererOptions {
  showTimestamp?: boolean;
}

export class PlainRenderer {
  private showTimestamp: boolean;

  constructor(options?: PlainRendererOptions) {
    this.showTimestamp = options?.showTimestamp ?? false;
  }

  subscribe(eventBus: EventBus): () => void {
    return eventBus.subscribeSync((event: UiEvent) => {
      this.render(event);
    });
  }

  render(event: UiEvent): void {
    if (event.type === "task_started") {
      process.stdout.write(`--- [${event.index}/${event.total}] ${event.title} ---\n`);
      return;
    }
    if (event.type === "executor_output") {
      const cleaned = stripAnsi(event.text);
      const ts = this.showTimestamp ? `[${new Date().toLocaleTimeString()}] ` : "";
      process.stdout.write(`${ts}${cleaned}\n`);
    }
  }
}
