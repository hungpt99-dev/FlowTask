/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { TaskContextBuilder } from "../../src/context/task-context-builder.js";
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

  mockSpawn.mockImplementation((cmd: string, ...rest: unknown[]) => {
    if (cmd === "rg") {
      return child as unknown as ReturnType<typeof spawn>;
    }
    if (cmd === "git") {
      const gitDataCbs: Array<(d: Buffer) => void> = [];
      const gitCloseCbs: Array<(c: number) => void> = [];
      const gitChild = {
        stdout: {
          on: vi.fn((e: string, h: (chunk: Buffer) => void) => {
            if (e === "data") gitDataCbs.push(h);
            return gitChild;
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((e: string, h: (code: number) => void) => {
          if (e === "close") {
            gitCloseCbs.push(h);
            process.nextTick(() => {
              gitDataCbs.forEach((cb) => cb(Buffer.from("main\n")));
              gitCloseCbs.forEach((cb) => cb(0));
            });
          }
          return gitChild;
        }),
        pid: 12345,
      };
      return gitChild as unknown as ReturnType<typeof spawn>;
    }
    return undefined as unknown as ReturnType<typeof spawn>;
  });
}

describe("TaskContextBuilder", () => {
  let builder: TaskContextBuilder;
  let testDir: string;
  let cacheDir: string;

  beforeAll(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "task-context-builder-test-"));

    await fs.mkdir(path.join(testDir, "src"), { recursive: true });
    await fs.mkdir(path.join(testDir, "docs"), { recursive: true });
    await fs.mkdir(path.join(testDir, "tests"), { recursive: true });

    await fs.writeFile(
      path.join(testDir, "src", "auth.ts"),
      "export function login() {}\nexport function register() {}\n",
    );
    await fs.writeFile(
      path.join(testDir, "src", "db.ts"),
      'import { openDB } from "./database.js";\nexport class DbClient {}\n',
    );
    await fs.writeFile(
      path.join(testDir, "src", "utils.ts"),
      'export function formatDate(d: Date): string { return ""; }\n',
    );
    await fs.writeFile(
      path.join(testDir, "tests", "auth.test.ts"),
      'import { login } from "../src/auth";\ndescribe("auth", () => { it("works", () => {}); });\n',
    );
    await fs.writeFile(
      path.join(testDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        main: "src/index.ts",
        scripts: { test: "vitest run", build: "tsup" },
        dependencies: { express: "^4.18.0" },
        devDependencies: { vitest: "^1.0.0", typescript: "^5.0.0" },
      }),
    );
    await fs.writeFile(
      path.join(testDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    await fs.writeFile(path.join(testDir, "README.md"), "# Test Project\nA test project.\n");

    await fs.mkdir(path.join(testDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

    cacheDir = path.join(testDir, ".flowtask", "cache", "context");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockSpawn.mockReset();
    builder = new TaskContextBuilder({
      cacheDir,
      useCache: true,
    });
  });

  it("builds a complete TaskContext for a code project", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");

    expect(ctx.projectMeta).toBeDefined();
    expect(ctx.projectMeta.name).toBe("test-project");
    expect(ctx.projectMeta.languages).toContain("typescript");
    expect(ctx.projectMeta.frameworks).toContain("express");
    expect(ctx.projectMeta.testFramework).toBe("vitest");
    expect(ctx.projectMeta.entryPoints).toContain("src/index.ts");
    expect(ctx.projectMeta.hasTests).toBe(true);

    expect(ctx.gitStatus).toBeDefined();
    expect(ctx.gitStatus.branch).toBe("main");

    expect(ctx.keywordMatches).toBeDefined();
    expect(Array.isArray(ctx.keywordMatches)).toBe(true);

    expect(ctx.codeGraph).toBeDefined();
    expect(ctx.codeGraph).not.toBeNull();

    if (ctx.codeGraph) {
      expect(ctx.codeGraph.files.length).toBeGreaterThan(0);
      expect(ctx.codeGraph.edges).toBeDefined();
    }

    expect(ctx.testResult).toBeDefined();
    expect(ctx.testResult).not.toBeNull();

    if (ctx.testResult) {
      expect(ctx.testResult.testFileCount).toBeGreaterThan(0);
      expect(ctx.testResult.frameworks.some((f) => f.name === "vitest")).toBe(true);
    }

    expect(ctx.contextPack).toBeDefined();
    expect(ctx.contextPack.length).toBeGreaterThan(0);
    expect(ctx.contextPack).toContain("Project Context");
    expect(ctx.contextPack).toContain("test-project");
    expect(ctx.contextPack).toContain("Git Status");
    expect(ctx.contextPack).toContain("main");
  });

  it("builds context for a docs-only project", async () => {
    const docsDir = mkdtempSync(path.join(tmpdir(), "task-context-docs-test-"));

    await fs.mkdir(path.join(docsDir, "docs"), { recursive: true });
    await fs.writeFile(path.join(docsDir, "README.md"), "# Docs Project\nDocumentation.\n");
    await fs.writeFile(path.join(docsDir, "docs", "guide.md"), "# Guide\nStep by step.\n");

    const docsBuilder = new TaskContextBuilder({
      cacheDir: path.join(docsDir, ".flowtask", "cache", "context"),
      useCache: false,
    });

    mockRgResponse("", 1);

    const ctx = await docsBuilder.build(docsDir, "update documentation");

    expect(ctx.projectMeta).toBeDefined();
    expect(ctx.projectMeta.name).toBe(path.basename(docsDir));
    expect(ctx.keywordMatches).toBeDefined();
    expect(ctx.codeGraph).toBeNull();
    expect(ctx.testResult).toBeNull();
    expect(ctx.contextPack).toBeDefined();

    rmSync(docsDir, { recursive: true, force: true });
  });

  it("caches and reuses scan results", async () => {
    mockRgResponse("", 1);

    const cacheBuilder = new TaskContextBuilder({
      cacheDir,
      useCache: true,
    });

    const ctx1 = await cacheBuilder.build(testDir, "implement auth login");
    expect(ctx1.projectMeta.name).toBe("test-project");

    const ctx2 = await cacheBuilder.build(testDir, "implement auth login");
    expect(ctx2.projectMeta.name).toBe("test-project");
    expect(ctx2.contextPack).toBe(ctx1.contextPack);
  });

  it("formatSummary returns a compact one-line summary", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    const summary = builder.formatSummary(ctx);

    expect(summary).toContain("test-project");
    expect(summary).toContain("main");
    expect(summary).toContain("Keywords matched");
  });

  it("handles non-code project type gracefully", async () => {
    const researchDir = mkdtempSync(path.join(tmpdir(), "task-context-research-test-"));

    await fs.mkdir(path.join(researchDir, "docs"), { recursive: true });
    await fs.writeFile(path.join(researchDir, "notes.md"), "# Research Notes\nFindings.\n");
    await fs.writeFile(path.join(researchDir, "docs", "report.md"), "# Report\nAnalysis.\n");

    const researchBuilder = new TaskContextBuilder({
      cacheDir: path.join(researchDir, ".flowtask", "cache", "context"),
      useCache: false,
    });

    mockRgResponse("", 1);

    const ctx = await researchBuilder.build(researchDir, "summarize findings");
    expect(ctx.codeGraph).toBeNull();
    expect(ctx.contextPack).not.toContain("Code Graph");

    rmSync(researchDir, { recursive: true, force: true });
  });

  it("includes keyword-matched files in context pack", async () => {
    mockRgResponse(path.join(testDir, "src", "auth.ts") + "\n", 0);

    const ctx = await builder.build(testDir, "auth module");
    expect(ctx.keywordMatches.length).toBeGreaterThan(0);
    expect(ctx.contextPack).toContain("Relevant Files");

    const hasAuthFile = ctx.keywordMatches.some(
      (m) => m.relativePath.includes("auth") || m.filePath.includes("auth"),
    );
    expect(hasAuthFile).toBe(true);
  });

  it("includes test info in context pack when tests exist", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.contextPack).toContain("Tests");
    if (ctx.testResult) {
      expect(ctx.contextPack).toContain("auth.test.ts");
    }
  });

  it("includes code graph in context pack for code projects", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.contextPack).toContain("Code Graph");
    if (ctx.codeGraph) {
      expect(ctx.contextPack).toContain("src/auth.ts");
    }
  });

  it("handles cache write failure gracefully", async () => {
    const invalidCacheDir = path.join(testDir, "nonexistent", "deep", "cache");

    const failBuilder = new TaskContextBuilder({
      cacheDir: invalidCacheDir,
      useCache: true,
    });

    mockRgResponse("", 1);

    const ctx = await failBuilder.build(testDir, "implement auth login");
    expect(ctx.projectMeta).toBeDefined();
    expect(ctx.contextPack).toBeDefined();
  });

  it("handles empty prompt gracefully", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "");
    expect(ctx.projectMeta).toBeDefined();
    expect(ctx.keywordMatches).toEqual([]);
  });

  it("correctly identifies package manager", async () => {
    const pmTestDir = mkdtempSync(path.join(tmpdir(), "task-context-pm-test-"));
    await fs.writeFile(path.join(pmTestDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await fs.writeFile(
      path.join(pmTestDir, "package.json"),
      JSON.stringify({
        name: "pm-test",
        version: "1.0.0",
        scripts: { test: "vitest run" },
      }),
    );

    mockRgResponse("", 1);

    const pmBuilder = new TaskContextBuilder({
      cacheDir: path.join(pmTestDir, ".flowtask", "cache", "context"),
      useCache: false,
    });

    const ctx = await pmBuilder.build(pmTestDir, "implement");
    expect(ctx.projectMeta.packageManager).toBe("pnpm");

    rmSync(pmTestDir, { recursive: true, force: true });
  });

  it("includes userGoal in the task context", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.userGoal).toBe("implement auth login");
  });

  it("detects task type and workflow type from prompt", async () => {
    mockRgResponse("", 1);

    const codeCtx = await builder.build(testDir, "implement auth login");
    expect(codeCtx.taskType).toBe("code");
    expect(codeCtx.workflowType).toBe("code_implementation");

    const docsCtx = await builder.build(testDir, "update documentation readme");
    expect(docsCtx.taskType).toBe("documentation");
    expect(docsCtx.workflowType).toBe("documentation");

    const researchCtx = await builder.build(testDir, "research compare frameworks");
    expect(researchCtx.taskType).toBe("research");
    expect(researchCtx.workflowType).toBe("research");
  });

  it("includes context items from the workspace scan", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.contextItems).toBeDefined();
    expect(Array.isArray(ctx.contextItems)).toBe(true);
    if (ctx.contextItems.length > 0) {
      expect(ctx.contextItems[0]).toHaveProperty("path");
      expect(ctx.contextItems[0]).toHaveProperty("type");
      expect(ctx.contextItems[0]).toHaveProperty("relevance");
    }
  });

  it("includes risks based on workflow type", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.risks).toBeDefined();
    expect(Array.isArray(ctx.risks)).toBe(true);
    for (const risk of ctx.risks) {
      expect(risk).toHaveProperty("description");
      expect(risk).toHaveProperty("level");
      expect(risk).toHaveProperty("mitigation");
    }
  });

  it("includes constraints from project analysis", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.constraints).toBeDefined();
    expect(Array.isArray(ctx.constraints)).toBe(true);
  });

  it("includes validation methods for the workflow type", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.validationMethods).toBeDefined();
    expect(ctx.validationMethods.length).toBeGreaterThan(0);
    expect(ctx.validationMethods[0]).toHaveProperty("type");
    expect(ctx.validationMethods[0]).toHaveProperty("description");
  });

  it("includes planning hints based on task type", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.planningHints).toBeDefined();
    expect(ctx.planningHints.length).toBeGreaterThan(0);
    for (const hint of ctx.planningHints) {
      expect(hint).toHaveProperty("description");
      expect(hint).toHaveProperty("priority");
    }
  });

  it("calculates confidence score", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.confidenceScore).toBeGreaterThan(0);
    expect(ctx.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("generates compact text for the planner", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.compactText).toBeDefined();
    expect(ctx.compactText.length).toBeGreaterThan(0);
    expect(ctx.compactText).toContain("Task Context");
    expect(ctx.compactText).toContain("implement auth login");
    expect(ctx.compactText).toContain("code");
  });

  it("generates expected outputs for the workflow type", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.expectedOutputs).toBeDefined();
    expect(ctx.expectedOutputs.length).toBeGreaterThan(0);
    for (const output of ctx.expectedOutputs) {
      expect(output).toHaveProperty("type");
      expect(output).toHaveProperty("description");
      expect(output).toHaveProperty("validationMethod");
    }
  });

  it("builds a summary that includes new fields", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    const summary = builder.formatSummary(ctx);
    expect(summary).toContain("Task: code");
    expect(summary).toContain("Confidence");
    expect(summary).toContain("Context items");
    expect(summary).toContain("Risks");
  });

  it("sets task type to code for a code project even with general prompt", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "do something");
    expect(ctx.taskType).toBe("code");
  });

  it("includes related commands from project scripts", async () => {
    mockRgResponse("", 1);

    const ctx = await builder.build(testDir, "implement auth login");
    expect(ctx.relatedCommands).toBeDefined();
    expect(ctx.relatedCommands.length).toBeGreaterThan(0);
  });
});
