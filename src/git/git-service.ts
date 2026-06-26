import path from "node:path";
import { spawnWithPromise } from "../utils/process.js";
import { writeTextFile, ensureDir } from "../utils/fs.js";
import { gitBeforePath, gitAfterPath, gitDiffStatPath, getOutputsDir } from "../utils/paths.js";

export interface GitSnapshot {
  status: string;
  branch: string;
  diffStat: string;
}

export class GitService {
  async getBranch(cwd: string): Promise<string> {
    try {
      const result = await spawnWithPromise("git", ["branch", "--show-current"], { cwd });
      return result.stdout.trim();
    } catch {
      return "unknown";
    }
  }

  async getStatus(cwd: string): Promise<string> {
    try {
      const result = await spawnWithPromise("git", ["status", "--porcelain"], { cwd });
      return result.stdout.trim();
    } catch {
      return "";
    }
  }

  async getDiffStat(cwd: string): Promise<string> {
    try {
      const result = await spawnWithPromise("git", ["diff", "--stat"], { cwd });
      return result.stdout.trim();
    } catch {
      return "";
    }
  }

  async snapshot(cwd: string): Promise<GitSnapshot> {
    const [branch, status, diffStat] = await Promise.all([
      this.getBranch(cwd),
      this.getStatus(cwd),
      this.getDiffStat(cwd),
    ]);
    return { branch, status, diffStat };
  }

  async takeBeforeSnapshot(rootPath: string, runId: string): Promise<void> {
    const outputsDir = getOutputsDir(rootPath, runId);
    await ensureDir(outputsDir);
    const snap = await this.snapshot(rootPath);
    await writeTextFile(gitBeforePath(rootPath, runId), `Branch: ${snap.branch}\n\n${snap.status}`);
    const gitBeforeDir = path.dirname(gitBeforePath(rootPath, runId));
    const diffStatPath = path.join(gitBeforeDir, "git-before-diff-stat.txt");
    await writeTextFile(diffStatPath, snap.diffStat);
  }

  async takeAfterSnapshot(rootPath: string, runId: string): Promise<void> {
    const outputsDir = getOutputsDir(rootPath, runId);
    await ensureDir(outputsDir);
    const status = await this.getStatus(rootPath);
    const diffStat = await this.getDiffStat(rootPath);
    await writeTextFile(gitAfterPath(rootPath, runId), status);
    await writeTextFile(gitDiffStatPath(rootPath, runId), diffStat);
  }

  async isRepo(cwd: string): Promise<boolean> {
    try {
      const result = await spawnWithPromise("git", ["rev-parse", "--git-dir"], { cwd });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
