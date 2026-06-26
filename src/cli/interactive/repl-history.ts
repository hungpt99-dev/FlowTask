import fs from "node:fs/promises";
import path from "node:path";

const SENSITIVE_PATTERNS = [
  /api_key/i,
  /token/i,
  /secret/i,
  /password/i,
  /database_url/i,
  /private_key/i,
  /access_key/i,
  /authorization/i,
  /bearer/i,
];

const EXIT_COMMANDS = new Set(["exit", "quit", "/exit", "/quit"]);

export interface ReplHistoryOptions {
  projectRoot: string;
  maxEntries?: number;
}

export class ReplHistory {
  private historyPath: string;
  private tmpPath: string;
  private maxEntries: number;
  private projectRoot: string;
  private lines: string[] = [];

  constructor(options: ReplHistoryOptions) {
    this.projectRoot = options.projectRoot;
    this.historyPath = path.join(options.projectRoot, ".flowtask", "history");
    this.tmpPath = path.join(options.projectRoot, ".flowtask", "history.tmp");
    this.maxEntries = options.maxEntries ?? 500;
  }

  async load(): Promise<string[]> {
    try {
      const content = await fs.readFile(this.historyPath, "utf-8");
      this.lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      return [...this.lines];
    } catch {
      this.lines = [];
      return [];
    }
  }

  getLines(): string[] {
    return [...this.lines];
  }

  shouldPersist(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (EXIT_COMMANDS.has(trimmed.toLowerCase())) return false;
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(trimmed)) return false;
    }
    return true;
  }

  async append(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!this.shouldPersist(trimmed)) return;

    const last = this.lines[this.lines.length - 1];
    if (last === trimmed) return;

    this.lines.push(trimmed);

    if (this.lines.length > this.maxEntries) {
      this.lines = this.lines.slice(-this.maxEntries);
    }

    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      const flowtaskDir = path.join(this.projectRoot, ".flowtask");
      await fs.access(flowtaskDir);
    } catch {
      return;
    }

    const content = this.lines.join("\n") + "\n";
    try {
      await fs.writeFile(this.tmpPath, content, "utf-8");
      await fs.rename(this.tmpPath, this.historyPath);
    } catch {
      // silent fail — history is non-critical
    }
  }
}
