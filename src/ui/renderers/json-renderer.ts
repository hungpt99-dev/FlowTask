import type { UiEvent } from "../event-bus.js";
import type { EventBus } from "../event-bus.js";

export class JsonRenderer {
  subscribe(eventBus: EventBus): () => void {
    // Subscribe with sync delivery for immediate JSONL output
    return eventBus.subscribeSync((event: UiEvent) => {
      this.render(event);
    });
  }

  render(event: UiEvent): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }

  write(event: UiEvent): void {
    this.render(event);
  }

  writeEvents(events: UiEvent[]): void {
    for (const event of events) {
      this.render(event);
    }
  }
}
