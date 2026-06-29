import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { KeywordScanner } from "../../src/context/keyword-scanner.js";
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

describe("KeywordScanner", () => {
  let scanner: KeywordScanner;
  let testDir: string;

  beforeAll(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "keyword-scanner-test-"));

    await fs.mkdir(path.join(testDir, "src"), { recursive: true });
    await fs.mkdir(path.join(testDir, "docs"), { recursive: true });
    await fs.mkdir(path.join(testDir, "node_modules", "some-lib"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testDir, ".git"), { recursive: true });
    await fs.mkdir(path.join(testDir, "dist"), { recursive: true });
    await fs.mkdir(path.join(testDir, ".flowtask"), { recursive: true });

    await fs.writeFile(
      path.join(testDir, "src", "auth.ts"),
      "export function login() {}\nexport function register() {}\n",
    );
    await fs.writeFile(
      path.join(testDir, "src", "user-service.ts"),
      "export class UserService {}\n",
    );
    await fs.writeFile(path.join(testDir, "src", "database.ts"), "export class Database {}\n");
    await fs.writeFile(
      path.join(testDir, "src", "utils.ts"),
      "export function helper() {}\n// authentication helper\n",
    );
    await fs.writeFile(
      path.join(testDir, "docs", "auth.md"),
      "# Auth Module\nDiscusses authentication flow.\n",
    );
    await fs.writeFile(
      path.join(testDir, "node_modules", "auth-lib.ts"),
      "export function authCheck() {}\n",
    );
    await fs.writeFile(path.join(testDir, "dist", "bundle.js"), "// compiled output\n");
    await fs.writeFile(path.join(testDir, ".flowtask", "config.json"), "{}");
    await fs.writeFile(path.join(testDir, "src", "README.md"), "# Project Docs\n");
    await fs.writeFile(path.join(testDir, "README.md"), "# FlowTask\nA task runner.\n");
    await fs.writeFile(path.join(testDir, "src", "index.ts"), 'export { Auth } from "./auth";\n');
  });

  afterAll(async () => {
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new KeywordScanner();
    mockRgResponse("", 1);
  });

  describe("extractKeywords", () => {
    it("should extract meaningful keywords from prompt", () => {
      const keywords = scanner.extractKeywords("Implement authentication feature");
      expect(keywords).toContain("authentication");
      expect(keywords).toContain("feature");
    });

    it("should filter out stop words", () => {
      const keywords = scanner.extractKeywords("the and for authentication");
      expect(keywords).not.toContain("the");
      expect(keywords).not.toContain("and");
      expect(keywords).not.toContain("for");
      expect(keywords).toContain("authentication");
    });

    it("should filter out short words (<= 3 chars)", () => {
      const keywords = scanner.extractKeywords("a an the cat dog auth");
      expect(keywords).not.toContain("a");
      expect(keywords).not.toContain("cat");
      expect(keywords).toContain("auth");
    });

    it("should lowercase keywords", () => {
      const keywords = scanner.extractKeywords("AUTH Login Feature");
      expect(keywords).toContain("auth");
      expect(keywords).toContain("login");
      expect(keywords).toContain("feature");
      expect(keywords).not.toContain("AUTH");
    });

    it("should deduplicate repeated keywords", () => {
      const keywords = scanner.extractKeywords("auth auth auth login auth feature");
      const authCount = keywords.filter((k) => k === "auth").length;
      expect(authCount).toBe(1);
    });

    it("should limit to at most configured maxKeywords (15)", () => {
      const prompt = Array.from({ length: 20 }, (_, i) => `keyword${i}`).join(" ");
      const keywords = scanner.extractKeywords(prompt);
      expect(keywords.length).toBeLessThanOrEqual(15);
    });

    it("should strip special characters from words", () => {
      const keywords = scanner.extractKeywords("auth!!! login??? [feature] (test)");
      expect(keywords).toContain("auth");
      expect(keywords).toContain("login");
      expect(keywords).toContain("feature");
      expect(keywords).toContain("test");
    });

    it("should return empty array when all words are stop/short", () => {
      const keywords = scanner.extractKeywords("a an the");
      expect(keywords).toEqual([]);
    });

    it("should return empty array for empty string", () => {
      const keywords = scanner.extractKeywords("");
      expect(keywords).toEqual([]);
    });

    it("should respect maxKeywords option", () => {
      const limited = new KeywordScanner({ maxKeywords: 3 });
      const keywords = limited.extractKeywords("auth login database service utils helper");
      expect(keywords.length).toBeLessThanOrEqual(3);
    });
  });

  describe("scan", () => {
    it("should return empty matches for empty request", async () => {
      const result = await scanner.scan(testDir, "");
      expect(result.matches).toEqual([]);
    });

    it("should return empty matches for request with only stop words", async () => {
      const result = await scanner.scan(testDir, "the and for");
      expect(result.matches).toEqual([]);
    });

    it("should return empty matches when no files match", async () => {
      const result = await scanner.scan(testDir, "nonexistentkeyword");
      expect(result.matches).toEqual([]);
    });

    it("should find files by name matching keywords", async () => {
      const result = await scanner.scan(testDir, "auth");
      expect(result.matches.length).toBeGreaterThan(0);
      const authFile = result.matches.find((m) => m.relativePath.endsWith("auth.ts"));
      expect(authFile).toBeDefined();
      expect(authFile!.relativePath).toBe("src/auth.ts");
      expect(authFile!.keyword).toBe("auth");
      expect(authFile!.matchedBy).toBe("name");
    });

    it("should exclude files in excluded directories", async () => {
      const result = await scanner.scan(testDir, "auth");
      const excluded = result.matches.filter(
        (m) =>
          m.relativePath.startsWith("node_modules") ||
          m.relativePath.startsWith(".git") ||
          m.relativePath.startsWith("dist") ||
          m.relativePath.startsWith(".flowtask"),
      );
      expect(excluded).toEqual([]);
    });

    it("should include files with allowed extensions only", async () => {
      const binPath = path.join(testDir, "src", "auth.bin");
      await fs.writeFile(binPath, "binary content");
      try {
        const result = await scanner.scan(testDir, "auth");
        const binFile = result.matches.find((m) => m.relativePath.endsWith(".bin"));
        expect(binFile).toBeUndefined();

        const tsFile = result.matches.find((m) => m.relativePath.endsWith("auth.ts"));
        expect(tsFile).toBeDefined();
      } finally {
        await fs.unlink(binPath).catch(() => {});
      }
    });

    it("should include md and json files", async () => {
      const result = await scanner.scan(testDir, "auth");
      const mdFile = result.matches.find((m) => m.relativePath.endsWith("auth.md"));
      expect(mdFile).toBeDefined();
      expect(mdFile!.relativePath).toBe("docs/auth.md");
    });

    it("should find files by content via rg when name does not match", async () => {
      mockRgResponse("src/utils.ts\n", 0);

      const result = await scanner.scan(testDir, "helper");
      const utilsMatch = result.matches.find((m) => m.relativePath.endsWith("utils.ts"));
      expect(utilsMatch).toBeDefined();
      expect(utilsMatch!.matchedBy).toBe("content");
    });

    it("should not duplicate files found by both name and content", async () => {
      mockRgResponse("src/auth.ts\n", 0);

      const result = await scanner.scan(testDir, "auth");
      const authMatches = result.matches.filter((m) => m.relativePath.endsWith("auth.ts"));
      expect(authMatches.length).toBe(1);
      expect(authMatches[0]!.matchedBy).toBe("name");
    });

    it("should return deduplicated paths", async () => {
      const result = await scanner.scan(testDir, "auth");
      const paths = result.matches.map((m) => m.relativePath);
      expect(new Set(paths).size).toBe(paths.length);
    });

    it("should return matches in relative path format", async () => {
      const result = await scanner.scan(testDir, "user-service");
      expect(result.matches.length).toBeGreaterThan(0);
      for (const match of result.matches) {
        expect(match.filePath).toBeTruthy();
        expect(match.relativePath).toBeTruthy();
        expect(match.relativePath).not.toContain(testDir);
        expect(match.keyword).toBeTruthy();
        expect(["name", "content"]).toContain(match.matchedBy);
      }
    });

    it("should find multiple files matching different keywords", async () => {
      const result = await scanner.scan(testDir, "auth database");
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
      const paths = result.matches.map((m) => m.relativePath);
      expect(paths.some((p) => p.includes("auth"))).toBe(true);
      expect(paths.some((p) => p.includes("database"))).toBe(true);
    });

    it("should respect maxNameMatches option", async () => {
      const limited = new KeywordScanner({ maxNameMatches: 1 });
      const result = await limited.scan(testDir, "auth");
      expect(result.matches.length).toBeLessThanOrEqual(1);
    });
  });

  describe("findMatchingFiles", () => {
    it("should return an array of absolute file paths", async () => {
      const files = await scanner.findMatchingFiles(testDir, "auth");
      expect(Array.isArray(files)).toBe(true);
      for (const f of files) {
        expect(path.isAbsolute(f)).toBe(true);
      }
    });

    it("should return empty array when no matches", async () => {
      const files = await scanner.findMatchingFiles(testDir, "zzzznonexistent");
      expect(files).toEqual([]);
    });

    it("should return correct file paths", async () => {
      const files = await scanner.findMatchingFiles(testDir, "user-service");
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.endsWith("user-service.ts"))).toBe(true);
    });
  });
});
