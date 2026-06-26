import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { accessSync } from "node:fs";

export function commandExists(command: string): boolean {
  if (command.includes("/") || command.includes("\\")) {
    try {
      accessSync(command);
      return true;
    } catch {
      return false;
    }
  }

  const result = spawnSync(platform() === "win32" ? "where" : "which", [command], {
    stdio: "ignore",
  });
  return result.status === 0;
}
