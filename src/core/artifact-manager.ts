import path from "node:path";
import { ensureDir, writeTextFile, fileExists } from "../utils/fs.js";
import { getArtifactsDir } from "../utils/paths.js";
import { generateArtifactId } from "../utils/ids.js";
import { now } from "../utils/time.js";

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
    return {
      artifactId: generateArtifactId(),
      runId,
      taskId,
      type: path.extname(fileName).slice(1) || "txt",
      title: fileName,
      path: filePath,
      createdAt: now(),
    };
  }

  async loadArtifact(artifactPath: string): Promise<string | null> {
    const exists = await fileExists(artifactPath);
    if (!exists) return null;
    const fs = await import("node:fs/promises");
    return fs.readFile(artifactPath, "utf-8");
  }
}
