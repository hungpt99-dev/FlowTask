import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string, mode?: number): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode });
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8");
}

export async function writeTextFile(
  filePath: string,
  content: string,
  mode?: number,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const opts: { encoding: "utf-8"; mode?: number } = { encoding: "utf-8" };
  if (mode !== undefined) opts.mode = mode;
  await fs.writeFile(filePath, content, opts);
}

export async function atomicWriteJsonFile(
  filePath: string,
  data: unknown,
  pretty?: boolean,
  mode?: number,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  const tmpPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const writeOpts: { encoding: "utf-8"; mode?: number } = { encoding: "utf-8" };
  if (mode !== undefined) writeOpts.mode = mode;
  await fs.writeFile(tmpPath, content, writeOpts);
  await fs.rename(tmpPath, filePath);
  if (mode !== undefined) {
    await fs.chmod(filePath, mode);
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await readTextFile(filePath);
  return JSON.parse(content) as T;
}

export async function appendToFile(
  filePath: string,
  content: string,
  mode?: number,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, content, { encoding: "utf-8", mode });
}

export async function removeDir(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

export async function readDir(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

export async function fileStat(filePath: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}
