import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { QAPlugin, QA_PLUGIN_ID } from "../../src/plugins/qa-plugin.js";
import { PluginManager } from "../../src/core/plugin-manager.js";
import type { PluginContext } from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-plugin-test-"));
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  mkdirSync(path.join(dir, "qa"), { recursive: true });
  return dir;
}

function writeFixture(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("QAPlugin", () => {
  let projectDir: string;
  let defaultConfig: FlowTaskConfig;

  beforeAll(() => {
    defaultConfig = generateDefaultConfig();
    projectDir = createTempProject();
    writeFixture(
      projectDir,
      "tests/auth.test.ts",
      `import { describe, it, expect } from "vitest";\ndescribe("auth", () => {\n  it("works", () => { expect(true).toBe(true); });\n});\n`,
    );
    writeFixture(projectDir, "qa/test-plan.md", "# Test Plan\n\nCoverage plan for release v2.\n");
    writeFixture(
      projectDir,
      "package.json",
      JSON.stringify({
        name: "test",
        devDependencies: { vitest: "^1.0.0" },
      }),
    );
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("instantiation and meta", () => {
    it("should have correct metadata", () => {
      const plugin = new QAPlugin();
      expect(plugin.meta.id).toBe(QA_PLUGIN_ID);
      expect(plugin.meta.name).toBe("QA Plugin");
      expect(plugin.meta.version).toBe("1.0.0");
      expect(plugin.meta.capabilities).toContain("scanner");
      expect(plugin.meta.capabilities).toContain("planner-hint");
      expect(plugin.meta.capabilities).toContain("validator");
      expect(plugin.meta.capabilities).toContain("artifact-detector");
    });

    it("should register with PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new QAPlugin();
      manager.register(plugin);
      expect(manager.hasPlugin(QA_PLUGIN_ID)).toBe(true);
    });
  });

  describe("capability providers", () => {
    it("should scan QA context", async () => {
      const plugin = new QAPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const scanner = providers.find((p) => p.capability === "scanner")!;
      const result = (await scanner.scan(projectDir)) as Record<string, unknown>;

      expect(result.type).toBe("qa");
      expect(result.qaDirs).toContain("tests");
      expect(result.qaDirs).toContain("qa");
      expect(result.testFiles).toBeGreaterThanOrEqual(1);
      expect(result.testFrameworks).toContain("vitest");
    });

    it("should generate planning hints for QA tasks", async () => {
      const plugin = new QAPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("create test scenarios for the login feature");
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty hints for non-QA tasks", async () => {
      const plugin = new QAPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("design a new homepage");
      expect(hints.length).toBe(0);
    });

    it("should validate QA directories", async () => {
      const plugin = new QAPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const validator = providers.find((p) => p.capability === "validator")!;
      const result = await validator.validate({ runId: "test-run" });
      expect(result.valid).toBe(true);
    });

    it("should detect QA artifacts", async () => {
      const plugin = new QAPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const detector = providers.find((p) => p.capability === "artifact-detector")!;
      const artifacts = await detector.detectArtifacts({ runId: "test-run" });
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.some((a) => a.type === "qa-test")).toBe(true);
    });
  });
});
