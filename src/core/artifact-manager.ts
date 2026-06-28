import crypto from "node:crypto";
import path from "node:path";
import { ensureDir, writeTextFile, fileExists, readTextFile } from "../utils/fs.js";
import { getArtifactsDir } from "../utils/paths.js";
import { generateArtifactId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import type { ArtifactRecord } from "../schemas/artifact.schema.js";
import type { DatabaseManager } from "./database-manager.js";

export interface Artifact {
  artifactId: string;
  runId: string;
  taskId?: string;
  type: string;
  title: string;
  path: string;
  createdAt: string;
}

export class ArtifactManager {
  private db: DatabaseManager | null = null;

  setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  async saveArtifact(
    rootPath: string,
    runId: string,
    taskId: string,
    fileName: string,
    content: string,
  ): Promise<Artifact> {
    const dir = path.join(getArtifactsDir(rootPath, runId), taskId);
    await ensureDir(dir);
    const filePath = path.join(dir, fileName);
    await writeTextFile(filePath, content);

    const artifactId = generateArtifactId();
    const createdAt = now();
    const contentBuf = Buffer.from(content, "utf-8");
    const fileSize = contentBuf.byteLength;
    const hashSha256 = crypto.createHash("sha256").update(contentBuf).digest("hex");

    const artifact: Artifact = {
      artifactId,
      runId,
      taskId,
      type: path.extname(fileName).slice(1) || "txt",
      title: fileName,
      path: filePath,
      createdAt,
    };

    if (this.db) {
      try {
        const record: ArtifactRecord = {
          artifactId,
          runId,
          taskId,
          title: fileName,
          type: path.extname(fileName).slice(1) || "txt",
          filePath: path.relative(path.join(rootPath, ".flowtask", "runs", runId), filePath),
          fileSize,
          mimeType: guessMimeType(fileName),
          hashSha256,
          createdAt,
        };
        this.db.insertArtifact(record);
      } catch {
        // DB is secondary; file is source of truth
      }
    }

    return artifact;
  }

  async loadArtifact(artifactPath: string): Promise<string | null> {
    const exists = await fileExists(artifactPath);
    if (!exists) return null;
    return readTextFile(artifactPath);
  }

  getArtifactsByRun(rootPath: string, runId: string): ArtifactRecord[] {
    if (!this.db) return [];
    try {
      return this.db.getArtifactsByRun(runId);
    } catch {
      return [];
    }
  }

  getArtifactsByTask(rootPath: string, taskId: string): ArtifactRecord[] {
    if (!this.db) return [];
    try {
      return this.db.getArtifactsByTask(taskId);
    } catch {
      return [];
    }
  }
}

function guessMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".md": "text/markdown",
    ".json": "application/json",
    ".txt": "text/plain",
    ".patch": "text/x-patch",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "application/typescript",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}
