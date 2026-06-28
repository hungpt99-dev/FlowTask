import { spawn, type ChildProcess } from "node:child_process";
import { getShell, getShellCommandFlag } from "./shell.js";

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: string | null;
}

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

export interface SpawnStreamCallbacks {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  onClose?: (exitCode: number | null) => void;
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
