import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WritingPlugin, WRITING_PLUGIN_ID } from "../../src/plugins/writing-plugin.js";
import { PluginManager } from "../../src/core/plugin-manager.js";
import type { PluginContext } from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "writing-plugin-test-"));
  mkdirSync(path.join(dir, "content"), { recursive: true });
  mkdirSync(path.join(dir, "blog"), { recursive: true });
  return dir;
}

function writeFixture(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("WritingPlugin", () => {
  let projectDir: string;
  let defaultConfig: FlowTaskConfig;

  beforeAll(() => {
    defaultConfig = generateDefaultConfig();
    projectDir = createTempProject();
    writeFixture(projectDir, "content/intro.md", "# Introduction\n\nWelcome to our product.\n");
    writeFixture(projectDir, "content/features.md", "# Features\n\nHere are the features.\n");
    writeFixture(projectDir, "blog/launch.md", "# Launch Post\n\nWe are launching today.\n");
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("instantiation and meta", () => {
    it("should have correct metadata", () => {
      const plugin = new WritingPlugin();
      expect(plugin.meta.id).toBe(WRITING_PLUGIN_ID);
      expect(plugin.meta.name).toBe("Writing Plugin");
      expect(plugin.meta.version).toBe("1.0.0");
      expect(plugin.meta.capabilities).toContain("scanner");
      expect(plugin.meta.capabilities).toContain("planner-hint");
      expect(plugin.meta.capabilities).toContain("validator");
      expect(plugin.meta.capabilities).toContain("artifact-detector");
    });

    it("should register with PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new WritingPlugin();
      manager.register(plugin);
      expect(manager.hasPlugin(WRITING_PLUGIN_ID)).toBe(true);
    });
  });

  describe("capability providers", () => {
    it("should scan writing files", async () => {
      const plugin = new WritingPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const scanner = providers.find((p) => p.capability === "scanner")!;
      const result = (await scanner.scan(projectDir)) as Record<string, unknown>;

      expect(result.type).toBe("writing");
      expect(result.totalFiles).toBeGreaterThanOrEqual(3);
      expect(result.writingDirs).toContain("content");
      expect(result.writingDirs).toContain("blog");
    });

    it("should generate planning hints for writing tasks", async () => {
      const plugin = new WritingPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("write a blog post about the new release");
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty hints for non-writing tasks", async () => {
      const plugin = new WritingPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("run database migration");
      expect(hints.length).toBe(0);
    });

    it("should validate content directory", async () => {
      const plugin = new WritingPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const validator = providers.find((p) => p.capability === "validator")!;
      const result = await validator.validate({ runId: "test-run" });
      expect(result.valid).toBe(true);
    });

    it("should detect writing artifacts", async () => {
      const plugin = new WritingPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const detector = providers.find((p) => p.capability === "artifact-detector")!;
      const artifacts = await detector.detectArtifacts({ runId: "test-run" });
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.some((a) => a.type === "writing-draft")).toBe(true);
    });
  });
});
