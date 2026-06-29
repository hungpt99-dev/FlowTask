import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { fileExists, readDir } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

export const QA_PLUGIN_ID = "qa-plugin";
export const QA_PLUGIN_VERSION = "1.0.0";

export interface QAPluginConfig {
  scanPatterns?: string[];
  checkCoverage?: boolean;
  defaultTestFramework?: string;
}

export class QAPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: QA_PLUGIN_ID,
    name: "QA Plugin",
    version: QA_PLUGIN_VERSION,
    description: "QA workflow plugin for test scenarios, checklists, and quality validation",
    capabilities: ["scanner", "planner-hint", "validator", "artifact-detector"],
  };

  private config: QAPluginConfig = {};
  private projectRoot = "";

  constructor(config?: QAPluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;
    const pluginCfg = (context.pluginConfig?.qa ?? {}) as Record<string, unknown>;

    this.config = {
      scanPatterns: (pluginCfg.scanPatterns as string[] | undefined) ??
        this.config.scanPatterns ?? [
          "tests/**/*",
          "qa/**/*",
          "test-plans/**/*",
          "e2e/**/*",
          "cypress/**/*",
          "playwright/**/*",
        ],
      checkCoverage:
        (pluginCfg.checkCoverage as boolean | undefined) ?? this.config.checkCoverage ?? false,
      defaultTestFramework:
        (pluginCfg.defaultTestFramework as string | undefined) ??
        this.config.defaultTestFramework ??
        "vitest",
    };
  }

  async destroy(): Promise<void> {
    // nothing to clean up
  }

  getCapabilityProviders(): CapabilityProvider[] {
    return [
      {
        capability: "scanner",
        scan: (rootPath: string, _prompt?: string) => this.scanQAContext(rootPath),
      },
      {
        capability: "planner-hint",
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator",
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateQA(params),
      },
      {
        capability: "artifact-detector",
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectQAArtifacts(params),
      },
    ];
  }

  private async scanQAContext(rootPath: string): Promise<{
    type: "qa";
    qaDirs: string[];
    testFiles: number;
    qaDocFiles: number;
    testFrameworks: string[];
    hasTestConfig: boolean;
    totalTestFiles: number;
  }> {
    const qaDirs: string[] = [];
    const candidates = ["tests", "qa", "test-plans", "e2e", "cypress", "playwright"];
    for (const d of candidates) {
      if (await fileExists(path.join(rootPath, d))) {
        qaDirs.push(d);
      }
    }

    const testFiles = new Set<string>();
    const qaDocFiles: string[] = [];

    for (const pattern of this.config.scanPatterns!) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if ([".test.ts", ".spec.ts", ".test.js", ".spec.js"].some((e) => f.endsWith(e))) {
          testFiles.add(f);
        } else if (ext === ".md" || ext === ".txt" || ext === ".xlsx") {
          qaDocFiles.push(f);
        }
      }
    }

    const testFrameworks: string[] = [];
    const pkgJsonPath = path.join(rootPath, "package.json");
    if (await fileExists(pkgJsonPath)) {
      try {
        const { readTextFile } = await import("../utils/fs.js");
        const content = await readTextFile(pkgJsonPath);
        const pkg = JSON.parse(content) as {
          devDependencies?: Record<string, string>;
          dependencies?: Record<string, string>;
        };
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps) {
          if (allDeps.vitest) testFrameworks.push("vitest");
          if (allDeps.jest) testFrameworks.push("jest");
          if (allDeps.mocha) testFrameworks.push("mocha");
          if (allDeps.cypress) testFrameworks.push("cypress");
          if (allDeps["@playwright/test"]) testFrameworks.push("playwright");
        }
      } catch {
        // ignore
      }
    }

    const hasTestConfig =
      (await fileExists(path.join(rootPath, "vitest.config.ts"))) ||
      (await fileExists(path.join(rootPath, "vitest.config.js"))) ||
      (await fileExists(path.join(rootPath, "jest.config.ts"))) ||
      (await fileExists(path.join(rootPath, "jest.config.js")));

    return {
      type: "qa",
      qaDirs,
      testFiles: testFiles.size,
      qaDocFiles: qaDocFiles.length,
      testFrameworks,
      hasTestConfig,
      totalTestFiles: testFiles.size,
    };
  }

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isQATask =
      lower.includes("qa") ||
      lower.includes("quality") ||
      lower.includes("test") ||
      lower.includes("testing") ||
      lower.includes("checklist") ||
      lower.includes("scenario") ||
      lower.includes("verification") ||
      lower.includes("validation") ||
      lower.includes("coverage") ||
      lower.includes("regression") ||
      lower.includes("acceptance") ||
      lower.includes("e2e") ||
      lower.includes("integration test");

    if (!isQATask) return hints;

    hints.push("This is a QA-related task. Scan for test files and QA documents.");
    hints.push("Check test coverage and identify gaps in test scenarios.");
    hints.push("Validate that acceptance criteria have corresponding tests.");

    return hints;
  }

  private async validateQA(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const testDir = path.join(this.projectRoot, "tests");
    if (!(await fileExists(testDir))) {
      return { valid: true, message: "No tests directory to validate" };
    }

    const entries = await readDir(testDir);
    const testFiles = entries.filter(
      (e) =>
        e.endsWith(".test.ts") ||
        e.endsWith(".spec.ts") ||
        e.endsWith(".test.js") ||
        e.endsWith(".spec.js"),
    );

    if (testFiles.length === 0) {
      return { valid: true, message: "tests/ directory exists but contains no test files" };
    }

    return {
      valid: true,
      message: `Found ${testFiles.length} test files in tests/`,
    };
  }

  private async detectQAArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const patterns = this.config.scanPatterns ?? [
      "tests/**/*.test.ts",
      "qa/**/*.md",
      "test-plans/**/*",
    ];

    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: this.projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files.slice(0, 20)) {
        const isTest = f.includes(".test.") || f.includes(".spec.");
        artifacts.push({
          type: isTest ? "qa-test" : "qa-document",
          path: f,
          summary: `${isTest ? "Test" : "QA doc"} file: ${path.basename(f)}`,
        });
      }
    }

    return artifacts;
  }
}
