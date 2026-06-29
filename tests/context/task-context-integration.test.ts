import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TaskContextBuilder } from "../../src/context/task-context-builder.js";
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

function gitCommit(dir: string, msg = "initial"): void {
  spawnSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", msg], { cwd: dir, stdio: "ignore" });
}

describe("TaskContext integration — full scan and cache", () => {
  let testDir: string;
  let cacheDir: string;

  beforeAll(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "task-context-integration-"));

    await fs.mkdir(path.join(testDir, "src"), { recursive: true });
    await fs.mkdir(path.join(testDir, "tests"), { recursive: true });
    await fs.mkdir(path.join(testDir, "docs"), { recursive: true });

    await fs.writeFile(
      path.join(testDir, "src", "index.ts"),
      'export { auth } from "./auth.js";\n',
    );
    await fs.writeFile(
      path.join(testDir, "src", "auth.ts"),
      'import { db } from "./db.js";\nexport function login() {}\nexport function register() {}\n',
    );
    await fs.writeFile(
      path.join(testDir, "src", "db.ts"),
      'import { config } from "./config.js";\nexport const db = { connect: () => {} };\n',
    );
    await fs.writeFile(
      path.join(testDir, "src", "config.ts"),
      "export const config = { port: 3000 };\n",
    );

    await fs.writeFile(
      path.join(testDir, "tests", "auth.test.ts"),
      'import { login } from "../src/auth";\ndescribe("auth", () => { it("works", () => {}); });\n',
    );
    await fs.writeFile(
      path.join(testDir, "tests", "db.test.ts"),
      'import { db } from "../src/db";\ndescribe("db", () => { it("connects", () => {}); });\n',
    );

    await fs.writeFile(path.join(testDir, "docs", "guide.md"), "# Guide\nStep by step.\n");
    await fs.writeFile(path.join(testDir, "README.md"), "# Integration Test Project\n");

    await fs.writeFile(
      path.join(testDir, "package.json"),
      JSON.stringify({
        name: "integration-project",
        version: "2.0.0",
        main: "src/index.ts",
        scripts: { test: "vitest run", build: "tsup", dev: "tsx src/index.ts" },
        dependencies: { express: "^4.18.0" },
        devDependencies: { vitest: "^1.0.0", typescript: "^5.0.0" },
      }),
    );
    await fs.writeFile(
      path.join(testDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, target: "ES2022" } }),
    );
    await fs.writeFile(path.join(testDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    initGitRepo(testDir);
    gitCommit(testDir, "feat: initial setup");

    cacheDir = path.join(testDir, ".flowtask", "cache", "context");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("builds a complete TaskContext with all scanners", async () => {
    const builder = new TaskContextBuilder({ cacheDir, useCache: false });
    const ctx = await builder.build(testDir, "implement auth login");

    expect(ctx.projectMeta).toBeDefined();
    expect(ctx.projectMeta.name).toBe("integration-project");
    expect(ctx.projectMeta.type).toBe("mixed");
    expect(ctx.projectMeta.languages).toContain("typescript");
    expect(ctx.projectMeta.frameworks).toContain("express");
    expect(ctx.projectMeta.testFramework).toBe("vitest");
    expect(ctx.projectMeta.packageManager).toBe("pnpm");
    expect(ctx.projectMeta.buildTool).toBe("tsup");
    expect(ctx.projectMeta.entryPoints).toContain("src/index.ts");
    expect(ctx.projectMeta.hasTests).toBe(true);

    expect(ctx.gitStatus).toBeDefined();
    expect(ctx.gitStatus.branch).toBe("main");
    expect(ctx.gitStatus.recentCommits.length).toBeGreaterThanOrEqual(1);
    expect(ctx.gitStatus.recentCommits[0]!.subject).toBe("feat: initial setup");

    expect(ctx.keywordMatches).toBeDefined();
    expect(ctx.keywordMatches.length).toBeGreaterThan(0);
    const authMatches = ctx.keywordMatches.filter(
      (m) => m.relativePath.includes("auth") || m.filePath.includes("auth"),
    );
    expect(authMatches.length).toBeGreaterThan(0);

    expect(ctx.codeGraph).toBeDefined();
    expect(ctx.codeGraph).not.toBeNull();
    if (ctx.codeGraph) {
      expect(ctx.codeGraph.files.length).toBeGreaterThanOrEqual(3);
      expect(ctx.codeGraph.edges.length).toBeGreaterThanOrEqual(1);
      const authModule = ctx.codeGraph.files.find((f) => f.relativePath === "src/auth.ts");
      expect(authModule).toBeDefined();
      expect(authModule!.exports).toContain("login");
      expect(authModule!.imports).toContain("./db");
    }

    expect(ctx.testResult).toBeDefined();
    expect(ctx.testResult).not.toBeNull();
    if (ctx.testResult) {
      expect(ctx.testResult.testFileCount).toBeGreaterThanOrEqual(2);
      expect(ctx.testResult.frameworks.some((f) => f.name === "vitest")).toBe(true);
      expect(ctx.testResult.testFiles.some((f) => f.relativePath.includes("auth.test"))).toBe(true);
      expect(ctx.testResult.testFiles.some((f) => f.relativePath.includes("db.test"))).toBe(true);
    }

    expect(ctx.contextPack).toBeDefined();
    expect(ctx.contextPack.length).toBeGreaterThan(0);
    expect(ctx.contextPack).toContain("Project Context");
    expect(ctx.contextPack).toContain("Git Status");
    expect(ctx.contextPack).toContain("Relevant Files");
    expect(ctx.contextPack).toContain("Code Graph");
    expect(ctx.contextPack).toContain("Tests");
    expect(ctx.contextPack).toContain("integration-project");
    expect(ctx.contextPack).toContain("main");
    expect(ctx.contextPack).toContain("src/auth.ts");
    expect(ctx.contextPack).toContain("vitest");
  });

  it("returns cached context on second call with same prompt", async () => {
    const builder = new TaskContextBuilder({ cacheDir, useCache: true });
    const ctx1 = await builder.build(testDir, "implement auth login");
    const ctx2 = await builder.build(testDir, "implement auth login");

    expect(ctx2.projectMeta).toEqual(ctx1.projectMeta);
    expect(ctx2.keywordMatches.length).toBe(ctx1.keywordMatches.length);
    if (ctx1.codeGraph && ctx2.codeGraph) {
      expect(ctx2.codeGraph.edges).toEqual(ctx1.codeGraph.edges);
    }
    if (ctx1.testResult && ctx2.testResult) {
      expect(ctx2.testResult.testFileCount).toBe(ctx1.testResult.testFileCount);
    }
    expect(ctx2.contextPack).toBe(ctx1.contextPack);
  });

  it("invalidates cache when source files change", async () => {
    const builder = new TaskContextBuilder({ cacheDir, useCache: true });
    const ctx1 = await builder.build(testDir, "implement auth login");

    const authPath = path.join(testDir, "src", "auth.ts");
    const origAuth = await fs.readFile(authPath, "utf-8");
    await fs.writeFile(
      authPath,
      'import { db } from "./db.js";\nexport function login() {}\nexport function register() {}\nexport function logout() {}\n',
    );

    const ctx2 = await builder.build(testDir, "implement auth login");
    expect(ctx2.codeGraph).not.toBeNull();
    if (ctx2.codeGraph && ctx1.codeGraph) {
      const authModule2 = ctx2.codeGraph.files.find((f) => f.relativePath === "src/auth.ts");
      const authModule1 = ctx1.codeGraph.files.find((f) => f.relativePath === "src/auth.ts");
      expect(authModule2!.exports.length).toBeGreaterThan(authModule1!.exports.length);
      expect(authModule2!.exports).toContain("logout");
    }

    await fs.writeFile(authPath, origAuth);
  });

  it("returns fresh data when cache is disabled", async () => {
    const builder1 = new TaskContextBuilder({ cacheDir, useCache: false });
    const builder2 = new TaskContextBuilder({ cacheDir, useCache: false });

    const ctx1 = await builder1.build(testDir, "implement auth login");
    const ctx2 = await builder2.build(testDir, "implement auth login");

    expect(ctx1.projectMeta).toEqual(ctx2.projectMeta);
    expect(ctx1.gitStatus).toEqual(ctx2.gitStatus);
    expect(ctx1.keywordMatches.length).toBe(ctx2.keywordMatches.length);
    expect(ctx1).not.toBe(ctx2);
  });

  it("caches persist in ScanCache across separate builder instances", async () => {
    const builderCached = new TaskContextBuilder({ cacheDir, useCache: true });
    await builderCached.build(testDir, "db connect");

    const builder2 = new TaskContextBuilder({ cacheDir, useCache: true });
    const ctx = await builder2.build(testDir, "db connect");

    expect(ctx.projectMeta).toBeDefined();
    expect(ctx.projectMeta.name).toBe("integration-project");

    const dbMatches = ctx.keywordMatches.filter(
      (m) => m.relativePath.includes("db") || m.filePath.includes("db"),
    );
    expect(dbMatches.length).toBeGreaterThan(0);
  });

  it("handles research-only project with no code graph or tests", async () => {
    const researchDir = mkdtempSync(path.join(tmpdir(), "task-context-research-"));

    await fs.mkdir(path.join(researchDir, "docs"), { recursive: true });
    await fs.writeFile(path.join(researchDir, "notes.md"), "# Research Notes\nFindings.\n");
    await fs.writeFile(path.join(researchDir, "docs", "report.md"), "# Report\nAnalysis.\n");

    const researchBuilder = new TaskContextBuilder({
      cacheDir: path.join(researchDir, ".flowtask", "cache", "context"),
      useCache: false,
    });

    const ctx = await researchBuilder.build(researchDir, "summarize findings");

    expect(ctx.projectMeta).toBeDefined();
    expect(ctx.projectMeta.type).toBe("docs");
    expect(ctx.codeGraph).toBeNull();
    expect(ctx.testResult).toBeNull();
    expect(ctx.contextPack).not.toContain("Code Graph");
    expect(ctx.contextPack).not.toContain("Tests");

    rmSync(researchDir, { recursive: true, force: true });
  });

  it("handles git repositories with uncommitted changes", async () => {
    await fs.writeFile(
      path.join(testDir, "src", "new-feature.ts"),
      "export function feature() {}\n",
    );

    const builder = new TaskContextBuilder({ cacheDir, useCache: false });
    const ctx = await builder.build(testDir, "new feature");

    expect(ctx.gitStatus.hasChanges).toBe(true);
    expect(ctx.gitStatus.untracked).toBeGreaterThanOrEqual(1);
    expect(ctx.contextPack).toContain("Modified");

    await fs.unlink(path.join(testDir, "src", "new-feature.ts"));
    spawnSync("git", ["checkout", "."], { cwd: testDir, stdio: "ignore" });
  });

  it("formatSummary produces correct output", async () => {
    const builder = new TaskContextBuilder({ cacheDir, useCache: false });
    const ctx = await builder.build(testDir, "implement auth login");
    const summary = builder.formatSummary(ctx);

    expect(summary).toContain("integration-project");
    expect(summary).toContain("mixed");
    expect(summary).toContain("main");
    expect(summary).toContain("Keywords matched");
    expect(summary).toContain("Code graph");
    expect(summary).toContain("Tests");
  });

  it("handles empty prompt gracefully", async () => {
    const builder = new TaskContextBuilder({ cacheDir, useCache: false });
    const ctx = await builder.build(testDir, "");

    expect(ctx.projectMeta).toBeDefined();
    expect(ctx.keywordMatches).toEqual([]);
    expect(ctx.codeGraph).toBeNull();
    expect(ctx.contextPack).toBeDefined();
    expect(ctx.contextPack).not.toContain("Relevant Files");
  });
});
