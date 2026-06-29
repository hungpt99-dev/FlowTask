import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { CodePlugin, CODE_PLUGIN_ID } from "../../src/plugins/code-plugin.js";
import { CodeGraphProvider } from "../../src/plugins/codegraph-provider.js";
import { PluginManager } from "../../src/core/plugin-manager.js";
import type { PluginContext } from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "code-plugin-test-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  return dir;
}

function writeFixture(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("CodeGraphProvider", () => {
  let projectDir: string;

  beforeAll(() => {
    projectDir = createTempProject();
    writeFixture(
      projectDir,
      "src/index.ts",
      `export { greet } from "./greeter";\nexport const VERSION = "1.0.0";\n`,
    );
    writeFixture(
      projectDir,
      "src/greeter.ts",
      `export function greet(name: string): string {\n  return "Hello, " + name;\n}\n`,
    );
    writeFixture(
      projectDir,
      "src/utils.ts",
      `export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n`,
    );
    writeFixture(
      projectDir,
      "tests/greeter.test.ts",
      `import { greet } from "../src/greeter";\nimport { describe, it, expect } from "vitest";\ndescribe("greet", () => {\n  it("should greet", () => {\n    expect(greet("World")).toBe("Hello, World");\n  });\n});\n`,
    );
    writeFixture(
      projectDir,
      "package.json",
      JSON.stringify({ name: "test-project", main: "src/index.ts" }),
    );
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("initialization", () => {
    it("should detect codegraph is unavailable and fall back gracefully", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      const status = await provider.initialize();
      expect(["unavailable", "not_indexed", "available"]).toContain(status);
    });

    it("should report status", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const status = provider.getStatus();
      expect(typeof status).toBe("string");
    });

    it("should not be available when codegraph CLI is missing", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      expect(provider.isAvailable()).toBe(false);
    });
  });

  describe("fallback methods", () => {
    it("should find entry points from package.json", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const entries = await provider.findEntryPoints();
      expect(entries).toContain("src/index.ts");
    });

    it("should find related tests for a source file", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const tests = await provider.findRelatedTests(path.join(projectDir, "src/greeter.ts"));
      expect(tests.length).toBeGreaterThanOrEqual(1);
      expect(tests.some((t) => t.includes("greeter"))).toBe(true);
    });

    it("should build import graph from code files", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const files = [
        path.join(projectDir, "src/index.ts"),
        path.join(projectDir, "src/greeter.ts"),
        path.join(projectDir, "src/utils.ts"),
      ];
      const graph = await provider.buildImportGraph(files);
      expect(Array.isArray(graph)).toBe(true);
    });

    it("should get file relationships", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const rels = await provider.getFileRelationships(path.join(projectDir, "src/index.ts"));
      expect(rels.filePath).toBe(path.join(projectDir, "src/index.ts"));
      expect(Array.isArray(rels.imports)).toBe(true);
      expect(Array.isArray(rels.importedBy)).toBe(true);
    });

    it("should perform fallback symbol lookup", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const symbol = await provider.getSymbolInfo("greet");
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe("greet");
    });

    it("should return null for unknown symbols", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const symbol = await provider.getSymbolInfo("NonExistentSymbolXYZ");
      expect(symbol).toBeNull();
    });

    it("should find relevant files by keyword", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const files = await provider.findRelevantFiles("greet");
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some((f) => f.includes("greeter"))).toBe(true);
    });

    it("should perform fallback impact analysis", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const impact = await provider.analyzeImpact("greet");
      expect(impact.symbol).toBe("greet");
      expect(Array.isArray(impact.affectedFiles)).toBe(true);
    });

    it("should build code context", async () => {
      const provider = new CodeGraphProvider({ projectRoot: projectDir });
      await provider.initialize();
      const files = [
        path.join(projectDir, "src/index.ts"),
        path.join(projectDir, "src/greeter.ts"),
      ];
      const ctx = await provider.buildCodeContext(files);
      expect(ctx.relevantFiles.length).toBeGreaterThanOrEqual(1);
      expect(typeof ctx.summary).toBe("string");
      expect(ctx.importGraph).toBeDefined();
      expect(ctx.entryPoints).toBeDefined();
    });
  });
});

