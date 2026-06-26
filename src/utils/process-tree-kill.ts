import { platform } from "node:os";
import { spawn } from "node:child_process";

export function setDetachedSpawnOptions(): {
  detached: boolean;
} {
  return platform() === "win32" ? { detached: false } : { detached: true };
}

export function killProcessTree(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  try {
    if (platform() === "win32") {
      spawn("taskkill", ["/T", "/F", "/PID", String(pid)], {
        stdio: "ignore",
      });
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // process or group may already be gone
  }
}

export async function killProcessTreeGraceful(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
  graceMs = 5000,
): Promise<"stopped" | "killed" | "not_found"> {
  if (!isAlive(pid)) {
    return "not_found";
  }

  killProcessTree(pid, signal);

  if (await waitForExit(pid, graceMs)) {
    return "stopped";
  }

  killProcessTree(pid, "SIGKILL");
  return "killed";
}

export function isAlive(pid: number): boolean {
  try {
    if (platform() === "win32") {
      process.kill(pid, 0);
      return true;
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      return true;
    }
  }
  return false;
}
