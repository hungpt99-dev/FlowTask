import { fileExists, readTextFile } from "./fs.js";
import path from "node:path";

export async function loadEnvFile(rootPath: string): Promise<void> {
  const envPath = path.join(rootPath, ".env");
  const exists = await fileExists(envPath);
  if (!exists) return;

  const content = await readTextFile(envPath);
  const lines = content.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key) continue;

    if (process.env[key] !== undefined) continue;

    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

export function formatEnvEntry(key: string, value: string): string {
  const needsQuoting =
    value.includes("#") ||
    value.includes(" ") ||
    value.includes("=") ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes("\n");
  if (needsQuoting) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return `${key}="${escaped}"`;
  }
  return `${key}=${value}`;
}