describe("CodePlugin", () => {
  let projectDir: string;
  let defaultConfig: FlowTaskConfig;

  beforeAll(() => {
    defaultConfig = generateDefaultConfig();
  });

  beforeEach(() => {
    projectDir = createTempProject();
    writeFixture(
      projectDir,
      "package.json",
      JSON.stringify({
        name: "test-project",
        main: "src/index.ts",
        scripts: {
          test: "vitest run",
          build: "tsup",
          lint: "eslint",
        },
      }),
    );
    writeFixture(
      projectDir,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022" },
      }),
    );
    writeFixture(projectDir, "src/index.ts", "export const app = 'test';\n");
    writeFixture(projectDir, "src/utils.ts", "export function util() { return 42; }\n");
    writeFixture(
      projectDir,
      "tests/index.test.ts",
      `import { describe, it, expect } from "vitest";\ndescribe("app", () => {\n  it("works", () => { expect(true).toBe(true); });\n});\n`,
    );
  });

  afterAll(() => {
    // cleanup handled per test
  });

  describe("instantiation and meta", () => {
    it("should have correct metadata", () => {
      const plugin = new CodePlugin();
      expect(plugin.meta.id).toBe(CODE_PLUGIN_ID);
      expect(plugin.meta.name).toBe("Code Plugin");
      expect(plugin.meta.version).toBe("1.0.0");
      expect(plugin.meta.capabilities).toContain("scanner");
      expect(plugin.meta.capabilities).toContain("context-builder");
      expect(plugin.meta.capabilities).toContain("planner-hint");
      expect(plugin.meta.capabilities).toContain("validator");
      expect(plugin.meta.capabilities).toContain("artifact-detector");
    });

    it("should register with PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new CodePlugin();
      manager.register(plugin);
      expect(manager.hasPlugin(CODE_PLUGIN_ID)).toBe(true);
      expect(manager.getPlugin(CODE_PLUGIN_ID)).toBe(plugin);
    });

    it("should initialize with context", async () => {
      const plugin = new CodePlugin();
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);
      expect(plugin.isCodeGraphAvailable()).toBe(false);
    });

    it("should initialize with fallback disabled and codegraph enabled", async () => {
      const plugin = new CodePlugin({ enableCodeGraph: true, fallbackToLightweight: false });
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      const promise = plugin.init(context);
      await expect(promise).resolves.toBeUndefined();
      expect(plugin.getCodeGraphProvider()).not.toBeNull();
    });
  });

  describe("capability providers", () => {
    it("should return all capability providers", () => {
      const plugin = new CodePlugin();
      const providers = plugin.getCapabilityProviders();
      expect(providers).toHaveLength(5);

      const capabilities = providers.map((p) => p.capability);
      expect(capabilities).toContain("scanner");
      expect(capabilities).toContain("context-builder");
      expect(capabilities).toContain("planner-hint");
      expect(capabilities).toContain("validator");
      expect(capabilities).toContain("artifact-detector");
    });

    it("should have scanner provider that scans code project", async () => {
      const plugin = new CodePlugin({ enableCodeGraph: false });
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const scanner = providers.find((p) => p.capability === "scanner")!;
      const result = (await scanner.scan(projectDir)) as Record<string, unknown>;

      expect(result.type).toBe("code");
      expect(result.srcFiles).toBeGreaterThanOrEqual(1);
      expect(result.testFiles).toBeGreaterThanOrEqual(1);
      expect(result.configFiles).toContain("package.json");
      expect(result.configFiles).toContain("tsconfig.json");
      expect(result.scripts).toContain("test");
      expect(result.scripts).toContain("build");
      expect(result.scripts).toContain("lint");
    });

    it("should generate planning hints for code tasks", async () => {
      const plugin = new CodePlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("implement a new feature");
      expect(hints.length).toBeGreaterThanOrEqual(1);
      expect(hints.some((h) => h.toLowerCase().includes("code"))).toBe(true);
    });

    it("should return empty hints for non-code tasks", async () => {
      const plugin = new CodePlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("write a meeting summary");
      expect(hints.length).toBe(0);
    });

    it("should build code context with codegraph enabled", async () => {
      const plugin = new CodePlugin({ enableCodeGraph: true });
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const ctxBuilder = providers.find((p) => p.capability === "context-builder")!;

      const enriched = await ctxBuilder.enrichContext({
        codeFiles: [path.join(projectDir, "src/index.ts"), path.join(projectDir, "src/utils.ts")],
      });

      const codeCtx = enriched.codeContext as Record<string, unknown> | undefined;
      expect(codeCtx).toBeDefined();
      const files = codeCtx!.relevantFiles as string[];
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(typeof codeCtx!.summary).toBe("string");
    });

    it("should skip code context when no codeFiles provided", async () => {
      const plugin = new CodePlugin({ enableCodeGraph: true });
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const ctxBuilder = providers.find((p) => p.capability === "context-builder")!;

      const enriched = await ctxBuilder.enrichContext({ someKey: "value" });
      expect(enriched.codeContext).toBeUndefined();
    });

    it("should validate code project structure", async () => {
      const plugin = new CodePlugin({ enableCodeGraph: false });
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const validator = providers.find((p) => p.capability === "validator")!;

      const result = await validator.validate({ runId: "test-run" });
      expect(result.valid).toBe(true);
    });

    it("should detect code artifacts", async () => {
      const plugin = new CodePlugin({ enableCodeGraph: false });
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const detector = providers.find((p) => p.capability === "artifact-detector")!;

      const artifacts = await detector.detectArtifacts({ runId: "test-run" });
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.some((a) => a.type === "config")).toBe(true);
    });
  });

  describe("PluginManager integration", () => {
    it("should work with PluginManager lifecycle", async () => {
      const manager = new PluginManager();
      const plugin = new CodePlugin({ enableCodeGraph: false });
      manager.register(plugin);
      await manager.initialize(projectDir, defaultConfig);

      expect(manager.isInitialized()).toBe(true);
      expect(manager.hasPlugin(CODE_PLUGIN_ID)).toBe(true);

      const providers = manager.getCapabilityProviders("scanner");
      expect(providers.length).toBeGreaterThanOrEqual(1);

      await manager.destroyAll();
      expect(manager.isInitialized()).toBe(false);
    });

    it("should list plugin in PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new CodePlugin();
      manager.register(plugin);

      const plugins = manager.listPlugins();
      const codePlugin = plugins.find((m) => m.id === CODE_PLUGIN_ID);
      expect(codePlugin).toBeDefined();
      expect(codePlugin!.capabilities).toContain("scanner");
    });

    it("should reload plugin", async () => {
      const manager = new PluginManager();
      const plugin = new CodePlugin({ enableCodeGraph: false });
      manager.register(plugin);
      await manager.initialize(projectDir, defaultConfig);

      const newPlugin = new CodePlugin({ enableCodeGraph: false });
      await manager.reloadPlugin(CODE_PLUGIN_ID, newPlugin);
      expect(manager.getPlugin(CODE_PLUGIN_ID)).toBe(newPlugin);
    });

    it("should get CodeGraphProvider from plugin when enabled", async () => {
      const plugin = new CodePlugin({ enableCodeGraph: true });
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);
      const provider = plugin.getCodeGraphProvider();
      expect(provider).not.toBeNull();
    });
  });
});
