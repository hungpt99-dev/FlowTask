import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { ensureDir, fileExists, readJsonFile, atomicWriteJsonFile } from "../utils/fs.js";

export interface CacheEntry<T> {
  version: number;
  data: T;
  fingerprints: Record<string, string>;
  gitHeadHash: string | null;
  timestamp: number;
}

export interface ScanCacheOptions {
  cacheDir: string;
  useCache?: boolean;
}

export class ScanCache {
  static readonly VERSION = 1;

  private cacheDir: string;
  private enabled: boolean;

  constructor(options: ScanCacheOptions) {
    this.cacheDir = options.cacheDir;
    this.enabled = options.useCache ?? true;
  }

  async get<T>(key: string, deps: string[]): Promise<T | null> {
    if (!this.enabled) return null;

    const cacheFile = this.getPath(key);
    if (!(await fileExists(cacheFile))) return null;

    try {
      const entry = await readJsonFile<CacheEntry<T>>(cacheFile);
      if (entry.version !== ScanCache.VERSION) return null;

      const currentFps = await this.computeFingerprints(deps);
      const currentGitHash = await this.gitHeadHash(deps);

      if (entry.gitHeadHash !== currentGitHash) return null;

      if (!this.fingerprintsMatch(entry.fingerprints, currentFps)) return null;

      return entry.data;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, data: T, deps: string[]): Promise<void> {
    if (!this.enabled) return;

    const fingerprints = await this.computeFingerprints(deps);
    const gitHeadHash = await this.gitHeadHash(deps);

    const entry: CacheEntry<T> = {
      version: ScanCache.VERSION,
      data,
      fingerprints,
      gitHeadHash,
      timestamp: Date.now(),
    };

    const cacheFile = this.getPath(key);
    try {
      await ensureDir(path.dirname(cacheFile));
      await atomicWriteJsonFile(cacheFile, entry);
    } catch {
      // cache write failures are non-fatal
    }
  }

  async invalidate(key: string): Promise<void> {
    const cacheFile = this.getPath(key);
    try {
      await fs.unlink(cacheFile);
    } catch {
      // ignore if file doesn't exist
    }
  }

  private getPath(key: string): string {
    const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
    return path.join(this.cacheDir, `${hash}.json`);
  }

  private async computeFingerprints(files: string[]): Promise<Record<string, string>> {
    const fps: Record<string, string> = {};
    const unique = [...new Set(files)].filter(Boolean);
    for (const filePath of unique) {
      try {
        const stat = await fs.stat(filePath);
        fps[filePath] = `${stat.mtimeMs}:${stat.size}`;
      } catch {
        fps[filePath] = "missing";
      }
    }
    return fps;
  }

  private async gitHeadHash(deps: string[]): Promise<string | null> {
    const gitHead = deps.find((d) => d.endsWith("HEAD") && d.includes(".git"));
    if (!gitHead) return null;
    try {
      if (!(await fileExists(gitHead))) return null;
      const content = await fs.readFile(gitHead, "utf-8");
      return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
    } catch {
      return null;
    }
  }

  private fingerprintsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  }
}
