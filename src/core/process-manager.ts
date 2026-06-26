import fs from "node:fs/promises";
import { ensureDir } from "../utils/fs.js";
import { getRunDir } from "../utils/paths.js";
import path from "node:path";
import { now } from "../utils/time.js";

export interface ProcessMeta {
  runId: string;
  taskId: string;
  pid: number;
  startedAt: string;
  executor: string;
}

export class ProcessManager {
  private processes: Map<string, ProcessMeta> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  async register(
    rootPath: string,
    runId: string,
    taskId: string,
    pid: number,
    executor: string,
  ): Promise<void> {
    const meta: ProcessMeta = { runId, taskId, pid, startedAt: now(), executor };
    this.processes.set(runId, meta);
    this.processes.set(taskId, meta);

    const stateDir = path.join(getRunDir(rootPath, runId), "state");
    await ensureDir(stateDir);
    await fs.writeFile(path.join(stateDir, "process.json"), JSON.stringify(meta, null, 2), "utf-8");
  }

  registerController(runId: string, controller: AbortController): void {
    this.abortControllers.set(runId, controller);
  }

  getProcess(runId: string): ProcessMeta | undefined {
    return this.processes.get(runId);
  }

  getProcessByTaskId(taskId: string): ProcessMeta | undefined {
    return this.processes.get(taskId);
  }

  async clear(rootPath: string, runId: string): Promise<void> {
    this.processes.delete(runId);
    this.abortControllers.delete(runId);

    const stateDir = path.join(getRunDir(rootPath, runId), "state");
    try {
      await fs.unlink(path.join(stateDir, "process.json"));
    } catch {
      // ignore if file does not exist
    }
  }

  async stopProcess(rootPath: string, runId: string, gracefulTimeoutMs = 5000): Promise<boolean> {
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
    }

    const meta = this.processes.get(runId);
    if (!meta) return false;

    try {
      process.kill(meta.pid, "SIGTERM");
      await this.waitForExit(meta.pid, gracefulTimeoutMs);
      await this.clear(rootPath, runId);
      return true;
    } catch {
      try {
        process.kill(meta.pid, "SIGKILL");
        await this.clear(rootPath, runId);
        return true;
      } catch {
        await this.clear(rootPath, runId);
        return false;
      }
    }
  }

  async forceKill(pid: number): Promise<boolean> {
    try {
      process.kill(pid, "SIGKILL");
      return true;
    } catch {
      return false;
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

  hasActiveProcess(runId: string): boolean {
    return this.processes.has(runId);
  }
}
