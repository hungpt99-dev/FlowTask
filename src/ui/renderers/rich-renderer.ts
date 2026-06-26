import type { UiEvent } from "../event-bus.js";
import type { EventBus } from "../event-bus.js";

export class RichRenderer {
  subscribe(eventBus: EventBus): () => void {
    return eventBus.subscribeSync((event: UiEvent) => {
      this.render(event);
    });
  }

  render(event: UiEvent): void {
    if (event.type === "executor_output") {
      process.stdout.write(event.text);
    }
  }
}
