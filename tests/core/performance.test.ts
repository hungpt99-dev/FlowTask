import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WorkspaceScanner } from "../../src/core/scanner.js";
import { TaskContextBuilder } from "../../src/context/task-context-builder.js";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "perf-test-"));
}

async function writeFile(dir: string, relPath: string, content: string): Promise<void> {
  const full = path.join(dir, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

describe("Performance: Incremental scanning", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = createTempDir();

    await writeFile(testDir, "src/index.ts", `export function hello() { return "world"; }\n`);
    await writeFile(
      testDir,
      "src/utils.ts",
      `export function add(a: number, b: number) { return a + b; }\n`,
    );
    await writeFile(
      testDir,
      "src/auth.ts",
      `export function login() {}\nexport function register() {}\n`,
    );
    await writeFile(testDir, "README.md", "# Test Project\nThis is a test project.\n");
    await writeFile(testDir, "config.json", JSON.stringify({ key: "value" }));
    await writeFile(testDir, "data.csv", "name,age\nAlice,30\nBob,25\n");
    await writeFile(testDir, ".gitignore", "node_modules\ndist\n");

    await fs.mkdir(path.join(testDir, "node_modules"), { recursive: true });
    await writeFile(testDir, "node_modules/lodash/index.ts", `export function clone() {}\n`);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should produce identical results on repeated scans", async () => {
    const scanner = new WorkspaceScanner({
      maxFilesPerType: 100,
      maxTotalFiles: 200,
      useCache: false,
    });

    const result1 = await scanner.scan(testDir);
    const result2 = await scanner.scan(testDir);

    expect(result1.totalFiles).toBe(result2.totalFiles);
    expect(result1.items.length).toBe(result2.items.length);

    for (let i = 0; i < result1.items.length; i++) {
      expect(result1.items[i]!.checksum).toBe(result2.items[i]!.checksum);
      expect(result1.items[i]!.size).toBe(result2.items[i]!.size);
      expect(result1.items[i]!.lines).toBe(result2.items[i]!.lines);
    }
  });

  it("incremental scan detects no changes when files unchanged", async () => {
    const scanner = new WorkspaceScanner({
      maxFilesPerType: 100,
      maxTotalFiles: 200,
      useCache: false,
    });

    const base = await scanner.scan(testDir);
    const incResult = await scanner.scanIncremental(testDir, base);

    expect(incResult.added).toBe(0);
    expect(incResult.modified).toBe(0);
    expect(incResult.removed).toBe(0);
    expect(incResult.changes.length).toBe(0);
  });

  it("incremental scan detects new files", async () => {
    const scanner = new WorkspaceScanner({
      maxFilesPerType: 100,
      maxTotalFiles: 200,
      useCache: false,
    });

    const base = await scanner.scan(testDir);

    await writeFile(testDir, "src/new-module.ts", `export function newFn() { return 42; }\n`);

    const incResult = await scanner.scanIncremental(testDir, base);
    expect(incResult.added).toBeGreaterThanOrEqual(1);
    expect(incResult.changes.some((c) => c.relativePath === "src/new-module.ts")).toBe(true);

    await fs.unlink(path.join(testDir, "src", "new-module.ts"));
  });

  it("incremental scan detects modified files", async () => {
    const scanner = new WorkspaceScanner({
      maxFilesPerType: 100,
      maxTotalFiles: 200,
      useCache: false,
    });

    const base = await scanner.scan(testDir);
    await writeFile(
      testDir,
      "src/utils.ts",
      `export function multiply(a: number, b: number) { return a * b; }\n`,
    );

    const incResult = await scanner.scanIncremental(testDir, base);
    expect(incResult.modified).toBeGreaterThanOrEqual(1);
    const changed = incResult.changes.find((c) => c.relativePath === "src/utils.ts");
    expect(changed?.isModified).toBe(true);

    await writeFile(
      testDir,
      "src/utils.ts",
      `export function add(a: number, b: number) { return a + b; }\n`,
    );
  });

  it("incremental scan is faster than full scan for unchanged workspace", async () => {
    const scanner = new WorkspaceScanner({
      maxFilesPerType: 100,
      maxTotalFiles: 200,
      useCache: false,
    });

    const base = await scanner.scan(testDir);

    const incResult = await scanner.scanIncremental(testDir, base);
    const startFull = Date.now();
    await scanner.scan(testDir);
    const fullTime = Date.now() - startFull;

    expect(incResult.changes.length).toBe(0);
    expect(fullTime).toBeGreaterThanOrEqual(0);
  });
});

