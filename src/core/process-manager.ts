import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureDir } from "../utils/fs.js";
import { getRunDir } from "../utils/paths.js";
import { EventStore } from "./event-store.js";
import type { EventType } from "../schemas/event.schema.js";
import { createRunEvent } from "../utils/event-factory.js";
import { killProcessTree, isAlive, waitForExit } from "../utils/process-tree-kill.js";
import { getShell, getShellCommandFlag } from "../utils/shell.js";
import { SpawnController, type SpawnControllerMetrics } from "../utils/process.js";
import { LogManager } from "./log-manager.js";

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

export interface PoolEntry {
  child: ChildProcess;
  poolKey: string;
  refCount: number;
  status: "idle" | "busy";
  createdAt: number;
  lastUsedAt: number;
}

export interface StopOptions {
  gracefulTimeoutMs?: number;
  forceKillTimeoutMs?: number;
}

export interface StopResult {
  success: boolean;
  finalStatus: "stopped" | "killed" | "not_found" | "stale";
}

export interface SpawnMetrics {
  totalSpawns: number;
  totalReuses: number;
  poolSize: number;
  activePoolSize: number;
  activeViteProcesses: number;
  viteSpawnCount: number;
  spawnController: SpawnControllerMetrics;
  spawnTimestamps: string[];
}

export class ProcessManager {
  private abortControllers: Map<string, AbortController> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  private processPool: Map<string, PoolEntry> = new Map();
  private poolCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxPoolSize = 10;
  private readonly idleTimeoutMs = 5 * 60 * 1000;
  private spawnController: SpawnController;
  private logManager: LogManager | null = null;
  private totalSpawns = 0;
  private totalReuses = 0;
  private viteSpawnCount = 0;
  private spawnTimestamps: string[] = [];
  private readonly MAX_SPAWN_TIMESTAMPS = 100;

  constructor(enablePoolCleanup = true) {
    this.spawnController = new SpawnController();
    this.spawnController.setLogger((msg) => this.logSpawnEvent(msg));
    if (enablePoolCleanup) {
      this.poolCleanupInterval = setInterval(() => {
        this.cleanupStalePoolEntries();
      }, 60_000);
    }
  }

  setLogManager(lm: LogManager | null): void {
    this.logManager = lm;
  }

  setMaxConcurrentHeavy(n: number): void {
    this.spawnController.setMaxConcurrentHeavy(n);
  }

  get maxConcurrentHeavy(): number {
    return this.spawnController.maxConcurrent;
  }

  async acquireSpawnSlot(command: string): Promise<() => void> {
    return this.spawnController.acquire(command);
  }

  private recordSpawn(command: string): void {
    this.totalSpawns++;
    if (this.spawnTimestamps.length >= this.MAX_SPAWN_TIMESTAMPS) {
      this.spawnTimestamps.shift();
    }
    this.spawnTimestamps.push(new Date().toISOString());
    if (/vite|vitest/i.test(command)) {
      this.viteSpawnCount++;
    }
  }

  private logSpawnEvent(message: string): void {
    // In-memory tracking only; LogManager integration is via the setLogger callback
  }

  private async logToRun(
    runId: string | undefined,
    message: string,
    level: "info" | "warn" | "error" = "info",
  ): Promise<void> {
    if (!runId || !this.logManager) return;
    try {
      await this.logManager.writeRuntimeJsonl(runId, {
        s: "system",
        m: JSON.stringify({ event: "process_spawn", message }),
        l: level,
        runId,
      });
    } catch {
      // non-critical
    }
  }

  isViteCommand(command: string): boolean {
    return /vite|vitest/.test(command);
  }

  dispose(): void {
    if (this.poolCleanupInterval) {
      clearInterval(this.poolCleanupInterval);
      this.poolCleanupInterval = null;
    }
  }

  getProcessPath(rootPath: string, runId: string): string {
    return path.join(getRunDir(rootPath, runId), "process.json");
  }

  registerController(runId: string, controller: AbortController): void {
    this.abortControllers.set(runId, controller);
  }

  getController(runId: string): AbortController | undefined {
    return this.abortControllers.get(runId);
  }

  registerChildProcess(runId: string, child: ChildProcess): void {
    this.childProcesses.set(runId, child);
    const runIdPoolKey = `run:${runId}`;
    const isNew = !this.processPool.has(runIdPoolKey);
    if (isNew) {
      this.recordSpawn("child_process");
      this.processPool.set(runIdPoolKey, {
        child,
        poolKey: runIdPoolKey,
        refCount: 0,
        status: "busy",
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      });
    }
    this.logToRun(
      runId,
      `child process registered (pid=${child.pid}, totalSpawns=${this.totalSpawns}, activePool=${this.activePoolSize})`,
    );
  }

  getChildProcess(runId: string): ChildProcess | null {
    return this.childProcesses.get(runId) ?? null;
  }

  unregisterChildProcess(runId: string): void {
    this.childProcesses.delete(runId);
    const runIdPoolKey = `run:${runId}`;
    const entry = this.processPool.get(runIdPoolKey);
    if (entry) {
      entry.status = "idle";
      entry.lastUsedAt = Date.now();
    }
    this.logToRun(
      runId,
      `child process unregistered (activePool=${this.activePoolSize}, poolSize=${this.poolSize})`,
    );
  }

  /** Build a canonical pool key from a command + cwd for pooling */
  private buildPoolKey(command: string, cwd?: string): string {
    return `${command}::${cwd ?? process.cwd()}`;
  }

