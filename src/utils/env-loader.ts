import { fileExists, readTextFile, fileStat } from "./fs.js";
import path from "node:path";

const DANGEROUS_ENV_VARS = new Set([
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_FORCE_FLAT_NAMESPACE",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "LD_DEBUG",
  "LD_OPENCL_DEBUG",
]);

function warn(msg: string): void {
  console.warn(`[env-loader] ${msg}`);
}

export async function loadEnvFile(rootPath: string): Promise<void> {
  const envPath = path.join(rootPath, ".env");
  const exists = await fileExists(envPath);
  if (!exists) return;

  const stat = await fileStat(envPath);
  if (stat) {
    const isWorldReadable = stat.mode & 0o004;
    const isGroupWritable = stat.mode & 0o020;
    if (isWorldReadable) {
      warn(`.env file at ${envPath} is world-readable. Consider: chmod 600 .env`);
    }
    if (isGroupWritable) {
      warn(`.env file at ${envPath} is group-writable. Consider: chmod 600 .env`);
    }
  }

  const content = await readTextFile(envPath);
  const lines = content.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key) continue;

    if (DANGEROUS_ENV_VARS.has(key)) {
      warn(`Skipping dangerous environment variable "${key}" from .env`);
      continue;
    }

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

  warn(`Loaded .env from ${envPath}`);
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
