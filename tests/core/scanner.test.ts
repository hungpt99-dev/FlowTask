import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  WorkspaceScanner,
  FileType,
  detectFileType,
  computeChecksum,
  estimateTokens,
  formatCompactContext,
  countLines,
  extractKeywords,
  type CompactContext,
  type ScanItem,
} from "../../src/core/scanner.js";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "scanner-test-"));
}

async function writeFile(dir: string, relPath: string, content: string): Promise<void> {
  const full = path.join(dir, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

describe("WorkspaceScanner", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = createTempDir();

    await writeFile(testDir, "src/index.ts", `export function hello() { return "world"; }\n`);
    await writeFile(
      testDir,
      "src/utils.ts",
      `export function add(a: number, b: number) { return a + b; }\n`,
    );
    await writeFile(testDir, "src/app.tsx", `export function App() { return <div>Hello</div>; }\n`);
    await writeFile(testDir, "README.md", "# Test Project\nThis is a test project.\n");
    await writeFile(testDir, "docs/guide.md", "# Guide\nStep by step guide.\n");
    await writeFile(testDir, "config.json", JSON.stringify({ key: "value", nested: { a: 1 } }));
    await writeFile(testDir, "config.yaml", "key: value\nnested:\n  a: 1\n");
    await writeFile(testDir, "data.csv", "name,age\nAlice,30\nBob,25\n");
    await writeFile(testDir, "notes.txt", "Some random notes for testing.\n");
    await writeFile(testDir, ".env", "SECRET=key\nAPI_URL=http://example.com\n");
    await writeFile(testDir, ".gitignore", "node_modules\ndist\n");
    await writeFile(
      testDir,
      "package.json",
      JSON.stringify({ name: "test-project", version: "1.0.0" }),
    );
    await writeFile(testDir, "large-file.ts", "x".repeat(2_000_000));
    await writeFile(testDir, "binary-file.bin", "binary content");
    await writeFile(testDir, "data.xml", '<root><item id="1">value</item></root>');
    await writeFile(
      testDir,
      "output.log",
      "[INFO] Starting...\n[ERROR] Something failed\n[INFO] Done\n",
    );

    await fs.mkdir(path.join(testDir, "node_modules"), { recursive: true });
    await writeFile(testDir, "node_modules/lodash/index.ts", `export function clone() {}\n`);
    await writeFile(testDir, "node_modules/express/index.ts", `export function serve() {}\n`);

    await fs.mkdir(path.join(testDir, ".git"), { recursive: true });
    await writeFile(testDir, ".git/HEAD", "ref: refs/heads/main\n");

    await fs.mkdir(path.join(testDir, "dist"), { recursive: true });
    await writeFile(testDir, "dist/bundle.js", "// compiled\n");

    await fs.mkdir(path.join(testDir, "coverage"), { recursive: true });
    await writeFile(testDir, "coverage/lcov.info", "SF:src/index.ts\n");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("constructor and configuration", () => {
    it("should create scanner with default config", () => {
      const scanner = new WorkspaceScanner();
      expect(scanner).toBeInstanceOf(WorkspaceScanner);
    });

    it("should create scanner with custom config", () => {
      const scanner = new WorkspaceScanner({
        maxFileSize: 1024,
        maxFilesPerType: 5,
        maxTotalFiles: 10,
        maxTotalChars: 10000,
      });
      expect(scanner).toBeInstanceOf(WorkspaceScanner);
    });
  });

  describe("basic scanning", () => {
    it("should return a CompactContext with correct structure", async () => {
      const scanner = new WorkspaceScanner({
        maxFilesPerType: 100,
        maxTotalFiles: 200,
        useCache: false,
      });
      const result = await scanner.scan(testDir);

      expect(result).toHaveProperty("items");
      expect(result).toHaveProperty("summary");
      expect(result).toHaveProperty("tokenEstimate");
      expect(result).toHaveProperty("totalFiles");
      expect(result).toHaveProperty("totalSize");
      expect(result).toHaveProperty("scannedAt");
      expect(result).toHaveProperty("categories");
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.summary).toBe("string");
      expect(typeof result.tokenEstimate).toBe("number");
    });

    it("should include files from diverse types", async () => {
      const scanner = new WorkspaceScanner({
        maxFilesPerType: 100,
        maxTotalFiles: 200,
        useCache: false,
      });
      const result = await scanner.scan(testDir);

      const types = new Set(result.items.map((i) => i.type));
      expect(types.has(FileType.CODE)).toBe(true);
      expect(types.has(FileType.MARKDOWN)).toBe(true);
      expect(types.has(FileType.JSON)).toBe(true);
      expect(types.has(FileType.YAML)).toBe(true);
      expect(types.has(FileType.CSV)).toBe(true);
      expect(types.has(FileType.DOCUMENT)).toBe(true);
      expect(types.has(FileType.CONFIG)).toBe(true);
      expect(types.has(FileType.XML)).toBe(true);
      expect(types.has(FileType.LOG)).toBe(true);
    });
  });

  describe("excluded file handling", () => {
    it("should exclude node_modules files", async () => {
      const scanner = new WorkspaceScanner({ useCache: false });
      const result = await scanner.scan(testDir);
      const nodeModulesFiles = result.items.filter((i) =>
        i.relativePath.startsWith("node_modules"),
      );
      expect(nodeModulesFiles).toEqual([]);
    });

    it("should exclude .git directory files", async () => {
      const scanner = new WorkspaceScanner({ useCache: false });
      const result = await scanner.scan(testDir);
      const gitDirFiles = result.items.filter((i) => i.relativePath.startsWith(".git/"));
      expect(gitDirFiles).toEqual([]);
    });

    it("should exclude dist directory files", async () => {
      const scanner = new WorkspaceScanner({ useCache: false });
      const result = await scanner.scan(testDir);
      const distFiles = result.items.filter((i) => i.relativePath.startsWith("dist"));
      expect(distFiles).toEqual([]);
    });

    it("should exclude coverage directory files", async () => {
      const scanner = new WorkspaceScanner({ useCache: false });
      const result = await scanner.scan(testDir);
      const coverageFiles = result.items.filter((i) => i.relativePath.startsWith("coverage"));
      expect(coverageFiles).toEqual([]);
    });
  });

  describe("file size limits", () => {
    it("should skip files exceeding maxFileSize", async () => {
      const scanner = new WorkspaceScanner({
        maxFileSize: 1024,
        useCache: false,
      });
      const result = await scanner.scan(testDir);
      const largeFiles = result.items.filter((i) => i.size > 1024);
      expect(largeFiles).toEqual([]);
    });
  });

  describe("per-type limits", () => {
    it("should limit files per type to maxFilesPerType", async () => {
      const scanner = new WorkspaceScanner({
        maxFilesPerType: 2,
        useCache: false,
      });
      const result = await scanner.scan(testDir);
      const codeFiles = result.items.filter((i) => i.type === FileType.CODE);
      expect(codeFiles.length).toBeLessThanOrEqual(2);
    });
  });

  describe("total file limits", () => {
    it("should limit total scanned files to maxTotalFiles", async () => {
      const scanner = new WorkspaceScanner({
        maxTotalFiles: 3,
        useCache: false,
      });
      const result = await scanner.scan(testDir);
      expect(result.items.length).toBeLessThanOrEqual(3);
    });
  });

  describe("incremental scanning", () => {
    it("should detect new files as added", async () => {
      const scanner = new WorkspaceScanner({
        maxFilesPerType: 100,
        maxTotalFiles: 200,
        useCache: false,
      });

      const newFileDir = createTempDir();
      try {
        await writeFile(newFileDir, "src/index.ts", "// original\n");
        const baseResult = await scanner.scan(newFileDir);
        await writeFile(newFileDir, "src/new-file.ts", "// new\n");
        const incResult = await scanner.scanIncremental(newFileDir, baseResult);
        expect(incResult.added).toBeGreaterThanOrEqual(1);
        expect(incResult.changes.some((c) => c.relativePath === "src/new-file.ts")).toBe(true);
      } finally {
        rmSync(newFileDir, { recursive: true, force: true });
      }
    });

    it("should detect modified files", async () => {
      const scanner = new WorkspaceScanner({
        maxFilesPerType: 100,
        maxTotalFiles: 200,
        useCache: false,
      });
      const modDir = createTempDir();
      try {
        await writeFile(modDir, "file.ts", "// version 1\nconst a = 1;\n");
        const baseResult = await scanner.scan(modDir);
        await writeFile(modDir, "file.ts", "// version 2\nconst a = 2;\n");
        const incResult = await scanner.scanIncremental(modDir, baseResult);
        expect(incResult.modified).toBeGreaterThanOrEqual(1);
        expect(incResult.changes.some((c) => c.relativePath === "file.ts")).toBe(true);
        const changedItem = incResult.changes.find((c) => c.relativePath === "file.ts");
        expect(changedItem?.isModified).toBe(true);
      } finally {
        rmSync(modDir, { recursive: true, force: true });
      }
    });
  });

  describe("compact context formatting", () => {
    it("should produce a formatted summary", () => {
      const items: ScanItem[] = [
        {
          filePath: "/test/src/index.ts",
          relativePath: "src/index.ts",
          type: FileType.CODE,
          size: 50,
          lines: 3,
          summary: "hello function",
          keywords: ["hello", "world"],
          checksum: "abc123",
          isNew: false,
          isModified: false,
        },
      ];
      const ctx: CompactContext = {
        items,
        summary: "",
        tokenEstimate: 10,
        totalFiles: 1,
        totalSize: 50,
        scannedAt: "2025-01-01T00:00:00.000Z",
        categories: { code: 1 },
      };
      const formatted = formatCompactContext(ctx);
      expect(formatted).toContain("Scan Summary");
      expect(formatted).toContain("Total files: 1");
      expect(formatted).toContain("Categories");
      expect(formatted).toContain("code: 1 file(s)");
      expect(formatted).toContain("src/index.ts");
    });

    it("should handle empty items gracefully", () => {
      const ctx: CompactContext = {
        items: [],
        summary: "",
        tokenEstimate: 0,
        totalFiles: 0,
        totalSize: 0,
        scannedAt: "2025-01-01T00:00:00.000Z",
        categories: {},
      };
      const formatted = formatCompactContext(ctx);
      expect(formatted).toContain("Scan Summary");
      expect(formatted).toContain("Total files: 0");
    });
  });
});

