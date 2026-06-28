import path from "node:path";
import { FlowTaskEventSchema, type FlowTaskEvent } from "../schemas/event.schema.js";
import { ensureDir, appendToFile, readTextFile } from "../utils/fs.js";
import { eventsJsonlPath, getRunDir } from "../utils/paths.js";
import { now } from "../utils/time.js";
import type { DatabaseManager } from "./database-manager.js";

export class EventStore {
  private rootPath: string;
  private db: DatabaseManager | null = null;

  constructor(rootPath: string, db?: DatabaseManager) {
    this.rootPath = rootPath;
    this.db = db ?? null;
  }

  setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  async appendToRun(runId: string, event: Omit<FlowTaskEvent, "time">): Promise<void> {
    const eventPath = eventsJsonlPath(this.rootPath, runId);
    await ensureDir(getRunDir(this.rootPath, runId));
    const fullEvent: FlowTaskEvent = { ...event, time: now() };
    await appendToFile(eventPath, `${JSON.stringify(fullEvent)}\n`);

    if (this.db) {
      try {
        this.db.insertEvent(fullEvent);
      } catch {
        // DB write is secondary; JSONL is source of truth
      }
    }
  }

  async readRunEvents(runId: string): Promise<FlowTaskEvent[]> {
    const eventPath = eventsJsonlPath(this.rootPath, runId);
    try {
      const content = await readTextFile(eventPath);
      const events: FlowTaskEvent[] = [];
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const result = FlowTaskEventSchema.safeParse(parsed);
        if (result.success) {
          events.push(result.data);
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  async appendGlobal(event: Omit<FlowTaskEvent, "time">): Promise<void> {
    const eventPath = path.join(this.rootPath, ".flowtask", "events.jsonl");
    const fullEvent: FlowTaskEvent = { ...event, time: now() };
    await appendToFile(eventPath, `${JSON.stringify(fullEvent)}\n`);

    if (this.db) {
      try {
        this.db.insertEvent(fullEvent);
      } catch {
        // DB write is secondary
      }
    }
  }

  async rotateGlobalEvents(maxEvents?: number): Promise<void> {
    const eventPath = path.join(this.rootPath, ".flowtask", "events.jsonl");
    const limit = maxEvents ?? 1000;
    try {
      const content = await readTextFile(eventPath);
      const lines = content.split("\n").filter(Boolean);
      if (lines.length <= limit) return;
      const rotated = lines.slice(lines.length - limit);
      const { writeTextFile } = await import("../utils/fs.js");
      await writeTextFile(eventPath, rotated.join("\n") + "\n");
    } catch {
      // non-critical
    }
  }

  queryEvents(runId?: string, type?: string, limit?: number): FlowTaskEvent[] {
    if (!this.db) return [];
    try {
      return this.db.queryEvents(runId, type, limit);
    } catch {
      return [];
    }
  }
}
