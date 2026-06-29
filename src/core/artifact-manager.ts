import crypto from "node:crypto";
import path from "node:path";
import {
  ensureDir,
  writeTextFile,
  fileExists,
  readTextFile,
  readJsonFile,
  atomicWriteJsonFile,
} from "../utils/fs.js";
import {
  getArtifactsDir,
  getFileChangesDir,
  getFileSnapshotsDir,
  getRunDir,
  getArtifactMetaPath,
} from "../utils/paths.js";
import { generateArtifactId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import type {
  ArtifactRecord,
  ArtifactType,
  ArtifactValidationStatus,
  ArtifactOrigin,
} from "../schemas/artifact.schema.js";
import type { DatabaseManager } from "./database-manager.js";

export interface CreateArtifactOptions {
  runId: string;
  taskId?: string;
  stepId?: string;
  title: string;
  type: ArtifactType;
  content?: string;
  filePath: string;
  summary?: string;
  origin?: ArtifactOrigin;
  diff?: string;
  diffStat?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactFilter {
  runId?: string;
  taskId?: string;
  stepId?: string;
  type?: string;
  origin?: ArtifactOrigin;
  validationStatus?: ArtifactValidationStatus;
}

export class ArtifactManager {
  private db: DatabaseManager | null = null;

  setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  async createArtifact(rootPath: string, options: CreateArtifactOptions): Promise<ArtifactRecord> {
    const artifactId = generateArtifactId();
    const createdAt = now();

    const absPath = path.isAbsolute(options.filePath)
      ? options.filePath
      : path.join(rootPath, options.filePath);

    const artDir = path.dirname(absPath);
    await ensureDir(artDir);

    if (options.content !== undefined) {
      await writeTextFile(absPath, options.content);
    }
    const mimeType = guessMimeType(options.title);
    const fileSize = options.content ? Buffer.byteLength(options.content, "utf-8") : 0;
    const hashSha256 = options.content
      ? crypto.createHash("sha256").update(options.content, "utf-8").digest("hex")
      : undefined;

    const relativePath = path.relative(
      path.join(rootPath, ".flowtask", "runs", options.runId),
      absPath,
    );

    const artifact: ArtifactRecord = {
      artifactId,
      runId: options.runId,
      taskId: options.taskId,
      stepId: options.stepId,
      title: options.title,
      type: options.type,
      path: absPath,
      filePath: relativePath,
      fileSize,
      mimeType,
      hashSha256,
      summary: options.summary,
      origin: options.origin ?? "expected",
      validationStatus: "pending",
      diff: options.diff,
      diffStat: options.diffStat,
      metadata: options.metadata,
      createdAt,
      modifiedAt: createdAt,
    };

    await this.saveArtifactMeta(rootPath, options.runId, artifact);

    if (this.db) {
      try {
        this.db.insertArtifact(artifact);
      } catch {
        // DB is secondary; file is source of truth
      }
    }

    return artifact;
  }

  async createFileArtifact(
    rootPath: string,
    runId: string,
    filePath: string,
    options: {
      taskId?: string;
      stepId?: string;
      type: ArtifactType;
      content?: string;
      title?: string;
      summary?: string;
      origin?: ArtifactOrigin;
      diff?: string;
      diffStat?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ArtifactRecord> {
    const title = options.title ?? path.basename(filePath);
    return this.createArtifact(rootPath, {
      runId,
      taskId: options.taskId,
      stepId: options.stepId,
      title,
      type: options.type,
      content: options.content,
      filePath,
      summary: options.summary,
      origin: options.origin,
      diff: options.diff,
      diffStat: options.diffStat,
      metadata: options.metadata,
    });
  }

  async createReportArtifact(
    rootPath: string,
    runId: string,
    title: string,
    content: string,
    options?: {
      taskId?: string;
      stepId?: string;
      summary?: string;
      origin?: ArtifactOrigin;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ArtifactRecord> {
    const fileName = `report-${title.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}.md`;
    return this.createArtifact(rootPath, {
      runId,
      taskId: options?.taskId,
      stepId: options?.stepId,
      title,
      type: "report",
      content,
      filePath: path.join(getArtifactsDir(rootPath, runId), fileName),
      summary: options?.summary,
      origin: options?.origin,
      metadata: options?.metadata,
    });
  }

  async loadArtifactContent(artifact: ArtifactRecord): Promise<string | null> {
    const exists = await fileExists(artifact.path);
    if (!exists) return null;
    return readTextFile(artifact.path);
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

  getArtifactsByStep(rootPath: string, stepId: string): ArtifactRecord[] {
    if (!this.db) return [];
    try {
      return this.db.getArtifactsByRun("*").filter((a) => a.stepId === stepId);
    } catch {
      return [];
    }
  }

  getArtifactsByRunFiltered(
    rootPath: string,
    runId: string,
    filter?: ArtifactFilter,
  ): ArtifactRecord[] {
    let artifacts = this.getArtifactsByRun(rootPath, runId);

    if (filter) {
      if (filter.taskId) {
        artifacts = artifacts.filter((a) => a.taskId === filter.taskId);
      }
      if (filter.stepId) {
        artifacts = artifacts.filter((a) => a.stepId === filter.stepId);
      }
      if (filter.type) {
        artifacts = artifacts.filter((a) => a.type === filter.type);
      }
      if (filter.origin) {
        artifacts = artifacts.filter((a) => a.origin === filter.origin);
      }
      if (filter.validationStatus) {
        artifacts = artifacts.filter((a) => a.validationStatus === filter.validationStatus);
      }
    }

    return artifacts;
  }

  async updateArtifactValidation(
    rootPath: string,
    artifactId: string,
    status: ArtifactValidationStatus,
  ): Promise<void> {
    if (!this.db) return;
    try {
      const allRunArtifacts = this.db.getArtifactsByRun("*");
      const artifact = allRunArtifacts.find((a) => a.artifactId === artifactId);
      if (!artifact) return;

      this.db.updateArtifact(artifactId, {
        validationStatus: status,
        modifiedAt: now(),
      });
    } catch {
      // ignore
    }
  }

  async updateArtifactDiff(
    rootPath: string,
    artifactId: string,
    diff: string,
    diffStat?: string,
  ): Promise<void> {
    if (!this.db) return;
    try {
      this.db.updateArtifact(artifactId, {
        diff,
        diffStat,
        modifiedAt: now(),
      });
    } catch {
      // ignore
    }
  }

  async getArtifactsSummary(
    rootPath: string,
    runId: string,
  ): Promise<{
    total: number;
    byType: Record<string, number>;
    byOrigin: Record<string, number>;
    byValidation: Record<string, number>;
    expected: number;
    unexpected: number;
  }> {
    const artifacts = this.getArtifactsByRun(rootPath, runId);

    const byType: Record<string, number> = {};
    const byOrigin: Record<string, number> = {};
    const byValidation: Record<string, number> = {};

    for (const a of artifacts) {
      byType[a.type] = (byType[a.type] ?? 0) + 1;
      byOrigin[a.origin] = (byOrigin[a.origin] ?? 0) + 1;
      byValidation[a.validationStatus] = (byValidation[a.validationStatus] ?? 0) + 1;
    }

    return {
      total: artifacts.length,
      byType,
      byOrigin,
      byValidation,
      expected: artifacts.filter((a) => a.origin === "expected").length,
      unexpected: artifacts.filter((a) => a.origin === "unexpected").length,
    };
  }

  async deleteArtifact(rootPath: string, artifactId: string): Promise<boolean> {
    if (!this.db) return false;
    try {
      const artifacts = this.db.getArtifactsByRun("*");
      const artifact = artifacts.find((a) => a.artifactId === artifactId);
      if (!artifact) return false;

      this.db.deleteArtifact(artifactId);

      const metaPath = getArtifactMetaPath(rootPath, artifact.runId, artifactId);
      if (await fileExists(metaPath)) {
        const fs = await import("node:fs/promises");
        await fs.rm(metaPath, { force: true });
      }

      return true;
    } catch {
      return false;
    }
  }

  // ── Legacy compatibility ──────────────────────────

  async saveArtifact(
    rootPath: string,
    runId: string,
    taskId: string,
    fileName: string,
    content: string,
  ): Promise<{
    artifactId: string;
    runId: string;
    taskId?: string;
    type: string;
    title: string;
    path: string;
    createdAt: string;
  }> {
    const extType = path.extname(fileName).slice(1) || "txt";
    const artifact = await this.createArtifact(rootPath, {
      runId,
      taskId,
      title: fileName,
      type: "generated_artifact",
      content,
      filePath: path.join(getArtifactsDir(rootPath, runId), taskId, fileName),
    });

    return {
      artifactId: artifact.artifactId,
      runId: artifact.runId,
      taskId: artifact.taskId,
      type: extType,
      title: artifact.title,
      path: artifact.path,
      createdAt: artifact.createdAt,
    };
  }

  async loadArtifact(artifactPath: string): Promise<string | null> {
    const exists = await fileExists(artifactPath);
    if (!exists) return null;
    return readTextFile(artifactPath);
  }

  private async saveArtifactMeta(
    rootPath: string,
    runId: string,
    artifact: ArtifactRecord,
  ): Promise<void> {
    const metaPath = getArtifactMetaPath(rootPath, runId, artifact.artifactId);
    await atomicWriteJsonFile(metaPath, artifact, true);
  }
}

function guessMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".md": "text/markdown",
    ".json": "application/json",
    ".txt": "text/plain",
    ".patch": "text/x-patch",
    ".diff": "text/x-patch",
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
    ".tsx": "application/typescript",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}
