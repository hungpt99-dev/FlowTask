import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../utils/fs.js";
import { getRunDir } from "../utils/paths.js";
import { EventStore } from "./event-store.js";

export interface ProcessMetadata {
  runId: string;
  taskId: string | undefined;
  pid: number;
  executor: string;
  command: string;
  args: string[];
  startedAt: string;
  status: "running" | "exited" | "stopped" | "killed" | "stale";
}

export interface StopOptions {
  gracefulTimeoutMs?: number;
  forceKillTimeoutMs?: number;
}

export interface StopResult {
  success: boolean;
  finalStatus: "stopped" | "killed" | "not_found" | "stale";
}

export class ProcessManager {
  private abortControllers: Map<string, AbortController> = new Map();

  getProcessPath(rootPath: string, runId: string): string {
    return path.join(getRunDir(rootPath, runId), "process.json");
  }

  registerController(runId: string, controller: AbortController): void {
    this.abortControllers.set(runId, controller);
  }

  getController(runId: string): AbortController | undefined {
    return this.abortControllers.get(runId);
  }

  async save(rootPath: string, metadata: ProcessMetadata): Promise<void> {
    const processPath = this.getProcessPath(rootPath, metadata.runId);
    await ensureDir(path.dirname(processPath));
    await fs.writeFile(processPath, JSON.stringify(metadata, null, 2), "utf-8");
  }

  async read(rootPath: string, runId: string): Promise<ProcessMetadata | null> {
    try {
      const content = await fs.readFile(this.getProcessPath(rootPath, runId), "utf-8");
      return JSON.parse(content) as ProcessMetadata;
    } catch {
      return null;
    }
  }

  async clear(rootPath: string, runId: string): Promise<void> {
    this.abortControllers.delete(runId);
    try {
      await fs.unlink(this.getProcessPath(rootPath, runId));
    } catch {
      // ignore
    }
  }

  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async stop(rootPath: string, runId: string, options?: StopOptions): Promise<StopResult> {
    const meta = await this.read(rootPath, runId);
    if (!meta) {
      return { success: false, finalStatus: "not_found" };
    }

    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
    }

    const gracefulMs = options?.gracefulTimeoutMs ?? 5000;

    if (!this.isAlive(meta.pid)) {
      await this.updateStatus(rootPath, runId, "stale");
      await this.clear(rootPath, runId);
      return { success: false, finalStatus: "stale" };
    }

    try {
      process.kill(meta.pid, "SIGTERM");
      await this.updateStatus(rootPath, runId, "stopped");
      await this.waitForExit(meta.pid, gracefulMs);
      await this.clear(rootPath, runId);
      return { success: true, finalStatus: "stopped" };
    } catch {
      try {
        process.kill(meta.pid, "SIGKILL");
        await this.updateStatus(rootPath, runId, "killed");
        await this.clear(rootPath, runId);
        return { success: true, finalStatus: "killed" };
      } catch {
        await this.updateStatus(rootPath, runId, "stale");
        await this.clear(rootPath, runId);
        return { success: false, finalStatus: "stale" };
      }
    }
  }

  async isRunning(rootPath: string, runId: string): Promise<boolean> {
    const meta = await this.read(rootPath, runId);
    if (!meta) return false;
    return this.isAlive(meta.pid);
  }

  async writeEvent(
    rootPath: string,
    runId: string,
    type: string,
    taskId?: string,
    message?: string,
  ): Promise<void> {
    const store = new EventStore(rootPath);
    await store.appendToRun(runId, {
      type: type as never,
      runId,
      taskId,
      message,
    });
  }

  private async updateStatus(
    rootPath: string,
    runId: string,
    status: ProcessMetadata["status"],
  ): Promise<void> {
    const meta = await this.read(rootPath, runId);
    if (meta) {
      meta.status = status;
      await this.save(rootPath, meta);
    }
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        return;
      }
    }
  }
}
