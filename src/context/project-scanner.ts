import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { expandGlob } from "../utils/glob.js";
import { fileExists, readTextFile } from "../utils/fs.js";
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

export interface ProjectMetadata {
  name: string;
  type: "code" | "docs" | "research" | "mixed";
  packageManager: string | null;
  buildTool: string | null;
  languages: string[];
  frameworks: string[];
  testFramework: string | null;
  scripts: string[];
  importantFolders: string[];
  configFiles: string[];
  docs: string[];
  entryPoints: string[];
  dependencies: number;
  devDependencies: number;
  hasTests: boolean;
  gitBranch: string | null;
  gitHasChanges: boolean;
}

export function formatMetadata(meta: ProjectMetadata): string {
  const lines: string[] = [];
  lines.push(`Project: ${meta.name}`);
  lines.push(`Type: ${meta.type}`);
  lines.push(`Package Manager: ${meta.packageManager ?? "none"}`);
  lines.push(`Build Tool: ${meta.buildTool ?? "none"}`);
  lines.push(`Languages: ${meta.languages.join(", ") || "none"}`);
  lines.push(`Frameworks: ${meta.frameworks.join(", ") || "none"}`);
  lines.push(`Test Framework: ${meta.testFramework ?? "none"}`);
  lines.push(`Scripts: ${meta.scripts.join(", ") || "none"}`);
  lines.push(`Entry Points: ${meta.entryPoints.join(", ") || "none"}`);
  lines.push(`Folders: ${meta.importantFolders.join(", ") || "none"}`);
  lines.push(`Config Files: ${meta.configFiles.join(", ") || "none"}`);
  lines.push(`Docs: ${meta.docs.join(", ") || "none"}`);
  lines.push(`Dependencies: ${meta.dependencies} (dev: ${meta.devDependencies})`);
  lines.push(`Tests: ${meta.hasTests ? "yes" : "no"}`);
  lines.push(`Git Branch: ${meta.gitBranch ?? "none"}`);
  lines.push(`Git Changes: ${meta.gitHasChanges ? "yes" : "no"}`);
  return lines.join("\n");
}

export interface ProjectScannerOptions {
  cache?: ScanCacheOptions;
}

export class ProjectScanner {
  private cache: ScanCache | null;

  constructor(options?: ProjectScannerOptions) {
    this.cache = options?.cache ? new ScanCache(options.cache) : null;
  }

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

  async scanMetadata(projectRoot: string): Promise<ProjectMetadata> {
    const cacheKey = "project-metadata";
    const deps = await this.metadataDeps(projectRoot);

    if (this.cache) {
      const cached = await this.cache.get<ProjectMetadata>(cacheKey, deps);
      if (cached) return cached;
    }

    const pkgJson = await this.readPackageJson(projectRoot);
    const name = typeof pkgJson?.name === "string" ? pkgJson.name : path.basename(projectRoot);
    const pm = await this.detectPackageManager(projectRoot);
    const languages = await this.detectLanguages(projectRoot);
    const frameworks = this.detectFrameworks(pkgJson);
    const testFramework = this.detectTestFramework(pkgJson);
    const rawScripts = pkgJson?.scripts as Record<string, string> | undefined;
    const scripts = rawScripts ? Object.keys(rawScripts) : [];
    const importantFolders = await this.findImportantFolders(projectRoot);
    const configFiles = await this.findConfigFiles(projectRoot);
    const docs = await this.findDocs(projectRoot);
    const entryPoints = this.findEntryPoints(pkgJson);
    const rawDeps = pkgJson?.dependencies as Record<string, string> | undefined;
    const rawDevDeps = pkgJson?.devDependencies as Record<string, string> | undefined;
    const depsCount = rawDeps ? Object.keys(rawDeps).length : 0;
    const devDepsCount = rawDevDeps ? Object.keys(rawDevDeps).length : 0;
    const hasTests = await this.detectTests(projectRoot, scripts);
    const { branch, hasChanges } = await this.scanGit(projectRoot);
    const buildTool = this.detectBuildTool(pkgJson, configFiles);
    const type = this.detectProjectType(languages, importantFolders, pkgJson, docs);

    const meta: ProjectMetadata = {
      name,
      type,
      packageManager: pm,
      buildTool,
      languages,
      frameworks,
      testFramework,
      scripts,
      importantFolders,
      configFiles,
      docs,
      entryPoints,
      dependencies: depsCount,
      devDependencies: devDepsCount,
      hasTests,
      gitBranch: branch,
      gitHasChanges: hasChanges,
    };

    if (this.cache) {
      await this.cache.set(cacheKey, meta, deps);
    }

    return meta;
  }

