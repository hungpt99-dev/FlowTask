import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { expandGlob } from "../utils/glob.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "must",
  "can",
  "could",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "them",
  "this",
  "that",
  "these",
  "those",
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
  "me",
  "him",
  "us",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "for",
  "so",
  "yet",
  "after",
  "before",
  "if",
  "because",
  "while",
  "when",
  "where",
  "how",
  "what",
  "which",
  "who",
  "whom",
  "why",
  "about",
  "into",
  "over",
  "with",
  "out",
  "up",
  "down",
  "off",
  "on",
  "in",
  "at",
  "to",
  "from",
  "by",
  "as",
  "of",
  "than",
  "then",
  "also",
  "just",
  "very",
  "each",
  "any",
  "all",
  "both",
  "few",
  "more",
  "most",
  "some",
  "such",
  "no",
  "only",
  "own",
  "same",
  "so",
  "too",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".scss",
  ".html",
  ".svg",
  ".env",
  ".txt",
  ".cfg",
  ".conf",
]);

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".flowtask",
  ".codegraph",
  ".turbo",
]);

const MAX_FILES_TO_READ = 10;
const MAX_LINES_PER_FILE = 80;
const MAX_TOTAL_CHARS = 25000;

export interface ScannedFile {
  filePath: string;
  relativePath: string;
  lineCount: number;
}

export class ProjectScanner {
  async scan(
    projectRoot: string,
    prompt: string,
  ): Promise<{
    context: string;
    matchedFiles: ScannedFile[];
  }> {
    const keywords = this.extractKeywords(prompt);
    if (keywords.length === 0) {
      return { context: "", matchedFiles: [] };
    }

    const matchedPaths = await this.findFiles(projectRoot, keywords);

    const uniquePaths = [...new Set(matchedPaths)];
    const scannedFiles: ScannedFile[] = [];
    const contents: string[] = [];
    let totalChars = 0;

    for (const filePath of uniquePaths.slice(0, MAX_FILES_TO_READ)) {
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        if (stat.size > 1024 * 500) continue;

        const content = await fs.readFile(filePath, "utf-8");
        const relativePath = path.relative(projectRoot, filePath);
        const lines = content.split("\n");
        const truncatedLines = lines.slice(0, MAX_LINES_PER_FILE);
        const truncated = truncatedLines.join("\n");
        const preview =
          lines.length > MAX_LINES_PER_FILE ? truncated + "\n... (truncated)" : truncated;

        if (totalChars + preview.length > MAX_TOTAL_CHARS) break;

        contents.push(`### ${relativePath}\n\`\`\`\n${preview}\n\`\`\`\n`);
        totalChars += preview.length;
        scannedFiles.push({ filePath, relativePath, lineCount: lines.length });
      } catch {
        // skip unreadable files
      }
    }

    if (scannedFiles.length === 0) {
      return { context: "", matchedFiles: [] };
    }

    const context = [
      "## Project Files Context",
      `The following ${scannedFiles.length} file(s) matched keywords from the prompt (${keywords.join(", ")}):`,
      "",
      ...contents,
    ].join("\n");

    return { context, matchedFiles: scannedFiles };
  }

  private extractKeywords(prompt: string): string[] {
    const words = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

    const unique = [...new Set(words)];
    return unique.slice(0, 15);
  }

  private async findFiles(projectRoot: string, keywords: string[]): Promise<string[]> {
    const nameMatches = await this.findByName(projectRoot, keywords);
    const contentMatches = await this.findByContent(projectRoot, keywords);
    return [...nameMatches, ...contentMatches];
  }

  private async findByName(projectRoot: string, keywords: string[]): Promise<string[]> {
    const matches: string[] = [];

    for (const kw of keywords) {
      const pattern = `**/*${kw}*`;
      const files = await expandGlob(pattern, {
        cwd: projectRoot,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) {
        const rel = path.relative(projectRoot, f);
        const parts = rel.split(path.sep);
        if (parts.some((p) => EXCLUDED_DIRS.has(p))) continue;
        const ext = path.extname(f).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext)) {
          matches.push(f);
        }
      }
    }

    return matches;
  }

  private async findByContent(projectRoot: string, keywords: string[]): Promise<string[]> {
    const patterns = keywords.slice(0, 5);

    for (const pattern of patterns) {
      const results = await this.grepFiles(projectRoot, pattern);
      if (results.length > 0) return results;
    }

    return [];
  }

  private async grepFiles(projectRoot: string, keyword: string): Promise<string[]> {
    return new Promise((resolve) => {
      const child = spawn(
        "rg",
        [
          "-l",
          "-i",
          "--no-ignore-vcs",
          "-g",
          "!node_modules/**",
          "-g",
          "!dist/**",
          "-g",
          "!.git/**",
          "-g",
          "!.flowtask/**",
          "-g",
          "!.codegraph/**",
          "-g",
          "!.turbo/**",
          keyword,
          projectRoot,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 10000,
        },
      );

      const stdout: string[] = [];
      child.stdout?.on("data", (data: Buffer) => stdout.push(data.toString()));

      child.on("close", (code) => {
        if (code !== 0 && code !== 1) {
          resolve([]);
          return;
        }
        const files = stdout.join("").split("\n").filter(Boolean);
        const filtered = files.filter((f) => {
          const ext = path.extname(f).toLowerCase();
          return ALLOWED_EXTENSIONS.has(ext);
        });
        const absolute = filtered.map((f) => path.resolve(projectRoot, f));
        resolve(absolute);
      });

      child.on("error", () => resolve([]));
    });
  }
}