  /**
   * Find an idle pooled process whose command matches.
   * Returns the process and marks it busy, or null if none available.
   */
  findReusableProcess(command: string, cwd?: string): ChildProcess | null {
    const poolKey = this.buildPoolKey(command, cwd);
    for (const [, entry] of this.processPool) {
      if (entry.poolKey !== poolKey) continue;
      if (
        entry.status === "idle" &&
        entry.child.exitCode === null &&
        entry.child.signalCode === null
      ) {
        entry.status = "busy";
        entry.refCount++;
        entry.lastUsedAt = Date.now();
        return entry.child;
      }
    }
    return null;
  }

  /**
   * Acquire a process from the pool, or spawn a new one if none is available.
   * Returns the process and whether it was newly spawned.
   */
  acquireProcess(
    command: string,
    args: string[],
    cwd?: string,
    runId?: string,
  ): { process: ChildProcess; reused: boolean } {
    const poolKey = this.buildPoolKey(command, cwd);

    // Check pool for a reusable idle process
    const existing = this.findReusableProcess(command, cwd);
    if (existing) {
      this.totalReuses++;
      this.logToRun(
        runId,
        `process reused from pool (command=${command}, totalReuses=${this.totalReuses})`,
      );
      return { process: existing, reused: true };
    }

    // Spawn a new process
    this.recordSpawn(command);
    const child = spawn(getShell(), [getShellCommandFlag(), command, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.processPool.set(poolKey, {
      child,
      poolKey,
      refCount: 1,
      status: "busy",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    const isVite = this.isViteCommand(command);
    this.logToRun(
      runId,
      `process spawned (command=${command}, pid=${child.pid}, vite=${isVite}, totalSpawns=${this.totalSpawns}, poolSize=${this.poolSize})`,
    );

    return { process: child, reused: false };
  }

  /**
   * Release a process back to the pool by pool key, or remove it entirely
   * if the ref count reaches zero (and it is no longer alive).
   */
  releaseProcess(poolKey: string, runId?: string): void {
    for (const [key, entry] of this.processPool) {
      if (entry.poolKey !== poolKey) continue;
      entry.refCount = Math.max(0, entry.refCount - 1);
      entry.status = "idle";
      entry.lastUsedAt = Date.now();

      this.logToRun(
        runId,
        `process released (poolKey=${poolKey}, refCount=${entry.refCount}, poolSize=${this.poolSize})`,
      );

      if (
        entry.refCount <= 0 &&
        (entry.child.exitCode !== null || entry.child.signalCode !== null)
      ) {
        this.processPool.delete(key);
        this.logToRun(
          runId,
          `process removed from pool (poolKey=${poolKey}, poolSize=${this.poolSize})`,
        );
      }
      return;
    }
  }

  /** Return count of currently pooled processes. */
  get poolSize(): number {
    return this.processPool.size;
  }

  /** Return count of active (busy) pooled processes. */
  get activePoolSize(): number {
    let count = 0;
    for (const [, entry] of this.processPool) {
      if (entry.status === "busy") count++;
    }
    return count;
  }

  /** Return count of active vite/vitest processes. */
  get activeViteProcesses(): number {
    let count = 0;
    for (const [, entry] of this.processPool) {
      if (entry.status === "busy" && this.isViteCommand(entry.poolKey)) count++;
    }
    return count;
  }

  getMetrics(): SpawnMetrics {
    return {
      totalSpawns: this.totalSpawns,
      totalReuses: this.totalReuses,
      poolSize: this.poolSize,
      activePoolSize: this.activePoolSize,
      activeViteProcesses: this.activeViteProcesses,
      viteSpawnCount: this.viteSpawnCount,
      spawnController: this.spawnController.getMetrics(),
      spawnTimestamps: [...this.spawnTimestamps],
    };
  }

  private cleanupStalePoolEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.processPool) {
      if (entry.status === "idle" && now - entry.lastUsedAt > this.idleTimeoutMs) {
        if (entry.child.exitCode === null) {
          killProcessTree(entry.child.pid!, "SIGTERM");
          this.logToRun(
            undefined,
            `stale idle process killed (poolKey=${key}, pid=${entry.child.pid})`,
            "warn",
          );
        }
        this.processPool.delete(key);
      }
    }
  }

  sendInput(runId: string, input: string): boolean {
    const child = this.childProcesses.get(runId);
    if (!child) return false;
    if (!child.stdin || child.stdin.destroyed) return false;
    try {
      child.stdin.write(input + "\n");
      return true;
    } catch {
      return false;
    }
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
    this.childProcesses.delete(runId);
    const runIdPoolKey = `run:${runId}`;
    this.processPool.delete(runIdPoolKey);
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

    this.logToRun(runId, `stopping process (pid=${meta.pid})`);

    try {
      killProcessTree(meta.pid, "SIGTERM");
      await this.updateStatus(rootPath, runId, "stopped");
      await waitForExit(meta.pid, gracefulMs);
      await this.clear(rootPath, runId);
      this.logToRun(runId, `process stopped gracefully (pid=${meta.pid})`);
      return { success: true, finalStatus: "stopped" };
    } catch {
      try {
        killProcessTree(meta.pid, "SIGKILL");
        await this.updateStatus(rootPath, runId, "killed");
        await this.clear(rootPath, runId);
        this.logToRun(runId, `process force-killed (pid=${meta.pid})`);
        return { success: true, finalStatus: "killed" };
      } catch {
        await this.updateStatus(rootPath, runId, "stale");
        await this.clear(rootPath, runId);
        this.logToRun(runId, `process stop failed, marked stale (pid=${meta.pid})`, "warn");
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
    type: EventType,
    taskId?: string,
    message?: string,
  ): Promise<void> {
    const store = new EventStore(rootPath);
    await store.appendToRun(runId, createRunEvent(type, { runId, taskId, message }));
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
