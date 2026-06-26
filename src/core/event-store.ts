import path from "node:path";
import { type FlowTaskEvent } from "../schemas/event.schema.js";
import { ensureDir, appendToFile, readTextFile } from "../utils/fs.js";
import { eventsJsonlPath, getRunDir } from "../utils/paths.js";
import { now } from "../utils/time.js";

export class EventStore {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  async appendToRun(runId: string, event: Omit<FlowTaskEvent, "time">): Promise<void> {
    const eventPath = eventsJsonlPath(this.rootPath, runId);
    await ensureDir(getRunDir(this.rootPath, runId));
    const fullEvent: FlowTaskEvent = { ...event, time: now() };
    await appendToFile(eventPath, `${JSON.stringify(fullEvent)}\n`);
  }

  async readRunEvents(runId: string): Promise<FlowTaskEvent[]> {
    const eventPath = eventsJsonlPath(this.rootPath, runId);
    try {
      const content = await readTextFile(eventPath);
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FlowTaskEvent);
    } catch {
      return [];
    }
  }

  async appendGlobal(event: Omit<FlowTaskEvent, "time">): Promise<void> {
    const eventPath = path.join(this.rootPath, ".flowtask", "events.jsonl");
    const fullEvent: FlowTaskEvent = { ...event, time: now() };
    await appendToFile(eventPath, `${JSON.stringify(fullEvent)}\n`);
  }
}
