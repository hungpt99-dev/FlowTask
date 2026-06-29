import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ProjectScanner } from "../../src/context/project-scanner.js";
import { GitScanner } from "../../src/context/git-scanner.js";
import { TestScanner } from "../../src/context/test-scanner.js";
import { KeywordScanner } from "../../src/context/keyword-scanner.js";
import { CodeGraphScanner } from "../../src/context/codegraph-scanner.js";
import { ScanCache } from "../../src/context/scan-cache.js";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function initGitRepo(dir: string): void {
  spawnSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: dir, stdio: "ignore" });
}

function gitCommit(dir: string): void {
  spawnSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "ignore" });
}

describe("Scanner caching integration", () => {
  let testDir: string;
  let cacheDir: string;
  let scanCache: ScanCache;

  beforeAll(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "scanner-cache-integration-"));
    cacheDir = path.join(testDir, ".flowtask", "cache", "scanner");
    scanCache = new ScanCache({ cacheDir, useCache: true });

    await fs.mkdir(path.join(testDir, "src"), { recursive: true });
    await fs.mkdir(path.join(testDir, "docs"), { recursive: true });
    await fs.mkdir(path.join(testDir, "tests"), { recursive: true });

    await fs.writeFile(path.join(testDir, "src", "index.ts"), "export const main = () => {};\n");
    await fs.writeFile(
      path.join(testDir, "src", "auth.ts"),
      "export function login() {}\nexport function register() {}\n",
    );
    await fs.writeFile(path.join(testDir, "src", "utils.ts"), "export function helper() {}\n");
    await fs.writeFile(
      path.join(testDir, "tests", "auth.test.ts"),
      'import { login } from "../src/auth";\ndescribe("auth", () => { it("works", () => {}); });\n',
    );
    await fs.writeFile(
      path.join(testDir, "package.json"),
      JSON.stringify({
        name: "cached-project",
        version: "1.0.0",
        scripts: { test: "vitest run", build: "tsup" },
        dependencies: { express: "^4.18.0" },
        devDependencies: { vitest: "^1.0.0", typescript: "^5.0.0" },
      }),
    );
    await fs.writeFile(
      path.join(testDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    await fs.writeFile(path.join(testDir, "README.md"), "# Cached Project\n");

    initGitRepo(testDir);
    gitCommit(testDir);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("ProjectScanner caches and reuses metadata", async () => {
    const scanner = new ProjectScanner({
      cache: { cacheDir, useCache: true },
    });

    const meta1 = await scanner.scanMetadata(testDir);
    expect(meta1.name).toBe("cached-project");

    const meta2 = await scanner.scanMetadata(testDir);
    expect(meta2.name).toBe("cached-project");
    expect(meta2).toEqual(meta1);
  });

  it("ProjectScanner invalidates cache when package.json changes", async () => {
    const scanner = new ProjectScanner({
      cache: { cacheDir, useCache: true },
    });

    const meta1 = await scanner.scanMetadata(testDir);
    expect(meta1.name).toBe("cached-project");

    await fs.writeFile(
      path.join(testDir, "package.json"),
      JSON.stringify({
        name: "renamed-project",
        version: "2.0.0",
        scripts: { test: "vitest run" },
      }),
    );

    const meta2 = await scanner.scanMetadata(testDir);
    expect(meta2.name).toBe("renamed-project");
  });

  it("ProjectScanner returns null cache when disabled", async () => {
    const noCache = new ScanCache({ cacheDir, useCache: false });
    const result = await noCache.get("project-metadata", []);
    expect(result).toBeNull();
  });

  it("GitScanner caches and reuses status", async () => {
    const scanner = new GitScanner({
      cache: { cacheDir, useCache: true },
    });

    const status1 = await scanner.scan(testDir);
    expect(status1.branch).toBe("main");

    const status2 = await scanner.scan(testDir);
    expect(status2.branch).toBe("main");
    expect(status2).toEqual(status1);
  });

  it("GitScanner returns cached status when HEAD unchanged", async () => {
    const scanner = new GitScanner({
      cache: { cacheDir, useCache: true },
    });

    await scanner.scan(testDir);

    const cached = await scanCache.get("git-status", [
      path.join(testDir, ".git", "HEAD"),
      path.join(testDir, ".git", "index"),
    ]);
    expect(cached).not.toBeNull();
  });

  it("KeywordScanner caches and reuses results for same prompt", async () => {
    const scanner = new KeywordScanner({
      cache: { cacheDir, useCache: true },
    });

    const result1 = await scanner.scan(testDir, "auth login");
    const authFiles1 = result1.matches.filter((m) => m.relativePath.includes("auth"));
    expect(authFiles1.length).toBeGreaterThan(0);

    const result2 = await scanner.scan(testDir, "auth login");
    expect(result2.matches.length).toBe(result1.matches.length);
  });

  it("KeywordScanner returns different results for different prompts", async () => {
    const scanner = new KeywordScanner({
      cache: { cacheDir, useCache: true },
    });

    const authResult = await scanner.scan(testDir, "auth login");
    const utilsResult = await scanner.scan(testDir, "helper utility");

    const authPaths = authResult.matches.map((m) => m.relativePath);
    const utilsPaths = utilsResult.matches.map((m) => m.relativePath);

    expect(authPaths.some((p) => p.includes("auth"))).toBe(true);
    expect(utilsPaths.some((p) => p.includes("utils"))).toBe(true);
  });

  it("TestScanner caches and reuses scan results", async () => {
    const scanner = new TestScanner({
      cache: { cacheDir, useCache: true },
    });

    const result1 = await scanner.scan(testDir);
    expect(result1.testFileCount).toBeGreaterThan(0);

    const result2 = await scanner.scan(testDir);
    expect(result2.testFileCount).toBe(result1.testFileCount);
  });

  it("CodeGraphScanner caches and reuses results for same files", async () => {
    const scanner = new CodeGraphScanner({
      cache: { cacheDir, useCache: true },
    });

    const files = [path.join(testDir, "src", "auth.ts"), path.join(testDir, "src", "utils.ts")];

    const result1 = await scanner.scan(files, testDir);
    expect(result1.graph.files.length).toBe(2);

    const result2 = await scanner.scan(files, testDir);
    expect(result2.graph.files.length).toBe(2);
    expect(result2.graph.edges).toEqual(result1.graph.edges);
  });

  it("CodeGraphScanner invalidates cache when source files change", async () => {
    const scanner = new CodeGraphScanner({
      cache: { cacheDir, useCache: true },
    });

    const files = [path.join(testDir, "src", "auth.ts")];

    const result1 = await scanner.scan(files, testDir);
    expect(result1.graph.files.length).toBe(1);
    const exportsBefore = result1.graph.files[0]!.exports;

    await fs.writeFile(
      path.join(testDir, "src", "auth.ts"),
      "export function login() {}\nexport function logout() {}\nexport function reset() {}\n",
    );

    const result2 = await scanner.scan(files, testDir);
    expect(result2.graph.files[0]!.exports).not.toEqual(exportsBefore);
    expect(result2.graph.files[0]!.exports).toContain("logout");
    expect(result2.graph.files[0]!.exports).toContain("reset");
  });

  it("TaskContextBuilder with caching returns consistent context", async () => {
    const { TaskContextBuilder } = await import("../../src/context/task-context-builder.js");
    const builder = new TaskContextBuilder({
      cacheDir,
      useCache: true,
    });

    const ctx1 = await builder.build(testDir, "auth login");
    const ctx2 = await builder.build(testDir, "auth login");

    expect(ctx1.projectMeta).toEqual(ctx2.projectMeta);
    expect(ctx1.keywordMatches.length).toBe(ctx2.keywordMatches.length);
    expect(ctx1.contextPack).toBe(ctx2.contextPack);
  });

  it("ScanCache handles empty dependency list", async () => {
    const sc = new ScanCache({ cacheDir, useCache: true });
    await sc.set("no-dep-key", { preserved: true }, []);
    const result = await sc.get("no-dep-key", []);
    expect(result).toEqual({ preserved: true });
  });

  it("invalidate removes cache file from disk", async () => {
    const sc = new ScanCache({ cacheDir, useCache: true });
    await sc.set("remove-key", "to-remove", []);
    expect(await sc.get<string>("remove-key", [])).toBe("to-remove");
    await sc.invalidate("remove-key");
    expect(await sc.get<string>("remove-key", [])).toBeNull();
  });

  it("handles cache with missing dependency (file deleted before get)", async () => {
    const depFile = path.join(cacheDir, "will-be-deleted.txt");
    await fs.writeFile(depFile, "temp");

    const sc = new ScanCache({ cacheDir, useCache: true });
    await sc.set("missing-dep-key", "data", [depFile]);

    await fs.unlink(depFile);

    const result = await sc.get<string>("missing-dep-key", [depFile]);
    expect(result).toBeNull();
  });
});
