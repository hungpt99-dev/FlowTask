import path from "node:path";
import { spawn } from "node:child_process";
import { fileExists } from "../utils/fs.js";
import { ScanCache, type ScanCacheOptions } from "./scan-cache.js";

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitStatus {
  branch: string | null;
  hasChanges: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  recentCommits: GitCommit[];
  ahead: number;
  behind: number;
}

export function formatGitStatus(status: GitStatus): string {
  const lines: string[] = [];
  lines.push(`Branch: ${status.branch ?? "detached"}`);
  lines.push(`Changes: ${status.hasChanges ? "yes" : "no"}`);
  lines.push(`Staged: ${status.staged}`);
  lines.push(`Unstaged: ${status.unstaged}`);
  lines.push(`Untracked: ${status.untracked}`);
  lines.push(`Ahead: ${status.ahead}  Behind: ${status.behind}`);
  if (status.recentCommits.length > 0) {
    lines.push("Recent commits:");
    for (const c of status.recentCommits) {
      lines.push(`  ${c.hash.slice(0, 8)} ${c.subject} (${c.author})`);
    }
  }
  return lines.join("\n");
}

export interface GitScannerOptions {
  cache?: ScanCacheOptions;
}

export class GitScanner {
  private cache: ScanCache | null;

  constructor(options?: GitScannerOptions) {
    this.cache = options?.cache ? new ScanCache(options.cache) : null;
  }

  async scan(projectRoot: string): Promise<GitStatus> {
    const gitDir = path.join(projectRoot, ".git");
    if (!(await fileExists(gitDir))) {
      return emptyStatus();
    }

    const cacheKey = "git-status";
    const deps = [path.join(gitDir, "HEAD"), path.join(gitDir, "index")];

    if (this.cache) {
      const cached = await this.cache.get<GitStatus>(cacheKey, deps);
      if (cached) return cached;
    }

    const branch = await this.getBranch(projectRoot);
    const { staged, unstaged, untracked, hasChanges } = await this.getChanges(projectRoot);
    const recentCommits = await this.getRecentCommits(projectRoot);
    const { ahead, behind } = await this.getAheadBehind(projectRoot);

    const status: GitStatus = {
      branch,
      hasChanges,
      staged,
      unstaged,
      untracked,
      recentCommits,
      ahead,
      behind,
    };

    if (this.cache) {
      await this.cache.set(cacheKey, status, deps);
    }

    return status;
  }

  private async getBranch(projectRoot: string): Promise<string | null> {
    const out = await this.runGit(projectRoot, ["symbolic-ref", "--short", "HEAD"]);
    if (out !== null) return out.trim();
    const fallback = await this.runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (fallback === null) return null;
    const trimmed = fallback.trim();
    return trimmed === "HEAD" ? null : trimmed;
  }

  private async getChanges(
    projectRoot: string,
  ): Promise<{ staged: number; unstaged: number; untracked: number; hasChanges: boolean }> {
    const out = await this.runGit(projectRoot, ["status", "--porcelain"]);
    if (out === null) return { staged: 0, unstaged: 0, untracked: 0, hasChanges: false };

    const lines = out.split("\n").filter((l) => l.length > 0);
    let staged = 0;
    let unstaged = 0;
    let untracked = 0;

    for (const line of lines) {
      if (line.startsWith("??")) {
        untracked++;
      } else {
        const first = line[0]!;
        const second = line[1]!;
        if (first !== " " && first !== "?") staged++;
        if (second !== " " && second !== "?") unstaged++;
      }
    }

    return { staged, unstaged, untracked, hasChanges: lines.length > 0 };
  }

  private async getRecentCommits(projectRoot: string, count = 5): Promise<GitCommit[]> {
    const out = await this.runGit(projectRoot, [
      "log",
      `--max-count=${count}`,
      "--format=%H|%s|%an|%aI",
    ]);
    if (out === null || out.trim() === "") return [];

    return out
      .trim()
      .split("\n")
      .map((line) => {
        const parts = line.split("|");
        return {
          hash: parts[0] ?? "",
          subject: parts[1] ?? "",
          author: parts[2] ?? "",
          date: parts[3] ?? "",
        };
      })
      .filter((c) => c.hash.length > 0);
  }

  private async getAheadBehind(projectRoot: string): Promise<{ ahead: number; behind: number }> {
    const out = await this.runGit(projectRoot, [
      "rev-list",
      "--count",
      "--left-right",
      "@{upstream}...HEAD",
    ]);
    if (out === null) return { ahead: 0, behind: 0 };

    const parts = out.trim().split("\t");
    if (parts.length !== 2) return { ahead: 0, behind: 0 };

    const behind = Number.parseInt(parts[0] ?? "0", 10);
    const ahead = Number.parseInt(parts[1] ?? "0", 10);
    return { ahead: Number.isNaN(ahead) ? 0 : ahead, behind: Number.isNaN(behind) ? 0 : behind };
  }

  private runGit(projectRoot: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn("git", args, {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10000,
      });

      let stdout = "";
      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }
        resolve(stdout);
      });

      child.on("error", () => {
        resolve(null);
      });
    });
  }
}

function emptyStatus(): GitStatus {
  return {
    branch: null,
    hasChanges: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    recentCommits: [],
    ahead: 0,
    behind: 0,
  };
}
