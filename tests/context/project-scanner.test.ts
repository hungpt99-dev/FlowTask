import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { ProjectScanner, formatMetadata } from "../../src/context/project-scanner.js";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";

const mockSpawn = vi.mocked(spawn);

function mockRgResponse(stdout: string, exitCode = 0) {
  const dataCbs: Array<(d: Buffer) => void> = [];
  const closeCbs: Array<(c: number) => void> = [];

  const child = {
    stdout: {
      on: vi.fn((e: string, h: (chunk: Buffer) => void) => {
        if (e === "data") dataCbs.push(h);
        return child;
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn((e: string, h: (code: number) => void) => {
      if (e === "close") {
        closeCbs.push(h);
        process.nextTick(() => {
          dataCbs.forEach((cb) => cb(Buffer.from(stdout)));
          closeCbs.forEach((cb) => cb(exitCode));
        });
      }
      return child;
    }),
    pid: 12345,
  };

  mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
}

describe("ProjectScanner", () => {
  let scanner: ProjectScanner;
  let testDir: string;

  beforeAll(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "project-scanner-test-"));

    await fs.mkdir(path.join(testDir, "src"), { recursive: true });
    await fs.mkdir(path.join(testDir, "docs"), { recursive: true });
    await fs.mkdir(path.join(testDir, "node_modules", "some-lib"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testDir, ".git"), { recursive: true });
    await fs.mkdir(path.join(testDir, "dist"), { recursive: true });

    await fs.writeFile(
      path.join(testDir, "src", "auth.ts"),
      "export function login() {}\nexport function register() {}\n",
    );
    await fs.writeFile(
      path.join(testDir, "src", "user-service.ts"),
      "export class UserService {}\n",
    );
    await fs.writeFile(
      path.join(testDir, "node_modules", "auth-lib.ts"),
      "export function authCheck() {}\n",
    );
    await fs.writeFile(
      path.join(testDir, "docs", "auth.md"),
      "# Auth Module\nDiscusses authentication flow.\n",
    );
    await fs.writeFile(
      path.join(testDir, "src", "utils.ts"),
      "export function helper() {}\n// authentication helper\n",
    );
    await fs.writeFile(
      path.join(testDir, ".git", "config"),
      "[core]\n\trepositoryformatversion = 0\n",
    );
    await fs.writeFile(path.join(testDir, "dist", "bundle.js"), "// compiled output\n");
    await fs.writeFile(path.join(testDir, "src", "database.ts"), "export class Database {}\n");
  });

  afterAll(async () => {
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new ProjectScanner();
    mockRgResponse("", 1);
  });

  describe("extractKeywords", () => {
    it("should extract meaningful keywords from prompt", () => {
      const keywords = (
        scanner as unknown as { extractKeywords: (s: string) => string[] }
      ).extractKeywords("Implement authentication feature");
      expect(keywords).toContain("implement");
      expect(keywords).toContain("authentication");
      expect(keywords).toContain("feature");
    });

    it("should filter out stop words", () => {
      const keywords = (
        scanner as unknown as { extractKeywords: (s: string) => string[] }
      ).extractKeywords("the and for implement authentication");
      expect(keywords).not.toContain("the");
      expect(keywords).not.toContain("and");
      expect(keywords).not.toContain("for");
      expect(keywords).toContain("implement");
      expect(keywords).toContain("authentication");
    });

    it("should filter out short words (<= 3 chars)", () => {
      const keywords = (
        scanner as unknown as { extractKeywords: (s: string) => string[] }
      ).extractKeywords("a an the cat dog auth");
      expect(keywords).not.toContain("a");
      expect(keywords).not.toContain("cat");
      expect(keywords).not.toContain("dog");
      expect(keywords).toContain("auth");
    });

    it("should lowercase keywords", () => {
      const keywords = (
        scanner as unknown as { extractKeywords: (s: string) => string[] }
      ).extractKeywords("AUTH Login Feature");
      expect(keywords).toContain("auth");
      expect(keywords).toContain("login");
      expect(keywords).toContain("feature");
      expect(keywords).not.toContain("AUTH");
    });

    it("should deduplicate repeated keywords", () => {
      const keywords = (
        scanner as unknown as { extractKeywords: (s: string) => string[] }
      ).extractKeywords("auth auth auth login auth feature");
      const authCount = keywords.filter((k: string) => k === "auth").length;
      expect(authCount).toBe(1);
    });

    it("should limit to at most 15 keywords", () => {
      const prompt = Array.from({ length: 20 }, (_, i) => `keyword${i}`).join(" ");
      const keywords = (
        scanner as unknown as { extractKeywords: (s: string) => string[] }
      ).extractKeywords(prompt);
      expect(keywords.length).toBeLessThanOrEqual(15);
    });

    it("should strip special characters from words", () => {
      const keywords = (
        scanner as unknown as { extractKeywords: (s: string) => string[] }
      ).extractKeywords("auth!!! login??? [feature] (test)");
      expect(keywords).toContain("auth");
      expect(keywords).toContain("login");
      expect(keywords).toContain("feature");
      expect(keywords).toContain("test");
    });

    it("should return empty array when all words are stop/short", () => {
      const keywords = (
        scanner as unknown as { extractKeywords: (s: string) => string[] }
      ).extractKeywords("a an the");
      expect(keywords).toEqual([]);
    });
  });

  describe("scan", () => {
    it("should return empty context for empty prompt", async () => {
      const result = await scanner.scan(testDir, "");
      expect(result.context).toBe("");
      expect(result.matchedFiles).toEqual([]);
    });

    it("should return empty context for prompt with only stop words", async () => {
      const result = await scanner.scan(testDir, "the and for");
      expect(result.context).toBe("");
      expect(result.matchedFiles).toEqual([]);
    });

    it("should return empty context when no files match", async () => {
      const result = await scanner.scan(testDir, "nonexistentkeyword");
      expect(result.context).toBe("");
      expect(result.matchedFiles).toEqual([]);
    });

    it("should find files by name matching keywords", async () => {
      const result = await scanner.scan(testDir, "auth");
      expect(result.matchedFiles.length).toBeGreaterThan(0);
      const authFile = result.matchedFiles.find((f) => f.relativePath.endsWith("auth.ts"));
      expect(authFile).toBeDefined();
      expect(authFile!.relativePath).toBe("src/auth.ts");
      expect(authFile!.lineCount).toBeGreaterThan(0);
      expect(result.context).toContain("src/auth.ts");
      expect(result.context).toContain("login");
    });

    it("should find files by content via rg when name does not match", async () => {
      mockRgResponse("src/utils.ts\n", 0);

      const result = await scanner.scan(testDir, "helper");
      const utilsFile = result.matchedFiles.find((f) => f.relativePath.endsWith("utils.ts"));
      expect(utilsFile).toBeDefined();
      expect(result.context).toContain("src/utils.ts");
    });

    it("should exclude files in excluded directories", async () => {
      const result = await scanner.scan(testDir, "auth");
      const excludedFiles = result.matchedFiles.filter(
        (f) =>
          f.relativePath.startsWith("node_modules") ||
          f.relativePath.startsWith(".git") ||
          f.relativePath.startsWith("dist"),
      );
      expect(excludedFiles).toEqual([]);
    });

    it("should include files with allowed extensions only", async () => {
      const binPath = path.join(testDir, "src", "auth.bin");
      await fs.writeFile(binPath, "binary content");
      try {
        const result = await scanner.scan(testDir, "auth");
        const binFile = result.matchedFiles.find((f) => f.relativePath.endsWith(".bin"));
        expect(binFile).toBeUndefined();

        const tsFile = result.matchedFiles.find((f) => f.relativePath.endsWith("auth.ts"));
        expect(tsFile).toBeDefined();
      } finally {
        await fs.unlink(binPath).catch(() => {});
      }
    });

    it("should limit number of files read to MAX_FILES_TO_READ (10)", async () => {
      for (let i = 0; i < 15; i++) {
        await fs.writeFile(path.join(testDir, "src", `mod${i}.ts`), `// module ${i}\n`);
      }

      try {
        const result = await scanner.scan(testDir, "mod");
        expect(result.matchedFiles.length).toBeLessThanOrEqual(10);
      } finally {
        for (let i = 0; i < 15; i++) {
          await fs.unlink(path.join(testDir, "src", `mod${i}.ts`)).catch(() => {});
        }
      }
    });

    it("should truncate files exceeding MAX_LINES_PER_FILE (80)", async () => {
      const longPath = path.join(testDir, "src", "long-file.ts");
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
      await fs.writeFile(longPath, lines.join("\n"));

      try {
        mockRgResponse("", 1);
        const result = await scanner.scan(testDir, "long-file");
        expect(result.matchedFiles.length).toBeGreaterThan(0);

        const context = result.context;
        expect(context).toContain("... (truncated)");
        expect(context).not.toContain("line 100");
      } finally {
        await fs.unlink(longPath).catch(() => {});
      }
    });

    it("should skip files larger than 500KB", async () => {
      const largePath = path.join(testDir, "src", "large-file.ts");
      const largeContent = "x".repeat(600 * 1024);
      await fs.writeFile(largePath, largeContent);

      try {
        mockRgResponse("", 1);
        const result = await scanner.scan(testDir, "large-file");
        const largeFile = result.matchedFiles.find((f) => f.relativePath.endsWith("large-file.ts"));
        expect(largeFile).toBeUndefined();
      } finally {
        await fs.unlink(largePath).catch(() => {});
      }
    });

    it("should return context in expected format with file previews", async () => {
      const result = await scanner.scan(testDir, "user-service");
      expect(result.context).toContain("## Project Files Context");
      expect(result.context).toContain("user");
      expect(result.context).toContain("src/user-service.ts");
      expect(result.context).toContain("```");
      expect(result.context).toContain("UserService");
    });

    it("should skip unreadable files", async () => {
      const unreadablePath = path.join(testDir, "src", "restricted.ts");
      await fs.writeFile(unreadablePath, "content");
      await fs.chmod(unreadablePath, 0o000);

      try {
        mockRgResponse("", 1);
        const result = await scanner.scan(testDir, "restricted");
        const found = result.matchedFiles.find((f) => f.relativePath.endsWith("restricted.ts"));
        expect(found).toBeUndefined();
      } finally {
        await fs.chmod(unreadablePath, 0o644).catch(() => {});
        await fs.unlink(unreadablePath).catch(() => {});
      }
    });
  });

  describe("scanMetadata", () => {
    let metaDir: string;

    beforeAll(async () => {
      metaDir = mkdtempSync(path.join(tmpdir(), "flowtask-metadata-test-"));

      await fs.writeFile(
        path.join(metaDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          version: "1.0.0",
          main: "dist/index.js",
          module: "dist/index.mjs",
          bin: { "test-project": "dist/cli.js" },
          scripts: {
            build: "tsup",
            test: "vitest run",
            lint: "eslint .",
            dev: "tsx src/index.ts",
          },
          dependencies: {
            react: "^18.0.0",
            express: "^4.0.0",
            zod: "^3.0.0",
          },
          devDependencies: {
            vitest: "^2.0.0",
            typescript: "^5.0.0",
            prettier: "^3.0.0",
          },
        }),
      );

      await fs.writeFile(
        path.join(metaDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true } }),
      );

      await fs.writeFile(path.join(metaDir, ".gitignore"), "node_modules\ndist\n");

      await fs.writeFile(path.join(metaDir, "README.md"), "# Test Project\n");

      await fs.writeFile(path.join(metaDir, "CONTRIBUTING.md"), "# Contributing\n");

      await fs.mkdir(path.join(metaDir, "src"), { recursive: true });
      await fs.writeFile(path.join(metaDir, "src", "index.ts"), "export const main = () => {};\n");
      await fs.writeFile(
        path.join(metaDir, "src", "app.tsx"),
        "export function App() { return null; }\n",
      );

      await fs.mkdir(path.join(metaDir, "docs"), { recursive: true });
      await fs.writeFile(path.join(metaDir, "docs", "guide.md"), "# Guide\n");

      await fs.mkdir(path.join(metaDir, "tests"), { recursive: true });
      await fs.writeFile(
        path.join(metaDir, "tests", "index.test.ts"),
        "import { test } from 'vitest';\n",
      );

      await fs.mkdir(path.join(metaDir, ".flowtask"), { recursive: true });
      await fs.writeFile(
        path.join(metaDir, ".flowtask", "config.json"),
        JSON.stringify({ planner: { mode: "auto" } }),
      );

      await fs.mkdir(path.join(metaDir, ".git"), { recursive: true });
      await fs.writeFile(path.join(metaDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      await fs.mkdir(path.join(metaDir, "node_modules"), { recursive: true });
      await fs.mkdir(path.join(metaDir, "dist"), { recursive: true });
    });

    afterAll(async () => {
      rmSync(metaDir, { recursive: true, force: true });
    });

    it("should detect project name from package.json", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.name).toBe("test-project");
    });

    it("should detect project type as mixed when code and docs both exist", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.type).toBe("mixed");
    });

    it("should detect mixed type when docs are present", async () => {
      const mixedDir = mkdtempSync(path.join(tmpdir(), "flowtask-mixed-test-"));
      try {
        await fs.writeFile(
          path.join(mixedDir, "package.json"),
          JSON.stringify({ name: "mixed", dependencies: { react: "^18.0.0" } }),
        );
        await fs.mkdir(path.join(mixedDir, "src"), { recursive: true });
        await fs.writeFile(path.join(mixedDir, "src", "index.ts"), "// code\n");
        await fs.mkdir(path.join(mixedDir, "docs"), { recursive: true });
        await fs.writeFile(path.join(mixedDir, "docs", "readme.md"), "# Docs\n");
        await fs.writeFile(path.join(mixedDir, "README.md"), "# Readme\n");

        const meta = await scanner.scanMetadata(mixedDir);
        expect(meta.type).toBe("mixed");
      } finally {
        rmSync(mixedDir, { recursive: true, force: true });
      }
    });

    it("should detect package manager", async () => {
      // No lock file, but package.json has no packageManager field either
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.packageManager).toBeNull();

      const pnpmDir = mkdtempSync(path.join(tmpdir(), "flowtask-pnpm-test-"));
      try {
        await fs.writeFile(
          path.join(pnpmDir, "package.json"),
          JSON.stringify({ name: "pnpm-test" }),
        );
        await fs.writeFile(path.join(pnpmDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'");

        const pnpmMeta = await scanner.scanMetadata(pnpmDir);
        expect(pnpmMeta.packageManager).toBe("pnpm");
      } finally {
        rmSync(pnpmDir, { recursive: true, force: true });
      }
    });

    it("should detect languages", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.languages).toContain("typescript");
      expect(meta.languages).toContain("tsx");
    });

    it("should detect frameworks from dependencies", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.frameworks).toContain("react");
      expect(meta.frameworks).toContain("express");
    });

    it("should detect test framework", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.testFramework).toBe("vitest");
    });

    it("should detect scripts", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.scripts).toContain("build");
      expect(meta.scripts).toContain("test");
      expect(meta.scripts).toContain("lint");
      expect(meta.scripts).toContain("dev");
    });

    it("should detect important folders", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.importantFolders).toContain("src");
      expect(meta.importantFolders).toContain("docs");
      expect(meta.importantFolders).toContain("tests");
    });

    it("should detect config files", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.configFiles).toContain("tsconfig.json");
      expect(meta.configFiles).toContain(".gitignore");
    });

    it("should detect docs", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.docs).toContain("README.md");
      expect(meta.docs).toContain("CONTRIBUTING.md");
      expect(meta.docs).toContain("docs/");
    });

    it("should detect entry points from package.json", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.entryPoints).toContain("dist/index.js");
      expect(meta.entryPoints).toContain("dist/index.mjs");
      expect(meta.entryPoints).toContain("dist/cli.js");
    });

    it("should count dependencies", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.dependencies).toBe(3);
      expect(meta.devDependencies).toBe(3);
    });

    it("should detect that tests exist", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.hasTests).toBe(true);
    });

    it("should detect build tool from scripts", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.buildTool).toBe("tsup");
    });

    it("should detect git branch", async () => {
      const meta = await scanner.scanMetadata(metaDir);
      expect(meta.gitBranch).toBe("main");
    });

    it("should return empty metadata for empty directory", async () => {
      const emptyDir = mkdtempSync(path.join(tmpdir(), "flowtask-empty-test-"));
      try {
        const meta = await scanner.scanMetadata(emptyDir);
        expect(meta.name).toBe(path.basename(emptyDir));
        expect(meta.type).toBe("mixed");
        expect(meta.packageManager).toBeNull();
        expect(meta.languages).toEqual([]);
        expect(meta.frameworks).toEqual([]);
        expect(meta.scripts).toEqual([]);
        expect(meta.dependencies).toBe(0);
        expect(meta.devDependencies).toBe(0);
        expect(meta.hasTests).toBe(false);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it("should detect docs-only project type", async () => {
      const docsDir = mkdtempSync(path.join(tmpdir(), "flowtask-docs-test-"));
      try {
        await fs.writeFile(path.join(docsDir, "README.md"), "# Docs\n");
        await fs.mkdir(path.join(docsDir, "docs"), { recursive: true });
        await fs.writeFile(path.join(docsDir, "docs", "guide.md"), "# Guide\n");

        const meta = await scanner.scanMetadata(docsDir);
        expect(meta.type).toBe("docs");
      } finally {
        rmSync(docsDir, { recursive: true, force: true });
      }
    });
  });

  describe("formatMetadata", () => {
    it("should format metadata as compact string", () => {
      const meta = {
        name: "test-project",
        type: "code" as const,
        packageManager: "pnpm",
        buildTool: "tsup",
        languages: ["typescript", "javascript"],
        frameworks: ["react"],
        testFramework: "vitest",
        scripts: ["build", "test"],
        importantFolders: ["src", "tests"],
        configFiles: ["tsconfig.json", ".eslintrc"],
        docs: ["README.md"],
        entryPoints: ["dist/index.js"],
        dependencies: 5,
        devDependencies: 3,
        hasTests: true,
        gitBranch: "main",
        gitHasChanges: false,
      };

      const formatted = formatMetadata(meta);
      expect(formatted).toContain("Project: test-project");
      expect(formatted).toContain("Type: code");
      expect(formatted).toContain("Package Manager: pnpm");
      expect(formatted).toContain("Build Tool: tsup");
      expect(formatted).toContain("Languages: typescript, javascript");
      expect(formatted).toContain("Frameworks: react");
      expect(formatted).toContain("Test Framework: vitest");
      expect(formatted).toContain("Scripts: build, test");
      expect(formatted).toContain("Folders: src, tests");
      expect(formatted).toContain("Config Files: tsconfig.json, .eslintrc");
      expect(formatted).toContain("Docs: README.md");
      expect(formatted).toContain("Entry Points: dist/index.js");
      expect(formatted).toContain("Dependencies: 5 (dev: 3)");
      expect(formatted).toContain("Tests: yes");
      expect(formatted).toContain("Git Branch: main");
      expect(formatted).toContain("Git Changes: no");
    });

    it("should handle null/empty fields", () => {
      const meta = {
        name: "empty",
        type: "mixed" as const,
        packageManager: null,
        buildTool: null,
        languages: [],
        frameworks: [],
        testFramework: null,
        scripts: [],
        importantFolders: [],
        configFiles: [],
        docs: [],
        entryPoints: [],
        dependencies: 0,
        devDependencies: 0,
        hasTests: false,
        gitBranch: null,
        gitHasChanges: false,
      };

      const formatted = formatMetadata(meta);
      expect(formatted).toContain("Package Manager: none");
      expect(formatted).toContain("Languages: none");
      expect(formatted).toContain("Tests: no");
      expect(formatted).toContain("Git Branch: none");
    });
  });
});
