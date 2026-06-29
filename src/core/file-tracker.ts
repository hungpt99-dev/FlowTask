import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  ensureDir,
  fileExists,
  readTextFile,
  writeTextFile,
  atomicWriteJsonFile,
  readDir,
} from "../utils/fs.js";
import { generateArtifactId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import { getFileSnapshotsDir, getFileChangesDir, getRunDir } from "../utils/paths.js";
import type { ArtifactManager } from "./artifact-manager.js";

export type FileChangeType = "created" | "modified" | "deleted" | "renamed";

export type FileChangeCategory =
  | "expected"
  | "unexpected"
  | "empty"
  | "unrelated"
  | "sensitive"
  | "env_config"
  | "lockfile"
  | "large";

export interface FileSnapshot {
  filePath: string;
  hash: string;
  size: number;
  modifiedAt: string;
}

export interface FileChange {
  changeId: string;
  runId: string;
  taskId?: string;
  stepId?: string;
  type: FileChangeType;
  filePath: string;
  oldPath?: string;
  category: FileChangeCategory;
  summary: string;
  diff?: string;
  diffStat?: string;
  oldHash?: string;
  newHash?: string;
  oldSize?: number;
  newSize?: number;
  artifactId?: string;
  metadata?: Record<string, unknown>;
  detectedAt: string;
}

export interface TrackedChangesSummary {
  total: number;
  created: number;
  modified: number;
  deleted: number;
  renamed: number;
  expected: number;
  unexpected: number;
  sensitive: number;
  envConfig: number;
  lockfile: number;
  large: number;
  empty: number;
  unrelated: number;
}

const SENSITIVE_FILE_PATTERNS = [
  /\.env$/,
  /\.env\.\w+$/,
  /id_rsa$/,
  /id_rsa\.pub$/,
  /\.pem$/,
  /\.key$/,
  /credentials$/,
  /secrets\//,
  /\.secret$/,
  /(^|\/)\.flowtask\/config\.json$/,
];

const ENV_CONFIG_PATTERNS = [
  /\.env/,
  /\.env\.\w+/,
  /\.flowtask\//,
  /config\.\w+$/,
  /\.y[a]?ml$/,
  /\.json$/,
  /tsconfig\.json$/,
  /\.npmrc$/,
  /\.gitignore$/,
  /\.gitattributes$/,
  /docker-compose\./,
  /Dockerfile/,
  /Makefile/,
  /\.editorconfig$/,
  /\.prettierrc/,
  /\.eslintrc/,
  /\.husky\//,
  /\.lintstagedrc/,
  /commitlint\.config\./,
];

const LOCKFILE_PATTERNS = [
  /pnpm-lock\.yaml$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /bun\.lockb$/,
  /\.terraform\.lock\.hcl$/,
  /go\.sum$/,
  /Cargo\.lock$/,
  /Gemfile\.lock$/,
  /composer\.lock$/,
  /poetry\.lock$/,
];

const LARGE_FILE_SIZE = 1024 * 1024; // 1MB

export class FileTracker {
  private artifactManager: ArtifactManager | null = null;

  setArtifactManager(am: ArtifactManager): void {
    this.artifactManager = am;
  }

  async takeSnapshot(
    rootPath: string,
    runId: string,
    filePaths: string[],
    label?: string,
  ): Promise<string> {
    const snapDir = getFileSnapshotsDir(rootPath, runId);
    await ensureDir(snapDir);

    const snapshots: FileSnapshot[] = [];

    for (const fp of filePaths) {
      const absPath = path.isAbsolute(fp) ? fp : path.join(rootPath, fp);
      const exists = await fileExists(absPath);

      if (!exists) {
        snapshots.push({
          filePath: fp,
          hash: "",
          size: 0,
          modifiedAt: "",
        });
        continue;
      }

      try {
        const stat = await fs.stat(absPath);
        const content = await readTextFile(absPath);
        const hash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");

        snapshots.push({
          filePath: fp,
          hash,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // skip files that can't be read
        snapshots.push({
          filePath: fp,
          hash: "",
          size: 0,
          modifiedAt: "",
        });
      }
    }

    const snapshotId = label ?? `snap-${Date.now()}`;
    const snapPath = path.join(snapDir, `${snapshotId}.json`);
    await atomicWriteJsonFile(snapPath, { snapshotId, files: snapshots, capturedAt: now() }, true);

    return snapshotId;
  }

  async detectChanges(
    rootPath: string,
    runId: string,
    beforeSnapshotId: string,
    afterSnapshotId?: string,
  ): Promise<FileChange[]> {
    const snapDir = getFileSnapshotsDir(rootPath, runId);

    const beforePath = path.join(snapDir, `${beforeSnapshotId}.json`);
    const beforeExists = await fileExists(beforePath);
    if (!beforeExists) return [];

    const beforeData = await readTextFile(beforePath);
    const before: { files: FileSnapshot[] } = JSON.parse(beforeData);

    let afterFiles: FileSnapshot[];

    if (afterSnapshotId) {
      const afterPath = path.join(snapDir, `${afterSnapshotId}.json`);
      const afterExists = await fileExists(afterPath);
      if (!afterExists) return [];

      const afterData = await readTextFile(afterPath);
      const after: { files: FileSnapshot[] } = JSON.parse(afterData);
      afterFiles = after.files;
    } else {
      // Compare against current state
      afterFiles = [];
      for (const bf of before.files) {
        const absPath = path.isAbsolute(bf.filePath)
          ? bf.filePath
          : path.join(rootPath, bf.filePath);
        const exists = await fileExists(absPath);
        if (!exists) {
          afterFiles.push({ ...bf, hash: "", size: 0, modifiedAt: "" });
          continue;
        }
        try {
          const stat = await fs.stat(absPath);
          const content = await readTextFile(absPath);
          const hash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
          afterFiles.push({
            filePath: bf.filePath,
            hash,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch {
          afterFiles.push({ ...bf, hash: "", size: 0, modifiedAt: "" });
        }
      }
    }

    const beforeMap = new Map(before.files.map((f) => [f.filePath, f]));
    const afterMap = new Map(afterFiles.map((f) => [f.filePath, f]));

    const changes: FileChange[] = [];

    for (const [filePath, afterSnap] of afterMap) {
      const beforeSnap = beforeMap.get(filePath);

      if (!beforeSnap) {
        changes.push(
          await this.makeChange(rootPath, runId, "created", filePath, undefined, afterSnap),
        );
      } else if (!beforeSnap.hash && afterSnap.hash) {
        // Was empty → file created
        changes.push(
          await this.makeChange(rootPath, runId, "created", filePath, undefined, afterSnap),
        );
      } else if (beforeSnap.hash && !afterSnap.hash) {
        // Had content → now missing = deleted
        changes.push(
          await this.makeChange(rootPath, runId, "deleted", filePath, beforeSnap, undefined),
        );
      } else if (beforeSnap.hash !== afterSnap.hash) {
        changes.push(
          await this.makeChange(rootPath, runId, "modified", filePath, beforeSnap, afterSnap),
        );
      }
    }

    return changes;
  }

  async trackChange(
    rootPath: string,
    runId: string,
    change: Omit<FileChange, "changeId" | "detectedAt" | "category">,
  ): Promise<FileChange> {
    const category =
      "category" in change
        ? ((change as { category: string }).category as FileChangeCategory)
        : this.categorizeChange(change.filePath, change.diff, change.newSize);

    const fullChange: FileChange = {
      ...change,
      changeId: generateArtifactId().replace("artifact", "change"),
      category,
      detectedAt: now(),
    };

    const changesDir = getFileChangesDir(rootPath, runId);
    await ensureDir(changesDir);
    const changePath = path.join(changesDir, `${fullChange.changeId}.json`);
    await atomicWriteJsonFile(changePath, fullChange, true);

    return fullChange;
  }

  async getChangesByRun(rootPath: string, runId: string): Promise<FileChange[]> {
    const changesDir = getFileChangesDir(rootPath, runId);
    const exists = await fileExists(changesDir);
    if (!exists) return [];

    const files = await readDir(changesDir);
    const changes: FileChange[] = [];

    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const content = await readTextFile(path.join(changesDir, f));
        changes.push(JSON.parse(content) as FileChange);
      } catch {
        // skip corrupt files
      }
    }

    changes.sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
    return changes;
  }

  async getChangesByStep(rootPath: string, runId: string, stepId: string): Promise<FileChange[]> {
    const all = await this.getChangesByRun(rootPath, runId);
    return all.filter((c) => c.stepId === stepId);
  }

  async getChangesByTask(rootPath: string, runId: string, taskId: string): Promise<FileChange[]> {
    const all = await this.getChangesByRun(rootPath, runId);
    return all.filter((c) => c.taskId === taskId);
  }

  async getDiffSummary(rootPath: string, runId: string): Promise<TrackedChangesSummary> {
    const changes = await this.getChangesByRun(rootPath, runId);

    return {
      total: changes.length,
      created: changes.filter((c) => c.type === "created").length,
      modified: changes.filter((c) => c.type === "modified").length,
      deleted: changes.filter((c) => c.type === "deleted").length,
      renamed: changes.filter((c) => c.type === "renamed").length,
      expected: changes.filter((c) => c.category === "expected").length,
      unexpected: changes.filter((c) => c.category === "unexpected").length,
      sensitive: changes.filter((c) => c.category === "sensitive").length,
      envConfig: changes.filter((c) => c.category === "env_config").length,
      lockfile: changes.filter((c) => c.category === "lockfile").length,
      large: changes.filter((c) => c.category === "large").length,
      empty: changes.filter((c) => c.category === "empty").length,
      unrelated: changes.filter((c) => c.category === "unrelated").length,
    };
  }

  async getFullDiff(rootPath: string, runId: string, changeId: string): Promise<string | null> {
    const changes = await this.getChangesByRun(rootPath, runId);
    const change = changes.find((c) => c.changeId === changeId);
    return change?.diff ?? null;
  }

  categorizeChange(filePath: string, diff?: string, newSize?: number): FileChangeCategory {
    const normalized = filePath.replace(/\\/g, "/");

    if (SENSITIVE_FILE_PATTERNS.some((p) => p.test(normalized))) {
      return "sensitive";
    }

    if (LOCKFILE_PATTERNS.some((p) => p.test(normalized))) {
      return "lockfile";
    }

    if (ENV_CONFIG_PATTERNS.some((p) => p.test(normalized))) {
      return "env_config";
    }

    if (newSize !== undefined && newSize > LARGE_FILE_SIZE) {
      return "large";
    }

    if (!diff || diff.trim().length === 0) {
      return "empty";
    }

    return "expected";
  }

  private async makeChange(
    rootPath: string,
    runId: string,
    type: FileChangeType,
    filePath: string,
    before?: FileSnapshot,
    after?: FileSnapshot,
  ): Promise<FileChange> {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
    let diff: string | undefined;
    let diffStat: string | undefined;

    if (type === "modified" && before?.hash && after?.hash) {
      diff = await this.computeDiff(rootPath, filePath, before);
      diffStat = `${after.size - (before?.size ?? 0)} bytes changed`;
    }

    const category = this.categorizeChange(filePath, diff, after?.size);

    return {
      changeId: generateArtifactId().replace("artifact", "change"),
      runId,
      type,
      filePath,
      category,
      summary: this.makeSummary(type, filePath, before, after),
      diff,
      diffStat,
      oldHash: before?.hash,
      newHash: after?.hash,
      oldSize: before?.size,
      newSize: after?.size,
      detectedAt: now(),
    };
  }

  private async computeDiff(
    rootPath: string,
    filePath: string,
    before: FileSnapshot,
  ): Promise<string | undefined> {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
    try {
      const currentContent = await readTextFile(absPath);
      return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-content hash: ${before.hash}\n+content hash: ${crypto.createHash("sha256").update(currentContent, "utf-8").digest("hex")}\n`;
    } catch {
      return undefined;
    }
  }

  private makeSummary(
    type: FileChangeType,
    filePath: string,
    before?: FileSnapshot,
    after?: FileSnapshot,
  ): string {
    switch (type) {
      case "created":
        return `Created ${filePath} (${after?.size ?? 0} bytes)`;
      case "modified":
        return `Modified ${filePath} (${before?.size ?? 0} → ${after?.size ?? 0} bytes)`;
      case "deleted":
        return `Deleted ${filePath} (was ${before?.size ?? 0} bytes)`;
      case "renamed":
        return `Renamed ${filePath}`;
      default:
        return `${type} ${filePath}`;
    }
  }
}
