import { spawn, type ChildProcess } from "node:child_process";
import { getShell, getShellCommandFlag } from "./shell.js";

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: string | null;
}

// ── Spawn concurrency control ──────────────────────────

const HEAVY_PATTERNS = [/vite/, /vitest/];

function isHeavyCommand(command: string): boolean {
  return HEAVY_PATTERNS.some((p) => p.test(command));
}

type ReleaseSlot = () => void;

export interface SpawnControllerMetrics {
  totalAcquired: number;
  totalReleased: number;
  totalQueued: number;
  totalDequeued: number;
  peakQueueLength: number;
  activeHeavyCount: number;
  currentQueueLength: number;
  maxConcurrentHeavy: number;
}

export type SpawnLogFn = (message: string) => void;

/**
 * Limits concurrent spawning of heavy commands (vite, vitest)
 * to prevent uncontrolled process proliferation.
 */
export class SpawnController {
  private maxConcurrentHeavy = 1;
  private activeHeavyCount = 0;
  private heavyQueue: Array<() => void> = [];
  private totalAcquired = 0;
  private totalReleased = 0;
  private totalQueued = 0;
  private totalDequeued = 0;
  private peakQueueLength = 0;
  private logFn: SpawnLogFn | null = null;

  setMaxConcurrentHeavy(n: number): void {
    this.maxConcurrentHeavy = Math.max(1, n);
  }

  get maxConcurrent(): number {
    return this.maxConcurrentHeavy;
  }

  setLogger(fn: SpawnLogFn | null): void {
    this.logFn = fn;
  }

  getMetrics(): SpawnControllerMetrics {
    return {
      totalAcquired: this.totalAcquired,
      totalReleased: this.totalReleased,
      totalQueued: this.totalQueued,
      totalDequeued: this.totalDequeued,
      peakQueueLength: this.peakQueueLength,
      activeHeavyCount: this.activeHeavyCount,
      currentQueueLength: this.heavyQueue.length,
      maxConcurrentHeavy: this.maxConcurrentHeavy,
    };
  }

  /** Acquire a slot if the command is heavy; otherwise no-op. */
  async acquire(command: string): Promise<ReleaseSlot> {
    if (!isHeavyCommand(command)) {
      return () => {};
    }
    this.totalAcquired++;
    if (this.activeHeavyCount < this.maxConcurrentHeavy) {
      this.activeHeavyCount++;
      this.logFn?.(
        `[spawn] heavy slot acquired (active=${this.activeHeavyCount}, command=${command})`,
      );
      return () => this.release(command);
    }
    this.totalQueued++;
    if (this.heavyQueue.length > this.peakQueueLength) {
      this.peakQueueLength = this.heavyQueue.length;
    }
    this.logFn?.(
      `[spawn] heavy command queued (queue=${this.heavyQueue.length}, command=${command})`,
    );
    return new Promise<ReleaseSlot>((resolve) => {
      this.heavyQueue.push(() => {
        this.activeHeavyCount++;
        resolve(() => this.release(command));
      });
    });
  }

  private release(command?: string): void {
    this.totalReleased++;
    if (this.heavyQueue.length > 0) {
      const next = this.heavyQueue.shift()!;
      this.totalDequeued++;
      this.logFn?.(
        `[spawn] dequeued waiting command (queue=${this.heavyQueue.length}, active=${this.activeHeavyCount})`,
      );
      next();
    } else {
      this.activeHeavyCount = Math.max(0, this.activeHeavyCount - 1);
      this.logFn?.(
        `[spawn] heavy slot released (active=${this.activeHeavyCount}${command ? `, command=${command}` : ""})`,
      );
    }
  }
}

const defaultController = new SpawnController();

export function getSpawnController(): SpawnController {
  return defaultController;
}

// ── Spawn functions ────────────────────────────────────

export function spawnCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
): ChildProcess {
  return spawn(getShell(), [getShellCommandFlag(), command, ...args], {
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: options?.timeout,
  });
}

async function spawnWithPromiseInternal(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    signal?: AbortSignal;
  },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(getShell(), [getShellCommandFlag(), command, ...args], {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: options?.timeout,
      signal: options?.signal,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, stdout, stderr, signal });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

export async function spawnWithPromise(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    signal?: AbortSignal;
  },
): Promise<SpawnResult> {
  const release = await defaultController.acquire(command);
  try {
    return await spawnWithPromiseInternal(command, args, options);
  } finally {
    release();
  }
}

export interface SpawnStreamCallbacks {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  onClose?: (exitCode: number | null) => void;
}

async function spawnWithStreamingInternal(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    signal?: AbortSignal;
    callbacks?: SpawnStreamCallbacks;
  },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(getShell(), [getShellCommandFlag(), command, ...args], {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: options?.timeout,
      signal: options?.signal,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      options?.callbacks?.onStdout?.(text);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      options?.callbacks?.onStderr?.(text);
    });

    child.on("close", (exitCode, signal) => {
      options?.callbacks?.onClose?.(exitCode);
      resolve({ exitCode, stdout, stderr, signal });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

export async function spawnWithStreaming(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    signal?: AbortSignal;
    callbacks?: SpawnStreamCallbacks;
  },
): Promise<SpawnResult> {
  const release = await defaultController.acquire(command);
  try {
    return await spawnWithStreamingInternal(command, args, options);
  } finally {
    release();
  }
}
