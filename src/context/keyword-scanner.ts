import { spawn } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import { expandGlob } from "../utils/glob.js";
import { fileExists } from "../utils/fs.js";
import { ScanCache, type ScanCacheOptions } from "./scan-cache.js";

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
  "add",
  "implement",
  "create",
  "make",
  "fix",
  "update",
  "change",
  "remove",
  "delete",
  "refactor",
  "improve",
  "support",
  "need",
  "want",
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
  ".cache",
]);

export interface KeywordMatch {
  filePath: string;
  relativePath: string;
  keyword: string;
  matchedBy: "name" | "content";
}

export interface KeywordScanResult {
  matches: KeywordMatch[];
}

export interface KeywordScannerOptions {
  maxKeywords?: number;
  maxNameMatches?: number;
  maxContentMatches?: number;
  cache?: ScanCacheOptions;
}

export class KeywordScanner {
  private maxKeywords: number;
  private maxNameMatches: number;
  private maxContentMatches: number;
  private cache: ScanCache | null;

  constructor(options?: KeywordScannerOptions) {
    this.maxKeywords = options?.maxKeywords ?? 15;
    this.maxNameMatches = options?.maxNameMatches ?? 20;
    this.maxContentMatches = options?.maxContentMatches ?? 10;
    this.cache = options?.cache ? new ScanCache(options.cache) : null;
  }

  async scan(projectRoot: string, request: string): Promise<KeywordScanResult> {
    const keywords = this.extractKeywords(request);
    if (keywords.length === 0) {
      return { matches: [] };
    }

    const cacheKey = this.cacheKey(projectRoot, request);

    if (this.cache) {
      const gitDeps = await this.gitDeps(projectRoot);
      const cached = await this.cache.get<KeywordMatch[]>(cacheKey, gitDeps);
      if (cached) return { matches: cached };
    }

    const nameMatches = await this.findByName(projectRoot, keywords);
    const contentMatches = await this.findByContent(projectRoot, keywords, nameMatches);

    const matchMap = new Map<string, KeywordMatch>();
    for (const m of nameMatches) {
      const key = m.relativePath;
      if (!matchMap.has(key) || matchMap.get(key)!.matchedBy === "content") {
        matchMap.set(key, m);
      }
    }
    for (const m of contentMatches) {
      const key = m.relativePath;
      if (!matchMap.has(key)) {
        matchMap.set(key, m);
      }
    }

    const matches = [...matchMap.values()];

    if (this.cache) {
      const gitDeps = await this.gitDeps(projectRoot);
      await this.cache.set(cacheKey, matches, gitDeps);
    }

    return { matches };
  }

  private cacheKey(projectRoot: string, request: string): string {
    const hash = crypto.createHash("sha256").update(request).digest("hex").slice(0, 16);
    return `keywords-${hash}`;
  }

  private async gitDeps(projectRoot: string): Promise<string[]> {
    const gitDir = path.join(projectRoot, ".git");
    const deps: string[] = [];
    const head = path.join(gitDir, "HEAD");
    if (await fileExists(head)) deps.push(head);
    const index = path.join(gitDir, "index");
    if (await fileExists(index)) deps.push(index);
    return deps;
  }

  extractKeywords(request: string): string[] {
    const words = request
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

    const unique = [...new Set(words)];
    return unique.slice(0, this.maxKeywords);
  }

  private isExcluded(relativePath: string): boolean {
    const parts = relativePath.split(path.sep);
    return parts.some((p) => EXCLUDED_DIRS.has(p));
  }

  private hasAllowedExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext);
  }

  private async findByName(projectRoot: string, keywords: string[]): Promise<KeywordMatch[]> {
    const matches: KeywordMatch[] = [];

    for (const kw of keywords) {
      if (matches.length >= this.maxNameMatches) break;

      const pattern = `**/*${kw}*`;
      const files = await expandGlob(pattern, {
        cwd: projectRoot,
        absolute: true,
        onlyFiles: true,
      });

      for (const f of files) {
        if (matches.length >= this.maxNameMatches) break;

        const rel = path.relative(projectRoot, f);
        if (this.isExcluded(rel)) continue;
        if (!this.hasAllowedExtension(f)) continue;

        matches.push({
          filePath: f,
          relativePath: rel,
          keyword: kw,
          matchedBy: "name",
        });
      }
    }

    return matches;
  }

  private async findByContent(
    projectRoot: string,
    keywords: string[],
    existingMatches: KeywordMatch[],
  ): Promise<KeywordMatch[]> {
    const matches: KeywordMatch[] = [];
    const existingPaths = new Set(existingMatches.map((m) => m.filePath));

    const searchKeywords = keywords.slice(0, 5);

    for (const kw of searchKeywords) {
      if (matches.length >= this.maxContentMatches) break;

      const results = await this.grepFiles(projectRoot, kw);
      for (const filePath of results) {
        if (matches.length >= this.maxContentMatches) break;
        if (existingPaths.has(filePath)) continue;

        const rel = path.relative(projectRoot, filePath);
        if (this.isExcluded(rel)) continue;
        if (!this.hasAllowedExtension(filePath)) continue;

        existingPaths.add(filePath);
        matches.push({
          filePath,
          relativePath: rel,
          keyword: kw,
          matchedBy: "content",
        });
      }
    }

    return matches;
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
          "-g",
          "!.cache/**",
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
        const filtered = files.filter((f) => this.hasAllowedExtension(f));
        resolve(filtered.map((f) => path.resolve(projectRoot, f)));
      });

      child.on("error", () => resolve([]));
    });
  }

  async findMatchingFiles(projectRoot: string, request: string): Promise<string[]> {
    const result = await this.scan(projectRoot, request);
    return result.matches.map((m) => m.filePath);
  }
}