describe("detectFileType", () => {
  it("should detect code files", () => {
    expect(detectFileType("src/index.ts")).toBe(FileType.CODE);
    expect(detectFileType("src/app.tsx")).toBe(FileType.CODE);
    expect(detectFileType("lib/main.js")).toBe(FileType.CODE);
    expect(detectFileType("src/util.py")).toBe(FileType.CODE);
    expect(detectFileType("cmd/main.go")).toBe(FileType.CODE);
    expect(detectFileType("src/lib.rs")).toBe(FileType.CODE);
  });

  it("should detect markdown files", () => {
    expect(detectFileType("README.md")).toBe(FileType.MARKDOWN);
    expect(detectFileType("docs/guide.mdx")).toBe(FileType.MARKDOWN);
  });

  it("should detect JSON files", () => {
    expect(detectFileType("config.json")).toBe(FileType.JSON);
    expect(detectFileType("tsconfig.jsonc")).toBe(FileType.JSON);
  });

  it("should detect YAML files", () => {
    expect(detectFileType("config.yaml")).toBe(FileType.YAML);
    expect(detectFileType(".github/workflows/ci.yml")).toBe(FileType.YAML);
  });

  it("should detect XML files", () => {
    expect(detectFileType("data.xml")).toBe(FileType.XML);
    expect(detectFileType("schema.xsd")).toBe(FileType.XML);
  });

  it("should detect CSV files", () => {
    expect(detectFileType("data.csv")).toBe(FileType.CSV);
    expect(detectFileType("data.tsv")).toBe(FileType.CSV);
  });

  it("should detect config files", () => {
    expect(detectFileType(".env")).toBe(FileType.CONFIG);
    expect(detectFileType(".env.production")).toBe(FileType.CONFIG);
    expect(detectFileType(".gitignore")).toBe(FileType.CONFIG);
    expect(detectFileType("Makefile")).toBe(FileType.CONFIG);
    expect(detectFileType("Dockerfile")).toBe(FileType.CONFIG);
    expect(detectFileType(".editorconfig")).toBe(FileType.CONFIG);
  });

  it("should detect log files", () => {
    expect(detectFileType("output.log")).toBe(FileType.LOG);
  });

  it("should detect image files", () => {
    expect(detectFileType("screenshot.png")).toBe(FileType.IMAGE);
    expect(detectFileType("photo.jpg")).toBe(FileType.IMAGE);
    expect(detectFileType("icon.webp")).toBe(FileType.IMAGE);
  });

  it("should detect PDF and spreadsheet files", () => {
    expect(detectFileType("report.pdf")).toBe(FileType.PDF);
    expect(detectFileType("data.xlsx")).toBe(FileType.SPREADSHEET);
  });

  it("should detect document files", () => {
    expect(detectFileType("notes.txt")).toBe(FileType.DOCUMENT);
    expect(detectFileType("docs/guide.rst")).toBe(FileType.DOCUMENT);
  });

  it("should return UNKNOWN for unrecognized extensions", () => {
    expect(detectFileType("data.bin")).toBe(FileType.UNKNOWN);
    expect(detectFileType("archive.tar.gz")).toBe(FileType.UNKNOWN);
  });
});