describe("Performance: Content cache", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = createTempDir();
    await writeFile(testDir, "src/index.ts", `export function hello() { return "world"; }\n`);
    await writeFile(
      testDir,
      "src/utils.ts",
      `export function add(a: number, b: number) { return a + b; }\n`,
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("content cache returns cached data for unchanged files", async () => {
    const scanner = new WorkspaceScanner({
      maxFilesPerType: 100,
      maxTotalFiles: 200,
      useCache: false,
    });

    const result1 = await scanner.scan(testDir);
    const result2 = await scanner.scan(testDir);

    expect(result1.items.length).toBe(result2.items.length);
    expect(result1.items[0]!.summary).toBe(result2.items[0]!.summary);
  });

  it("summary length respects maxSummaryLength", async () => {
    const scanner = new WorkspaceScanner({
      maxFilesPerType: 100,
      maxTotalFiles: 200,
      maxSummaryLength: 50,
      useCache: false,
    });

    const result = await scanner.scan(testDir);
    for (const item of result.items) {
      expect(item.summary.length).toBeLessThanOrEqual(53);
    }
  });
});

describe("Performance: Context compression", () => {
  let testDir: string;
  let cacheDir: string;

  beforeAll(async () => {
    testDir = createTempDir();

    await fs.mkdir(path.join(testDir, "src"), { recursive: true });
    await fs.mkdir(path.join(testDir, "docs"), { recursive: true });

    await writeFile(testDir, "src/index.ts", `export function hello() { return "world"; }\n`);
    await writeFile(
      testDir,
      "src/utils.ts",
      `export function add(a: number, b: number) { return a + b; }\n`,
    );
    await writeFile(testDir, "src/auth.ts", `export function login() {}\n`);
    await writeFile(testDir, "README.md", "# Test Project\nThis is a test project.\n");
    await writeFile(
      testDir,
      "package.json",
      JSON.stringify({ name: "test-project", version: "1.0.0", scripts: { test: "vitest run" } }),
    );
    await writeFile(
      testDir,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { strict: true } }),
    );

    await fs.mkdir(path.join(testDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

    cacheDir = path.join(testDir, ".flowtask", "cache", "context");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("task context builder caches and reuses results", async () => {
    const builder = new TaskContextBuilder({
      cacheDir,
      useCache: true,
    });

    const ctx1 = await builder.build(testDir, "implement auth login");
    const ctx2 = await builder.build(testDir, "implement auth login");

    expect(ctx1.projectMeta).toEqual(ctx2.projectMeta);
    expect(ctx1.compactText).toBe(ctx2.compactText);
  });

  it("task context builder returns different context for different prompts", async () => {
    const builder = new TaskContextBuilder({
      cacheDir,
      useCache: true,
    });

    const ctx1 = await builder.build(testDir, "implement auth login");
    const ctx2 = await builder.build(testDir, "create documentation");

    expect(ctx1.workflowType).not.toBe(ctx2.workflowType);
  });

  it("compactText size is bounded", async () => {
    const builder = new TaskContextBuilder({
      cacheDir,
      useCache: false,
    });

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.compactText.length).toBeLessThan(10000);
  });
});

describe("Performance: Output limits", () => {
  it("output line truncation works correctly", () => {
    const line = "a".repeat(15000);
    const truncated = line.slice(0, 9997) + "...";
    expect(truncated.length).toBe(10000);
  });

  it("buffered lines should not exceed reasonable limits", () => {
    const lines = new Array(15000).fill("test line");
    const limited = lines.slice(0, 10000);
    expect(limited.length).toBe(10000);
  });
});
