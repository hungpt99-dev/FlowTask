import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureDir } from "../utils/fs.js";
import { getRunDir } from "../utils/paths.js";
import { EventStore } from "./event-store.js";
import type { EventType } from "../schemas/event.schema.js";
import { createRunEvent } from "../utils/event-factory.js";
import { killProcessTree, isAlive, waitForExit } from "../utils/process-tree-kill.js";

export const ProcessMetadataSchema = z.object({
  runId: z.string(),
  taskId: z.string().optional(),
  pid: z.number(),
  executor: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  startedAt: z.string(),
  status: z.enum(["running", "exited", "stopped", "killed", "stale"]),
});

export type ProcessMetadata = z.infer<typeof ProcessMetadataSchema>;

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
    await fs.writeFile(processPath, JSON.stringify(metadata), "utf-8");
  }

  async read(rootPath: string, runId: string): Promise<ProcessMetadata | null> {
    try {
      const content = await fs.readFile(this.getProcessPath(rootPath, runId), "utf-8");
      const parsed = JSON.parse(content);
      const result = ProcessMetadataSchema.safeParse(parsed);
      return result.success ? result.data : null;
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
    return isAlive(pid);
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
      killProcessTree(meta.pid, "SIGTERM");
      await this.updateStatus(rootPath, runId, "stopped");
      await waitForExit(meta.pid, gracefulMs);
      await this.clear(rootPath, runId);
      return { success: true, finalStatus: "stopped" };
    } catch {
      try {
        killProcessTree(meta.pid, "SIGKILL");
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
    await store.appendToRun(runId, createRunEvent(type as EventType, { runId, taskId, message }));
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
}
