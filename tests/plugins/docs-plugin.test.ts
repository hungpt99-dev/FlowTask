import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DocsPlugin, DOCS_PLUGIN_ID } from "../../src/plugins/docs-plugin.js";
import { PluginManager } from "../../src/core/plugin-manager.js";
import type { PluginContext } from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "docs-plugin-test-"));
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  mkdirSync(path.join(dir, "src"), { recursive: true });
  return dir;
}

function writeFixture(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("DocsPlugin", () => {
  let projectDir: string;
  let defaultConfig: FlowTaskConfig;

  beforeAll(() => {
    defaultConfig = generateDefaultConfig();
  });

  beforeEach(() => {
    projectDir = createTempProject();
    writeFixture(projectDir, "README.md", "# Test Project\n\nThis is a test project.\n");
    writeFixture(projectDir, "docs/index.md", "# Documentation\n\nWelcome to the docs.\n");
    writeFixture(projectDir, "docs/guide.md", "# Guide\n\nThis is a guide.\n");
    writeFixture(projectDir, "src/index.ts", "export const app = 'test';\n");
  });

  afterAll(() => {
    // cleanup handled per test
  });

  describe("instantiation and meta", () => {
    it("should have correct metadata", () => {
      const plugin = new DocsPlugin();
      expect(plugin.meta.id).toBe(DOCS_PLUGIN_ID);
      expect(plugin.meta.name).toBe("Docs Plugin");
      expect(plugin.meta.version).toBe("1.0.0");
      expect(plugin.meta.capabilities).toContain("scanner");
      expect(plugin.meta.capabilities).toContain("planner-hint");
      expect(plugin.meta.capabilities).toContain("validator");
      expect(plugin.meta.capabilities).toContain("artifact-detector");
    });

    it("should register with PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new DocsPlugin();
      manager.register(plugin);
      expect(manager.hasPlugin(DOCS_PLUGIN_ID)).toBe(true);
      expect(manager.getPlugin(DOCS_PLUGIN_ID)).toBe(plugin);
    });

    it("should initialize with context", async () => {
      const plugin = new DocsPlugin();
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);
    });
  });

  describe("capability providers", () => {
    it("should return all capability providers", () => {
      const plugin = new DocsPlugin();
      const providers = plugin.getCapabilityProviders();
      expect(providers).toHaveLength(4);

      const capabilities = providers.map((p) => p.capability);
      expect(capabilities).toContain("scanner");
      expect(capabilities).toContain("planner-hint");
      expect(capabilities).toContain("validator");
      expect(capabilities).toContain("artifact-detector");
    });

    it("should scan documentation files", async () => {
      const plugin = new DocsPlugin();
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const scanner = providers.find((p) => p.capability === "scanner")!;
      const result = (await scanner.scan(projectDir)) as Record<string, unknown>;

      expect(result.type).toBe("docs");
      expect(result.docFiles).toBeGreaterThanOrEqual(2);
      expect(result.hasReadme).toBe(true);
      expect(result.hasDocsDir).toBe(true);
      expect(result.docDirs).toContain("docs");
    });

    it("should generate planning hints for docs tasks", async () => {
      const plugin = new DocsPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("write documentation for the API");
      expect(hints.length).toBeGreaterThanOrEqual(1);
      expect(hints.some((h) => h.toLowerCase().includes("document"))).toBe(true);
    });

    it("should return empty hints for non-docs tasks", async () => {
      const plugin = new DocsPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("implement a new feature");
      expect(hints.length).toBe(0);
    });

    it("should validate documentation structure", async () => {
      const plugin = new DocsPlugin();
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

    it("should detect documentation artifacts", async () => {
      const plugin = new DocsPlugin();
      const context: PluginContext = {
        rootPath: projectDir,
        config: defaultConfig,
      };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const detector = providers.find((p) => p.capability === "artifact-detector")!;

      const artifacts = await detector.detectArtifacts({ runId: "test-run" });
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.some((a) => a.type === "documentation")).toBe(true);
    });
  });

  describe("PluginManager integration", () => {
    it("should work with PluginManager lifecycle", async () => {
      const manager = new PluginManager();
      const plugin = new DocsPlugin();
      manager.register(plugin);
      await manager.initialize(projectDir, defaultConfig);

      expect(manager.isInitialized()).toBe(true);
      expect(manager.hasPlugin(DOCS_PLUGIN_ID)).toBe(true);

      await manager.destroyAll();
      expect(manager.isInitialized()).toBe(false);
    });

    it("should list plugin in PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new DocsPlugin();
      manager.register(plugin);

      const plugins = manager.listPlugins();
      const docsPlugin = plugins.find((m) => m.id === DOCS_PLUGIN_ID);
      expect(docsPlugin).toBeDefined();
      expect(docsPlugin!.capabilities).toContain("scanner");
    });
  });
});
