import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DesignPlugin, DESIGN_PLUGIN_ID } from "../../src/plugins/design-plugin.js";
import { PluginManager } from "../../src/core/plugin-manager.js";
import type { PluginContext } from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "design-plugin-test-"));
  mkdirSync(path.join(dir, "design"), { recursive: true });
  mkdirSync(path.join(dir, "screenshots"), { recursive: true });
  return dir;
}

function writeFixture(dir: string, filePath: string, _content?: string): void {
  const fullPath = path.join(dir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, _content ?? "placeholder", "utf-8");
}

describe("DesignPlugin", () => {
  let projectDir: string;
  let defaultConfig: FlowTaskConfig;

  beforeAll(() => {
    defaultConfig = generateDefaultConfig();
    projectDir = createTempProject();
    writeFixture(projectDir, "design/mockup.png");
    writeFixture(
      projectDir,
      "design/wireframe.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    writeFixture(projectDir, "screenshots/v1.png");
    writeFixture(projectDir, "screenshots/v2.png");
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("instantiation and meta", () => {
    it("should have correct metadata", () => {
      const plugin = new DesignPlugin();
      expect(plugin.meta.id).toBe(DESIGN_PLUGIN_ID);
      expect(plugin.meta.name).toBe("Design Plugin");
      expect(plugin.meta.version).toBe("1.0.0");
      expect(plugin.meta.capabilities).toContain("scanner");
      expect(plugin.meta.capabilities).toContain("planner-hint");
      expect(plugin.meta.capabilities).toContain("validator");
      expect(plugin.meta.capabilities).toContain("artifact-detector");
    });

    it("should register with PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new DesignPlugin();
      manager.register(plugin);
      expect(manager.hasPlugin(DESIGN_PLUGIN_ID)).toBe(true);
    });
  });

  describe("capability providers", () => {
    it("should scan design assets", async () => {
      const plugin = new DesignPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const scanner = providers.find((p) => p.capability === "scanner")!;
      const result = (await scanner.scan(projectDir)) as Record<string, unknown>;

      expect(result.type).toBe("design");
      expect(result.imageCount).toBeGreaterThanOrEqual(2);
      expect(result.totalAssets).toBeGreaterThanOrEqual(3);
      expect(result.designDirs).toContain("design");
      expect(result.designDirs).toContain("screenshots");
    });

    it("should generate planning hints for design tasks", async () => {
      const plugin = new DesignPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("design a new landing page");
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty hints for non-design tasks", async () => {
      const plugin = new DesignPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("fix a bug in the API");
      expect(hints.length).toBe(0);
    });

    it("should validate design directory", async () => {
      const plugin = new DesignPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const validator = providers.find((p) => p.capability === "validator")!;
      const result = await validator.validate({ runId: "test-run" });
      expect(result.valid).toBe(true);
    });

    it("should detect design artifacts", async () => {
      const plugin = new DesignPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const detector = providers.find((p) => p.capability === "artifact-detector")!;
      const artifacts = await detector.detectArtifacts({ runId: "test-run" });
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.some((a) => a.type === "design-image")).toBe(true);
    });
  });
});
