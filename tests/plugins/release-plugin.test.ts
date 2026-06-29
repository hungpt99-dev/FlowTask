import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ReleasePlugin, RELEASE_PLUGIN_ID } from "../../src/plugins/release-plugin.js";
import { PluginManager } from "../../src/core/plugin-manager.js";
import type { PluginContext } from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "release-plugin-test-"));
  mkdirSync(path.join(dir, "deploy"), { recursive: true });
  return dir;
}

function writeFixture(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("ReleasePlugin", () => {
  let projectDir: string;
  let defaultConfig: FlowTaskConfig;

  beforeAll(() => {
    defaultConfig = generateDefaultConfig();
    projectDir = createTempProject();
    writeFixture(projectDir, "CHANGELOG.md", "# Changelog\n\n## v1.0.0\n\nInitial release.\n");
    writeFixture(projectDir, "deploy/deploy.sh", "#!/bin/bash\necho 'Deploying...'\n");
    writeFixture(projectDir, "deploy/config.yml", "environment: production\nregion: us-east-1\n");
    writeFixture(projectDir, "package.json", JSON.stringify({ name: "test", version: "1.0.0" }));
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("instantiation and meta", () => {
    it("should have correct metadata", () => {
      const plugin = new ReleasePlugin();
      expect(plugin.meta.id).toBe(RELEASE_PLUGIN_ID);
      expect(plugin.meta.name).toBe("Release Plugin");
      expect(plugin.meta.version).toBe("1.0.0");
      expect(plugin.meta.capabilities).toContain("scanner");
      expect(plugin.meta.capabilities).toContain("planner-hint");
      expect(plugin.meta.capabilities).toContain("validator");
      expect(plugin.meta.capabilities).toContain("artifact-detector");
    });

    it("should register with PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new ReleasePlugin();
      manager.register(plugin);
      expect(manager.hasPlugin(RELEASE_PLUGIN_ID)).toBe(true);
    });
  });

  describe("capability providers", () => {
    it("should scan release context", async () => {
      const plugin = new ReleasePlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const scanner = providers.find((p) => p.capability === "scanner")!;
      const result = (await scanner.scan(projectDir)) as Record<string, unknown>;

      expect(result.type).toBe("release");
      expect(result.hasChangelog).toBe(true);
      expect(result.hasDeployScripts).toBe(true);
      expect(result.deploymentConfigs).toContain("deploy/");
    });

    it("should generate planning hints for release tasks", async () => {
      const plugin = new ReleasePlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("prepare a release for version 2.0");
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty hints for non-release tasks", async () => {
      const plugin = new ReleasePlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("write unit tests for the API");
      expect(hints.length).toBe(0);
    });

    it("should validate release configuration", async () => {
      const plugin = new ReleasePlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const validator = providers.find((p) => p.capability === "validator")!;
      const result = await validator.validate({ runId: "test-run" });
      expect(result.valid).toBe(true);
    });

    it("should detect release artifacts", async () => {
      const plugin = new ReleasePlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const detector = providers.find((p) => p.capability === "artifact-detector")!;
      const artifacts = await detector.detectArtifacts({ runId: "test-run" });
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.some((a) => a.type === "release-changelog")).toBe(true);
    });
  });
});