  private async metadataDeps(projectRoot: string): Promise<string[]> {
    const deps: string[] = [];
    const candidates = [
      "package.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "package-lock.json",
      "bun.lockb",
      "bun.lock",
      "tsconfig.json",
      "jsconfig.json",
      ".gitignore",
      ".editorconfig",
      "Makefile",
      "turbo.json",
    ];
    for (const c of candidates) {
      const p = path.join(projectRoot, c);
      if (await fileExists(p)) deps.push(p);
    }
    const gitHead = path.join(projectRoot, ".git", "HEAD");
    if (await fileExists(gitHead)) deps.push(gitHead);
    return deps;
  }

  private async readPackageJson(projectRoot: string): Promise<Record<string, unknown> | null> {
    try {
      const pkgPath = path.join(projectRoot, "package.json");
      if (!(await fileExists(pkgPath))) return null;
      return JSON.parse(await readTextFile(pkgPath)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async detectPackageManager(projectRoot: string): Promise<string | null> {
    const markers: [string, string][] = [
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
      ["package-lock.json", "npm"],
      ["bun.lockb", "bun"],
      ["bun.lock", "bun"],
    ];
    for (const [file, name] of markers) {
      if (await fileExists(path.join(projectRoot, file))) return name;
    }
    const pkg = await this.readPackageJson(projectRoot);
    if (pkg?.packageManager && typeof pkg.packageManager === "string") {
      return pkg.packageManager.split("@")[0] ?? null;
    }
    return null;
  }

  private async detectLanguages(projectRoot: string): Promise<string[]> {
    const languages: string[] = [];
    const hasTs = await fileExists(path.join(projectRoot, "tsconfig.json"));
    if (hasTs) languages.push("typescript");
    if (await this.hasFilesWithExt(projectRoot, ".js")) languages.push("javascript");
    if (await this.hasFilesWithExt(projectRoot, ".jsx")) languages.push("jsx");
    if (await this.hasFilesWithExt(projectRoot, ".tsx")) languages.push("tsx");
    if (await this.hasFilesWithExt(projectRoot, ".py")) languages.push("python");
    if (await this.hasFilesWithExt(projectRoot, ".go")) languages.push("go");
    if (await this.hasFilesWithExt(projectRoot, ".rs")) languages.push("rust");
    if (await this.hasFilesWithExt(projectRoot, ".rb")) languages.push("ruby");
    if (await this.hasFilesWithExt(projectRoot, ".java")) languages.push("java");
    if (await this.hasFilesWithExt(projectRoot, ".md")) {
      if (!languages.includes("typescript") && !languages.includes("javascript")) {
        languages.push("markdown");
      }
    }
    return languages;
  }

  private async hasFilesWithExt(projectRoot: string, ext: string): Promise<boolean> {
    const files = await expandGlob(`**/*${ext}`, {
      cwd: projectRoot,
      absolute: false,
      onlyFiles: true,
    });
    if (files.length === 0) return false;
    const excluded = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
    return files.some((f) => {
      const parts = f.split(path.sep);
      return !parts.some((p) => excluded.has(p));
    });
  }

  private detectFrameworks(pkgJson: Record<string, unknown> | null): string[] {
    if (!pkgJson) return [];
    const frameworks: string[] = [];
    const all = {
      ...(pkgJson.dependencies as Record<string, string> | undefined),
      ...(pkgJson.devDependencies as Record<string, string> | undefined),
    };
    if (!all) return frameworks;
    const deps = new Set(Object.keys(all));
    if (deps.has("react") || deps.has("preact")) frameworks.push("react");
    if (deps.has("vue") || deps.has("nuxt")) frameworks.push("vue");
    if (deps.has("next")) frameworks.push("next.js");
    if (deps.has("express")) frameworks.push("express");
    if (deps.has("fastify")) frameworks.push("fastify");
    if (deps.has("svelte") || deps.has("sveltekit")) frameworks.push("svelte");
    if (deps.has("astro")) frameworks.push("astro");
    if (deps.has("@angular/core")) frameworks.push("angular");
    if (deps.has("solid-js")) frameworks.push("solid");
    if (deps.has("hono")) frameworks.push("hono");
    if (deps.has("nestjs") || deps.has("@nestjs/core")) frameworks.push("nestjs");
    if (deps.has("electron")) frameworks.push("electron");
    if (deps.has("prisma")) frameworks.push("prisma");
    if (deps.has("drizzle-orm")) frameworks.push("drizzle");
    if (deps.has("tailwindcss")) frameworks.push("tailwindcss");
    if (deps.has("commander") || deps.has("yargs")) frameworks.push("cli");
    return frameworks;
  }

  private detectTestFramework(pkgJson: Record<string, unknown> | null): string | null {
    if (!pkgJson) return null;
    const scripts = pkgJson.scripts as Record<string, string> | undefined;
    if (scripts) {
      for (const [, val] of Object.entries(scripts)) {
        if (val.includes("vitest")) return "vitest";
        if (val.includes("jest")) return "jest";
        if (val.includes("mocha")) return "mocha";
        if (val.includes("ava")) return "ava";
        if (val.includes("playwright")) return "playwright";
        if (val.includes("cypress")) return "cypress";
        if (val.includes("pytest")) return "pytest";
        if (val.includes("go test")) return "go-test";
      }
    }
    const allDeps = {
      ...(pkgJson.dependencies as Record<string, string> | undefined),
      ...(pkgJson.devDependencies as Record<string, string> | undefined),
    };
    if (allDeps) {
      if (allDeps.vitest) return "vitest";
      if (allDeps.jest) return "jest";
      if (allDeps.mocha) return "mocha";
      if (allDeps.playwright) return "playwright";
      if (allDeps.cypress) return "cypress";
    }
    return null;
  }

  private async findImportantFolders(projectRoot: string): Promise<string[]> {
    const folders: string[] = [];
    const candidates = [
      "src",
      "lib",
      "app",
      "components",
      "pages",
      "api",
      "docs",
      "tests",
      "spec",
      "test",
      "__tests__",
      "e2e",
      "scripts",
      "config",
      "public",
      "assets",
      "utils",
      "helpers",
      "services",
      "hooks",
      "stores",
    ];
    for (const dir of candidates) {
      if (await fileExists(path.join(projectRoot, dir))) {
        folders.push(dir);
      }
    }
    return folders.sort();
  }

  private async findConfigFiles(projectRoot: string): Promise<string[]> {
    const patterns = [
      "tsconfig.json",
      "jsconfig.json",
      ".eslintrc*",
      ".prettierrc*",
      "prettier.config.*",
      ".editorconfig",
      ".env*",
      ".gitignore",
      "Dockerfile*",
      "docker-compose*",
      ".github/**",
      ".gitlab-ci.yml",
      "Makefile",
      "turbo.json",
      "nx.json",
      "lerna.json",
      "jest.config.*",
      "vitest.config.*",
      "playwright.config.*",
      "cypress.config.*",
      "vite.config.*",
      "next.config.*",
      "webpack.config.*",
      "rollup.config.*",
      "esbuild.config.*",
      "tailwind.config.*",
      "postcss.config.*",
      "babel.config.*",
      ".babelrc*",
      "commitlint.config.*",
      "lint-staged.config.*",
      ".husky/**",
      ".flowtask/**",
      ".cursor/**",
      ".vscode/**",
      ".idea/**",
      "biome.json*",
      ".buckconfig*",
      "rust-toolchain*",
      "Cargo.toml",
      "Cargo.lock",
      "Gemfile",
      "Gemfile.lock",
      "go.mod",
      "go.sum",
      "composer.json",
      "composer.lock",
    ];
    const found: string[] = [];
    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files) {
        if (!found.includes(f)) found.push(f);
      }
    }
    return found.sort();
  }

  private async findDocs(projectRoot: string): Promise<string[]> {
    const docs: string[] = [];
    const readmePatterns = ["README*", "readme*", "CONTRIBUTING*", "CHANGELOG*", "LICENSE*"];
    for (const pattern of readmePatterns) {
      const files = await expandGlob(pattern, {
        cwd: projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files) {
        if (!docs.includes(f)) docs.push(f);
      }
    }
    const docDir = path.join(projectRoot, "docs");
    if (await fileExists(docDir)) {
      docs.push("docs/");
    }
    return docs.sort();
  }

  private findEntryPoints(pkgJson: Record<string, unknown> | null): string[] {
    if (!pkgJson) return [];
    const entries: string[] = [];
    const main = pkgJson.main as string | undefined;
    const module = pkgJson.module as string | undefined;
    const browser = pkgJson.browser as string | undefined;
    const exports_ = pkgJson.exports as Record<string, unknown> | string | undefined;
    const bin = pkgJson.bin as Record<string, string> | string | undefined;
    if (main) entries.push(main);
    if (module) entries.push(module);
    if (browser) entries.push(browser);
    if (bin) {
      if (typeof bin === "string") entries.push(bin);
      else entries.push(...Object.values(bin));
    }
    if (exports_) {
      if (typeof exports_ === "string") entries.push(exports_);
    }
    return entries;
  }

  private detectBuildTool(
    pkgJson: Record<string, unknown> | null,
    configFiles: string[],
  ): string | null {
    if (!pkgJson) return null;
    const scripts = pkgJson.scripts as Record<string, string> | undefined;
    const allScripts = scripts ? Object.values(scripts).join(" ") : "";
    if (allScripts.includes("tsup")) return "tsup";
    if (allScripts.includes("tsc")) return "tsc";
    if (allScripts.includes("vite")) return "vite";
    if (allScripts.includes("webpack")) return "webpack";
    if (allScripts.includes("rollup")) return "rollup";
    if (allScripts.includes("esbuild")) return "esbuild";
    if (allScripts.includes("turbo")) return "turbo";
    if (allScripts.includes("nx")) return "nx";
    if (configFiles.some((f) => f.startsWith("vite.config"))) return "vite";
    if (configFiles.some((f) => f.startsWith("webpack.config"))) return "webpack";
    if (configFiles.some((f) => f.startsWith("rollup.config"))) return "rollup";
    if (configFiles.some((f) => f.startsWith("tsup"))) return "tsup";
    return null;
  }

  private detectProjectType(
    languages: string[],
    folders: string[],
    pkgJson: Record<string, unknown> | null,
    docs: string[],
  ): ProjectMetadata["type"] {
    const codeLangs = [
      "typescript",
      "javascript",
      "python",
      "go",
      "rust",
      "ruby",
      "java",
      "tsx",
      "jsx",
    ];
    const hasCodeLangs = languages.some((l) => codeLangs.includes(l));
    const hasSrc = folders.includes("src") || folders.includes("lib") || folders.includes("app");
    const hasPkg = pkgJson !== null;
    const hasDocFiles = docs.length > 0;
    const hasDocDir = docs.includes("docs/");
    if ((hasCodeLangs && hasSrc) || hasPkg) {
      if (hasDocDir || hasDocFiles) return "mixed";
      return "code";
    }
    if (hasDocDir || hasDocFiles) {
      return "docs";
    }
    return "mixed";
  }

  private async detectTests(projectRoot: string, scripts: string[]): Promise<boolean> {
    const scriptCmds = scripts
      .map((s) => s.toLowerCase())
      .filter(
        (s) => s === "test" || s.startsWith("test:") || s.startsWith("check") || s === "quality",
      );
    if (scriptCmds.length > 0) return true;
    const testDirs = ["tests", "spec", "test", "__tests__", "e2e"];
    for (const dir of testDirs) {
      if (await fileExists(path.join(projectRoot, dir))) return true;
    }
    const configs = ["vitest.config", "jest.config", "playwright.config", "cypress.config"];
    for (const cfg of configs) {
      const files = await expandGlob(`${cfg}.*`, {
        cwd: projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      if (files.length > 0) return true;
    }
    return false;
  }

  private async scanGit(
    projectRoot: string,
  ): Promise<{ branch: string | null; hasChanges: boolean }> {
    const gitDir = path.join(projectRoot, ".git");
    if (!(await fileExists(gitDir))) return { branch: null, hasChanges: false };
    try {
      const headPath = path.join(gitDir, "HEAD");
      if (!(await fileExists(headPath))) return { branch: null, hasChanges: false };
      const headContent = await readTextFile(headPath);
      const refMatch = headContent.match(/ref: refs\/heads\/(.+)/);
      const branch = refMatch ? refMatch[1]!.trim() : null;
      return { branch, hasChanges: false };
    } catch {
      return { branch: null, hasChanges: false };
    }
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
