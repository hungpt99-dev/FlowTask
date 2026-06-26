import type { UiEvent } from "../event-bus.js";

export class JsonRenderer {
  write(event: UiEvent): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }

  writeEvents(events: UiEvent[]): void {
    for (const event of events) {
      this.write(event);
    }
  }
}
