import { platform } from "node:os";

export function getShell(): string {
  if (platform() === "win32") {
    return "cmd.exe";
  }
  return "sh";
}

export function getShellCommandFlag(): string {
  if (platform() === "win32") {
    return "/c";
  }
  return "-c";
}
