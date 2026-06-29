import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { CodeGraphProvider, type CodeGraphProviderConfig } from "./codegraph-provider.js";
import { fileExists, readTextFile } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

// ── CodePlugin ────────────────────────────────────────

export const CODE_PLUGIN_ID = "code-plugin";
export const CODE_PLUGIN_VERSION = "1.0.0";

export interface CodePluginConfig {
  enableCodeGraph?: boolean;
  codeGraphProjectRoot?: string;
  scanPatterns?: string[];
  testPatterns?: string[];
  buildCommands?: string[];
  lintCommands?: string[];
  testCommands?: string[];
  fallbackToLightweight?: boolean;
}

export class CodePlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: CODE_PLUGIN_ID,
    name: "Code Plugin",
    version: CODE_PLUGIN_VERSION,
    description: "Code intelligence plugin using CodeGraph for code-aware workflows",
    capabilities: ["scanner", "context-builder", "planner-hint", "validator", "artifact-detector"],
  };

  private codeGraphProvider: CodeGraphProvider | null = null;
  private config: CodePluginConfig = {};
  private projectRoot = "";
  private initialized = false;

  constructor(config?: CodePluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;

    const pluginCfg = (context.pluginConfig?.code ?? {}) as Record<string, unknown>;

    const defaults: CodePluginConfig = {
      enableCodeGraph: true,
      codeGraphProjectRoot: context.rootPath,
      scanPatterns: [
        "src/**/*.ts",
        "src/**/*.tsx",
        "src/**/*.js",
        "src/**/*.jsx",
        "*.ts",
        "*.tsx",
        "*.js",
        "*.jsx",
      ],
      testPatterns: [
        "tests/**/*.test.ts",
        "tests/**/*.spec.ts",
        "__tests__/**/*.test.ts",
        "spec/**/*.spec.ts",
      ],
      buildCommands: ["build"],
      lintCommands: ["lint"],
      testCommands: ["test"],
      fallbackToLightweight: true,
    };

    const constructorCfg = this.config;
    const runtimeCfg = {
      enableCodeGraph:
        (pluginCfg.enableCodeGraph as boolean | undefined) ??
        constructorCfg.enableCodeGraph ??
        defaults.enableCodeGraph,
      codeGraphProjectRoot:
        (pluginCfg.codeGraphProjectRoot as string | undefined) ??
        constructorCfg.codeGraphProjectRoot ??
        defaults.codeGraphProjectRoot,
      scanPatterns:
        (pluginCfg.scanPatterns as string[] | undefined) ??
        constructorCfg.scanPatterns ??
        defaults.scanPatterns,
      testPatterns:
        (pluginCfg.testPatterns as string[] | undefined) ??
        constructorCfg.testPatterns ??
        defaults.testPatterns,
      buildCommands:
        (pluginCfg.buildCommands as string[] | undefined) ??
        constructorCfg.buildCommands ??
        defaults.buildCommands,
      lintCommands:
        (pluginCfg.lintCommands as string[] | undefined) ??
        constructorCfg.lintCommands ??
        defaults.lintCommands,
      testCommands:
        (pluginCfg.testCommands as string[] | undefined) ??
        constructorCfg.testCommands ??
        defaults.testCommands,
      fallbackToLightweight:
        (pluginCfg.fallbackToLightweight as boolean | undefined) ??
        constructorCfg.fallbackToLightweight ??
        defaults.fallbackToLightweight,
    };
    this.config = runtimeCfg;

    if (this.config.enableCodeGraph) {
      const cgConfig: CodeGraphProviderConfig = {
        projectRoot: this.config.codeGraphProjectRoot ?? context.rootPath,
      };
      this.codeGraphProvider = new CodeGraphProvider(cgConfig);
      const status = await this.codeGraphProvider.initialize();

      if (status === "not_indexed") {
        await this.codeGraphProvider.indexProject();
      }

      if (status === "unavailable" && !this.config.fallbackToLightweight) {
        throw new Error("CodeGraph CLI is not available and fallback is disabled");
      }
    }

    this.initialized = true;
  }

  async destroy(): Promise<void> {
    this.codeGraphProvider = null;
    this.initialized = false;
  }

  getCodeGraphProvider(): CodeGraphProvider | null {
    return this.codeGraphProvider;
  }

  isCodeGraphAvailable(): boolean {
    return this.codeGraphProvider?.isAvailable() ?? false;
  }

  getCapabilityProviders(): CapabilityProvider[] {
    return [
      {
        capability: "scanner" as const,
        scan: (rootPath: string, prompt?: string) => this.scanProject(rootPath, prompt),
      },
      {
        capability: "context-builder" as const,
        enrichContext: (context: Record<string, unknown>) => this.buildCodeContext(context),
      },
      {
        capability: "planner-hint" as const,
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator" as const,
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateCodeArtifacts(params),
      },
      {
        capability: "artifact-detector" as const,
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectCodeArtifacts(params),
      },
    ];
  }

  // ── Scan Project ────────────────────────────────────

  private async scanProject(
    rootPath: string,
    _prompt?: string,
  ): Promise<{
    type: "code";
    languages: string[];
    frameworks: string[];
    packageManager: string | null;
    buildTool: string | null;
    testFramework: string | null;
    entryPoints: string[];
    scripts: string[];
    srcFiles: number;
    testFiles: number;
    configFiles: string[];
    hasCodeGraph: boolean;
    codeGraphStatus: string;
  }> {
    const hasPackageJson = await fileExists(path.join(rootPath, "package.json"));
    let packageManager: string | null = null;
    const frameworks: string[] = [];
    let scripts: string[] = [];
    let testFramework: string | null = null;
    let buildTool: string | null = null;

    if (hasPackageJson) {
      try {
        const content = await readTextFile(path.join(rootPath, "package.json"));
        const pkg = JSON.parse(content) as Record<string, unknown>;

        const pkgScripts = pkg.scripts as Record<string, string> | undefined;
        if (pkgScripts) {
          scripts = Object.keys(pkgScripts);
          for (const [, cmd] of Object.entries(pkgScripts)) {
            if (cmd.includes("vitest") || cmd.includes("jest") || cmd.includes("mocha")) {
              testFramework = cmd.includes("vitest")
                ? "vitest"
                : cmd.includes("jest")
                  ? "jest"
                  : "mocha";
            }
            if (cmd.includes("tsup") || cmd.includes("esbuild") || cmd.includes("webpack")) {
              buildTool = cmd.includes("tsup")
                ? "tsup"
                : cmd.includes("esbuild")
                  ? "esbuild"
                  : "webpack";
            }
          }
        }

        const deps = {
          ...(pkg.dependencies as Record<string, string> | undefined),
          ...(pkg.devDependencies as Record<string, string> | undefined),
        };
        if (deps) {
          if (deps.next) frameworks.push("next");
          if (deps.react) frameworks.push("react");
          if (deps.vue) frameworks.push("vue");
          if (deps.express) frameworks.push("express");
          if (deps["@nestjs/core"]) frameworks.push("nestjs");
        }
      } catch {
        // ignore
      }
    }

    if (await fileExists(path.join(rootPath, "pnpm-lock.yaml"))) {
      packageManager = "pnpm";
    } else if (await fileExists(path.join(rootPath, "yarn.lock"))) {
      packageManager = "yarn";
    } else if (await fileExists(path.join(rootPath, "package-lock.json"))) {
      packageManager = "npm";
    }

    let entryPoints: string[] = [];
    if (this.codeGraphProvider) {
      entryPoints = await this.codeGraphProvider.findEntryPoints();
    }

    const srcPatterns = this.config.scanPatterns ?? [
      "src/**/*.ts",
      "src/**/*.tsx",
      "src/**/*.js",
      "src/**/*.jsx",
    ];
    const testPatterns = this.config.testPatterns ?? ["tests/**/*.test.ts", "tests/**/*.spec.ts"];

    const srcFiles = new Set<string>();
    for (const pattern of srcPatterns) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) srcFiles.add(f);
    }

    const testFiles = new Set<string>();
    for (const pattern of testPatterns) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) testFiles.add(f);
    }

    const configFiles: string[] = [];
    const configCandidates = [
      "tsconfig.json",
      ".eslintrc.js",
      ".eslintrc.json",
      ".prettierrc",
      "package.json",
      "vitest.config.ts",
      "jest.config.ts",
      "jest.config.js",
    ];
    for (const cf of configCandidates) {
      if (await fileExists(path.join(rootPath, cf))) {
        configFiles.push(cf);
      }
    }

    const languages = ["typescript", "javascript"];
    const codeGraphStatus = this.codeGraphProvider
      ? this.codeGraphProvider.getStatus()
      : "unavailable";

    return {
      type: "code",
      languages,
      frameworks: [...new Set(frameworks)],
      packageManager,
      buildTool,
      testFramework,
      entryPoints,
      scripts,
      srcFiles: srcFiles.size,
      testFiles: testFiles.size,
      configFiles,
      hasCodeGraph: this.codeGraphProvider?.isAvailable() ?? false,
      codeGraphStatus,
    };
  }

  // ── Build Code Context ──────────────────────────────

  private async buildCodeContext(
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const enriched: Record<string, unknown> = { ...context };
    const codeFiles = context.codeFiles as string[] | undefined;

    if (codeFiles && codeFiles.length > 0 && this.codeGraphProvider) {
      const codeContext = await this.codeGraphProvider.buildCodeContext(codeFiles);

      enriched.codeContext = codeContext;
      enriched.codeGraphAvailable = this.codeGraphProvider.isAvailable();

      if (codeContext.relevantFiles.length > 0) {
        enriched.relevantFiles = codeContext.relevantFiles;
      }

      if (codeContext.relatedTests.length > 0) {
        enriched.relatedTests = codeContext.relatedTests;
      }

      if (codeContext.entryPoints.length > 0) {
        enriched.entryPoints = codeContext.entryPoints;
      }
    }

    return enriched;
  }

  // ── Generate Planning Hints ─────────────────────────

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isCodeTask =
      lower.includes("code") ||
      lower.includes("implement") ||
      lower.includes("fix") ||
      lower.includes("refactor") ||
      lower.includes("test") ||
      lower.includes("build") ||
      lower.includes("feature") ||
      lower.includes("function") ||
      lower.includes("api") ||
      lower.includes("component") ||
      lower.includes("module");

    if (!isCodeTask) return hints;

    hints.push("This is a code-related task. Use CodeGraph for code intelligence context.");
    hints.push("Scan project structure to identify relevant source files and tests.");
    hints.push("Run tests and lint after code changes to verify correctness.");

    if (this.codeGraphProvider?.isAvailable()) {
      hints.push(
        "CodeGraph is available. Use it for symbol lookup, import graph, and impact analysis.",
      );
    } else {
      hints.push("CodeGraph CLI is not available. Falling back to lightweight file scanning.");
    }

    return hints;
  }

  // ── Validate Code Artifacts ─────────────────────────

  private async validateCodeArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const srcDir = path.join(this.projectRoot, "src");
    const exists = await fileExists(srcDir);
    if (!exists) {
      return { valid: true, message: "No src directory to validate" };
    }

    const configFiles = ["tsconfig.json"];
    for (const cf of configFiles) {
      if (!(await fileExists(path.join(this.projectRoot, cf)))) {
        return {
          valid: false,
          message: `Missing config file: ${cf}`,
        };
      }
    }

    return { valid: true, message: "Code project structure is valid" };
  }

  // ── Detect Code Artifacts ───────────────────────────

  private async detectCodeArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const pkgPath = path.join(this.projectRoot, "package.json");
    if (await fileExists(pkgPath)) {
      artifacts.push({
        type: "config",
        path: "package.json",
        summary: "Project manifest with dependencies and scripts",
      });
    }

    const tsconfigPath = path.join(this.projectRoot, "tsconfig.json");
    if (await fileExists(tsconfigPath)) {
      artifacts.push({
        type: "config",
        path: "tsconfig.json",
        summary: "TypeScript configuration",
      });
    }

    if (this.codeGraphProvider?.isAvailable()) {
      const status = this.codeGraphProvider.getStatus();
      artifacts.push({
        type: "codegraph-index",
        path: ".codegraph/",
        summary: `CodeGraph index: ${status}`,
      });
    }

    return artifacts;
  }
}