describe("computeChecksum", () => {
  it("should compute consistent checksum for same content", () => {
    const content = "const a = 1;\nconst b = 2;\n";
    const hash1 = computeChecksum("/path/to/file.ts", content);
    const hash2 = computeChecksum("/path/to/file.ts", content);
    expect(hash1).toBe(hash2);
  });

  it("should compute different checksum for different content", () => {
    const hash1 = computeChecksum("/path/to/file.ts", "const a = 1;\n");
    const hash2 = computeChecksum("/path/to/file.ts", "const a = 2;\n");
    expect(hash1).not.toBe(hash2);
  });

  it("should sample only first 4096 chars", () => {
    const longA = "a".repeat(5000);
    const longB = "a".repeat(4000) + "b".repeat(1000);
    const hashA = computeChecksum("/path/to/file.ts", longA);
    const hashB = computeChecksum("/path/to/file.ts", longB);
    expect(hashA).not.toBe(hashB);
  });
});

describe("extractKeywords", () => {
  it("should return most frequent meaningful words", () => {
    const content = "authentication auth login auth user session auth token";
    const keywords = extractKeywords(content, 3);
    expect(keywords).toContain("authentication");
    expect(keywords).toContain("auth");
    expect(keywords).toContain("login");
  });

  it("should filter short words (<=3 chars)", () => {
    const content = "a an the cat dog fox authentication";
    const keywords = extractKeywords(content, 10);
    expect(keywords).not.toContain("a");
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("cat");
    expect(keywords).not.toContain("dog");
    expect(keywords).toContain("authentication");
  });

  it("should limit result count", () => {
    const content = "one two three four five six seven eight nine ten eleven";
    const keywords = extractKeywords(content, 5);
    expect(keywords.length).toBeLessThanOrEqual(5);
  });

  it("should lowercase keywords", () => {
    const content = "AUTH Login Feature";
    const keywords = extractKeywords(content, 10);
    expect(keywords).toContain("auth");
    expect(keywords).toContain("login");
    expect(keywords).toContain("feature");
  });

  it("should return empty array for content with only short words", () => {
    const content = "a an the cat dog";
    const keywords = extractKeywords(content, 10);
    expect(keywords).toEqual([]);
  });
});

describe("estimateTokens", () => {
  it("should estimate tokens at roughly chars/4", () => {
    expect(estimateTokens("hello world")).toBe(3);
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("countLines", () => {
  it("should count lines correctly", () => {
    expect(countLines("hello\nworld\n")).toBe(2);
    expect(countLines("single line")).toBe(1);
    expect(countLines("")).toBe(0);
    expect(countLines("line1\nline2\nline3")).toBe(3);
  });
});
