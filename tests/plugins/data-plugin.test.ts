import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DataPlugin, DATA_PLUGIN_ID } from "../../src/plugins/data-plugin.js";
import { PluginManager } from "../../src/core/plugin-manager.js";
import type { PluginContext } from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "data-plugin-test-"));
  mkdirSync(path.join(dir, "data"), { recursive: true });
  return dir;
}

function writeFixture(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("DataPlugin", () => {
  let projectDir: string;
  let defaultConfig: FlowTaskConfig;

  beforeAll(() => {
    defaultConfig = generateDefaultConfig();
    projectDir = createTempProject();
    writeFixture(
      projectDir,
      "data/users.csv",
      "id,name,email\n1,Alice,alice@test.com\n2,Bob,bob@test.com\n",
    );
    writeFixture(projectDir, "data/config.json", JSON.stringify({ settings: { debug: true } }));
    writeFixture(projectDir, "data/items.yaml", "items:\n  - name: item1\n  - name: item2\n");
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("instantiation and meta", () => {
    it("should have correct metadata", () => {
      const plugin = new DataPlugin();
      expect(plugin.meta.id).toBe(DATA_PLUGIN_ID);
      expect(plugin.meta.name).toBe("Data Plugin");
      expect(plugin.meta.version).toBe("1.0.0");
      expect(plugin.meta.capabilities).toContain("scanner");
      expect(plugin.meta.capabilities).toContain("planner-hint");
      expect(plugin.meta.capabilities).toContain("validator");
      expect(plugin.meta.capabilities).toContain("artifact-detector");
    });

    it("should register with PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new DataPlugin();
      manager.register(plugin);
      expect(manager.hasPlugin(DATA_PLUGIN_ID)).toBe(true);
    });
  });

  describe("capability providers", () => {
    it("should scan data files", async () => {
      const plugin = new DataPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const scanner = providers.find((p) => p.capability === "scanner")!;
      const result = (await scanner.scan(projectDir)) as Record<string, unknown>;

      expect(result.type).toBe("data");
      expect(result.totalFiles).toBeGreaterThanOrEqual(3);
      expect(result.hasDataDir).toBe(true);
      expect(result.dataDirs).toContain("data");
      expect(result.schemaDetected).toBe(true);
    });

    it("should generate planning hints for data tasks", async () => {
      const plugin = new DataPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("transform the CSV data into JSON");
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty hints for non-data tasks", async () => {
      const plugin = new DataPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("write a blog post");
      expect(hints.length).toBe(0);
    });

    it("should validate data directory", async () => {
      const plugin = new DataPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const validator = providers.find((p) => p.capability === "validator")!;
      const result = await validator.validate({ runId: "test-run" });
      expect(result.valid).toBe(true);
    });

    it("should detect data artifacts", async () => {
      const plugin = new DataPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const detector = providers.find((p) => p.capability === "artifact-detector")!;
      const artifacts = await detector.detectArtifacts({ runId: "test-run" });
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.some((a) => a.type === "data-csv")).toBe(true);
    });
  });
});
