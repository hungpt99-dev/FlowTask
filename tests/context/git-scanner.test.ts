import { describe, it, expect, beforeAll } from "vitest";
import { GitScanner, formatGitStatus, type GitStatus } from "../../src/context/git-scanner.js";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

function spawnGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`git ${args.join(" ")} failed: ${stderr}`));
      else resolve(stdout);
    });
    child.on("error", reject);
  });
}

async function setupRepo(dir: string): Promise<void> {
  await spawnGit(["init"], dir);
  await spawnGit(["config", "user.email", "test@test.com"], dir);
  await spawnGit(["config", "user.name", "Test User"], dir);
}

async function commit(dir: string, message: string): Promise<void> {
  await spawnGit(["add", "."], dir);
  await spawnGit(["commit", "-m", message], dir);
}

describe("GitScanner", () => {
  let scanner: GitScanner;

  beforeAll(() => {
    scanner = new GitScanner();
  });

  describe("scan", () => {
    it("should return empty status when no .git directory exists", async () => {
      const emptyDir = mkdtempSync(path.join(tmpdir(), "git-scanner-no-git-"));
      try {
        const status = await scanner.scan(emptyDir);
        expect(status.branch).toBeNull();
        expect(status.hasChanges).toBe(false);
        expect(status.staged).toBe(0);
        expect(status.unstaged).toBe(0);
        expect(status.untracked).toBe(0);
        expect(status.recentCommits).toEqual([]);
        expect(status.ahead).toBe(0);
        expect(status.behind).toBe(0);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it("should detect current branch and no changes in clean repo", async () => {
      const repoDir = mkdtempSync(path.join(tmpdir(), "git-scanner-clean-"));
      try {
        await setupRepo(repoDir);
        await fs.writeFile(path.join(repoDir, "readme.md"), "# Test\n");
        await commit(repoDir, "initial commit");

        const status = await scanner.scan(repoDir);
        expect(status.branch).toBeTruthy();
        expect(status.hasChanges).toBe(false);
        expect(status.staged).toBe(0);
        expect(status.unstaged).toBe(0);
        expect(status.untracked).toBe(0);
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it("should detect branch name correctly", async () => {
      const repoDir = mkdtempSync(path.join(tmpdir(), "git-scanner-branch-"));
      try {
        await setupRepo(repoDir);
        await fs.writeFile(path.join(repoDir, "readme.md"), "# Test\n");
        await commit(repoDir, "initial");
        await spawnGit(["checkout", "-b", "feature/test-branch"], repoDir);

        const status = await scanner.scan(repoDir);
        expect(status.branch).toBe("feature/test-branch");
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it("should detect untracked files", async () => {
      const repoDir = mkdtempSync(path.join(tmpdir(), "git-scanner-untracked-"));
      try {
        await setupRepo(repoDir);
        await fs.writeFile(path.join(repoDir, "readme.md"), "# Test\n");
        await commit(repoDir, "initial");
        await fs.writeFile(path.join(repoDir, "new-file.ts"), "const x = 1;\n");

        const status = await scanner.scan(repoDir);
        expect(status.hasChanges).toBe(true);
        expect(status.untracked).toBe(1);
        expect(status.staged).toBe(0);
        expect(status.unstaged).toBe(0);
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it("should detect unstaged changes", async () => {
      const repoDir = mkdtempSync(path.join(tmpdir(), "git-scanner-unstaged-"));
      try {
        await setupRepo(repoDir);
        await fs.writeFile(path.join(repoDir, "file.ts"), "const x = 1;\n");
        await commit(repoDir, "initial");
        await fs.writeFile(path.join(repoDir, "file.ts"), "const x = 2;\n");

        const status = await scanner.scan(repoDir);
        expect(status.hasChanges).toBe(true);
        expect(status.unstaged).toBe(1);
        expect(status.staged).toBe(0);
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it("should detect staged changes", async () => {
      const repoDir = mkdtempSync(path.join(tmpdir(), "git-scanner-staged-"));
      try {
        await setupRepo(repoDir);
        await fs.writeFile(path.join(repoDir, "file.ts"), "const x = 1;\n");
        await commit(repoDir, "initial");
        await fs.writeFile(path.join(repoDir, "file.ts"), "const x = 2;\n");
        await spawnGit(["add", "file.ts"], repoDir);

        const status = await scanner.scan(repoDir);
        expect(status.hasChanges).toBe(true);
        expect(status.staged).toBe(1);
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it("should detect multiple changes simultaneously", async () => {
      const repoDir = mkdtempSync(path.join(tmpdir(), "git-scanner-multi-"));
      try {
        await setupRepo(repoDir);
        await fs.writeFile(path.join(repoDir, "a.ts"), "// a\n");
        await fs.writeFile(path.join(repoDir, "b.ts"), "// b\n");
        await commit(repoDir, "initial");

        await fs.writeFile(path.join(repoDir, "a.ts"), "// a modified\n");
        await spawnGit(["add", "a.ts"], repoDir);
        await fs.writeFile(path.join(repoDir, "b.ts"), "// b modified\n");
        await fs.writeFile(path.join(repoDir, "c.ts"), "// c new\n");

        const status = await scanner.scan(repoDir);
        expect(status.staged).toBe(1);
        expect(status.unstaged).toBe(1);
        expect(status.untracked).toBe(1);
        expect(status.hasChanges).toBe(true);
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it("should return recent commits", async () => {
      const repoDir = mkdtempSync(path.join(tmpdir(), "git-scanner-commits-"));
      try {
        await setupRepo(repoDir);

        for (let i = 1; i <= 3; i++) {
          await fs.writeFile(path.join(repoDir, `file${i}.ts`), `// file ${i}\n`);
          await commit(repoDir, `commit ${i}`);
        }

        const status = await scanner.scan(repoDir);
        expect(status.recentCommits.length).toBe(3);
        expect(status.recentCommits[0]!.subject).toBe("commit 3");
        expect(status.recentCommits[2]!.subject).toBe("commit 1");
        status.recentCommits.forEach((c) => {
          expect(c.hash).toMatch(/^[0-9a-f]{40}$/);
          expect(c.author).toBe("Test User");
          expect(c.date).toBeTruthy();
        });
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it("should handle fresh repo with no commits", async () => {
      const repoDir = mkdtempSync(path.join(tmpdir(), "git-scanner-fresh-"));
      try {
        await setupRepo(repoDir);

        const status = await scanner.scan(repoDir);
        expect(status.branch).toBeTruthy();
        expect(status.hasChanges).toBe(false);
        expect(status.recentCommits).toEqual([]);
        expect(status.staged).toBe(0);
        expect(status.untracked).toBe(0);
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it("should handle detached HEAD state", async () => {
      const repoDir = mkdtempSync(path.join(tmpdir(), "git-scanner-detached-"));
      try {
        await setupRepo(repoDir);
        await fs.writeFile(path.join(repoDir, "file.ts"), "content\n");
        await commit(repoDir, "initial");
        const log = await spawnGit(["log", "--format=%H", "-1"], repoDir);
        const hash = log.trim();
        await spawnGit(["checkout", hash], repoDir);

        const status = await scanner.scan(repoDir);
        expect(status.branch).toBeNull();
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });
  });

  describe("formatGitStatus", () => {
    it("should format status with changes", () => {
      const status: GitStatus = {
        branch: "main",
        hasChanges: true,
        staged: 2,
        unstaged: 1,
        untracked: 3,
        recentCommits: [
          {
            hash: "abc123def456abc123def456abc123def456abc1",
            subject: "fix bug",
            author: "Alice",
            date: "2024-01-01",
          },
          {
            hash: "def789abc123def789abc123def789abc123def7",
            subject: "add feature",
            author: "Bob",
            date: "2024-01-02",
          },
        ],
        ahead: 1,
        behind: 0,
      };

      const formatted = formatGitStatus(status);
      expect(formatted).toContain("Branch: main");
      expect(formatted).toContain("Changes: yes");
      expect(formatted).toContain("Staged: 2");
      expect(formatted).toContain("Unstaged: 1");
      expect(formatted).toContain("Untracked: 3");
      expect(formatted).toContain("Ahead: 1  Behind: 0");
      expect(formatted).toContain("abc123de fix bug (Alice)");
      expect(formatted).toContain("Recent commits:");
    });

    it("should format status with no changes", () => {
      const status: GitStatus = {
        branch: "master",
        hasChanges: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        recentCommits: [],
        ahead: 0,
        behind: 0,
      };

      const formatted = formatGitStatus(status);
      expect(formatted).toContain("Branch: master");
      expect(formatted).toContain("Changes: no");
      expect(formatted).not.toContain("Recent commits:");
    });

    it("should handle null branch (detached HEAD)", () => {
      const status: GitStatus = {
        branch: null,
        hasChanges: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        recentCommits: [],
        ahead: 0,
        behind: 0,
      };

      const formatted = formatGitStatus(status);
      expect(formatted).toContain("Branch: detached");
    });
  });
});
