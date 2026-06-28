import type { FlowTaskEvent, EventType } from "../schemas/event.schema.js";

export function createRunEvent(
  type: EventType,
  data?: Partial<Omit<FlowTaskEvent, "type" | "time">>,
): Omit<FlowTaskEvent, "time"> {
  return { type, ...data };
}
