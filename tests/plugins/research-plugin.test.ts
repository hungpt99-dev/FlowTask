import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ResearchPlugin, RESEARCH_PLUGIN_ID } from "../../src/plugins/research-plugin.js";
import { PluginManager } from "../../src/core/plugin-manager.js";
import type { PluginContext } from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "research-plugin-test-"));
  mkdirSync(path.join(dir, "research"), { recursive: true });
  return dir;
}

function writeFixture(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("ResearchPlugin", () => {
  let projectDir: string;
  let defaultConfig: FlowTaskConfig;

  beforeAll(() => {
    defaultConfig = generateDefaultConfig();
    projectDir = createTempProject();
    writeFixture(projectDir, "research/findings.md", "# Research Findings\n\nKey findings.\n");
    writeFixture(
      projectDir,
      "research/sources.json",
      JSON.stringify({ sources: ["source1", "source2"] }),
    );
    writeFixture(projectDir, "notes/meeting-notes.md", "# Meeting Notes\n\nDiscussed X.\n");
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("instantiation and meta", () => {
    it("should have correct metadata", () => {
      const plugin = new ResearchPlugin();
      expect(plugin.meta.id).toBe(RESEARCH_PLUGIN_ID);
      expect(plugin.meta.name).toBe("Research Plugin");
      expect(plugin.meta.version).toBe("1.0.0");
      expect(plugin.meta.capabilities).toContain("scanner");
      expect(plugin.meta.capabilities).toContain("planner-hint");
      expect(plugin.meta.capabilities).toContain("validator");
      expect(plugin.meta.capabilities).toContain("artifact-detector");
    });

    it("should register with PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new ResearchPlugin();
      manager.register(plugin);
      expect(manager.hasPlugin(RESEARCH_PLUGIN_ID)).toBe(true);
    });
  });

  describe("capability providers", () => {
    it("should scan research context", async () => {
      const plugin = new ResearchPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const scanner = providers.find((p) => p.capability === "scanner")!;
      const result = (await scanner.scan(projectDir)) as Record<string, unknown>;

      expect(result.type).toBe("research");
      expect(result.researchDirs).toContain("research");
      expect(result.researchFiles).toBeGreaterThanOrEqual(1);
      expect(result.hasSources).toBe(true);
    });

    it("should generate planning hints for research tasks", async () => {
      const plugin = new ResearchPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("research the best approach");
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty hints for non-research tasks", async () => {
      const plugin = new ResearchPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("deploy to production");
      expect(hints.length).toBe(0);
    });

    it("should validate research directories", async () => {
      const plugin = new ResearchPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const validator = providers.find((p) => p.capability === "validator")!;
      const result = await validator.validate({ runId: "test-run" });
      expect(result.valid).toBe(true);
    });

    it("should detect research artifacts", async () => {
      const plugin = new ResearchPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const detector = providers.find((p) => p.capability === "artifact-detector")!;
      const artifacts = await detector.detectArtifacts({ runId: "test-run" });
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
    });
  });
});
