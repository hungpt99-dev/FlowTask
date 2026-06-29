import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OperationsPlugin, OPS_PLUGIN_ID } from "../../src/plugins/operations-plugin.js";
import { PluginManager } from "../../src/core/plugin-manager.js";
import type { PluginContext } from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ops-plugin-test-"));
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  mkdirSync(path.join(dir, "config"), { recursive: true });
  mkdirSync(path.join(dir, "monitoring"), { recursive: true });
  mkdirSync(path.join(dir, "runbooks"), { recursive: true });
  return dir;
}

function writeFixture(dir: string, filePath: string, content: string): void {
  const fullPath = path.join(dir, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("OperationsPlugin", () => {
  let projectDir: string;
  let defaultConfig: FlowTaskConfig;

  beforeAll(() => {
    defaultConfig = generateDefaultConfig();
    projectDir = createTempProject();
    writeFixture(projectDir, "scripts/backup.sh", "#!/bin/bash\necho 'Backing up...'\n");
    writeFixture(projectDir, "scripts/health-check.sh", "#!/bin/bash\necho 'Health OK'\n");
    writeFixture(projectDir, "config/app.yml", "app:\n  name: test\n  port: 8080\n");
    writeFixture(projectDir, "monitoring/alerts.yml", "alerts:\n  - cpu: 90%\n");
    writeFixture(
      projectDir,
      "runbooks/incident-response.md",
      "# Incident Response\n\nStep 1: Check logs.\n",
    );
    writeFixture(projectDir, "Makefile", ".PHONY: deploy\n\ndeploy:\n\techo 'deploy'\n");
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("instantiation and meta", () => {
    it("should have correct metadata", () => {
      const plugin = new OperationsPlugin();
      expect(plugin.meta.id).toBe(OPS_PLUGIN_ID);
      expect(plugin.meta.name).toBe("Operations Plugin");
      expect(plugin.meta.version).toBe("1.0.0");
      expect(plugin.meta.capabilities).toContain("scanner");
      expect(plugin.meta.capabilities).toContain("planner-hint");
      expect(plugin.meta.capabilities).toContain("validator");
      expect(plugin.meta.capabilities).toContain("artifact-detector");
    });

    it("should register with PluginManager", () => {
      const manager = new PluginManager();
      const plugin = new OperationsPlugin();
      manager.register(plugin);
      expect(manager.hasPlugin(OPS_PLUGIN_ID)).toBe(true);
    });
  });

  describe("capability providers", () => {
    it("should scan ops context", async () => {
      const plugin = new OperationsPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const scanner = providers.find((p) => p.capability === "scanner")!;
      const result = (await scanner.scan(projectDir)) as Record<string, unknown>;

      expect(result.type).toBe("operations");
      expect(result.opsDirs).toContain("scripts");
      expect(result.opsDirs).toContain("config");
      expect(result.opsDirs).toContain("monitoring");
      expect(result.opsDirs).toContain("runbooks");
      expect(result.scriptCount).toBeGreaterThanOrEqual(2);
      expect(result.hasMakefile).toBe(true);
      expect(result.hasRunbooks).toBe(true);
      expect(result.hasMonitoring).toBe(true);
    });

    it("should generate planning hints for ops tasks", async () => {
      const plugin = new OperationsPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("set up monitoring for the production server");
      expect(hints.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty hints for non-ops tasks", async () => {
      const plugin = new OperationsPlugin();
      const providers = plugin.getCapabilityProviders();
      const hintProvider = providers.find((p) => p.capability === "planner-hint")!;

      const hints = await hintProvider.getHints("write documentation for the API");
      expect(hints.length).toBe(0);
    });

    it("should validate ops configuration", async () => {
      const plugin = new OperationsPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const validator = providers.find((p) => p.capability === "validator")!;
      const result = await validator.validate({ runId: "test-run" });
      expect(result.valid).toBe(true);
    });

    it("should detect ops artifacts", async () => {
      const plugin = new OperationsPlugin();
      const context: PluginContext = { rootPath: projectDir, config: defaultConfig };
      await plugin.init(context);

      const providers = plugin.getCapabilityProviders();
      const detector = providers.find((p) => p.capability === "artifact-detector")!;
      const artifacts = await detector.detectArtifacts({ runId: "test-run" });
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.some((a) => a.type === "ops-makefile")).toBe(true);
    });
  });
});
