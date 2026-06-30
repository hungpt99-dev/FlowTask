import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigFileManager } from "../../src/ui/utils/ConfigFileManager.js";
import { atomicWriteJsonFile, readJsonFile } from "../../src/utils/fs.js";
import { configJsonPath } from "../../src/utils/paths.js";

let testDir: string;
let manager: ConfigFileManager;

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-config-test-"));
  manager = new ConfigFileManager(testDir);
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function writeConfig(data: Record<string, unknown>): Promise<void> {
  return atomicWriteJsonFile(configJsonPath(testDir), data, true);
}

describe("ConfigFileManager", () => {
  describe("read", () => {
    it("should throw when no config file exists", async () => {
      await expect(manager.read()).rejects.toThrow();
    });

    it("should read an existing config file", async () => {
      await writeConfig({
        version: "1.0",
        projectMode: "development",
      });
      const config = await manager.read();
      expect(config.version).toBe("1.0");
      expect(config.projectMode).toBe("development");
    });

    it("should return defaults for missing optional fields", async () => {
      await writeConfig({ version: "1.0", projectMode: "development" });
      const config = await manager.read();
      expect(config.defaultExecutor).toBe("opencode");
      expect(config.logLevel).toBe("info");
    });

    it("should reject invalid config", async () => {
      await writeConfig({ version: 123, projectMode: "invalid-mode" });
      await expect(manager.read()).rejects.toThrow(/validation|config/i);
    });
  });

  describe("validate", () => {
    it("should accept valid changes", async () => {
      const result = await manager.validate({ projectMode: "development" });
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should reject invalid changes", async () => {
      const result = await manager.validate({ projectMode: "nonexistent" as never });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("should accept empty changes", async () => {
      const result = await manager.validate({});
      expect(result.valid).toBe(true);
    });
  });

  describe("validateSection", () => {
    it("should accept valid provider config", async () => {
      const result = await manager.validateSection("ai", {
        providers: {
          custom: {
            type: "openai-compatible",
            baseUrl: "https://example.com/v1",
          },
        },
      });
      expect(result.valid).toBe(true);
    });

    it("should reject invalid provider config", async () => {
      const result = await manager.validateSection("ai", {
        providers: {
          custom: { type: "" },
        },
      });
      expect(result.valid).toBe(false);
    });

    it("should return invalid for unknown sections", async () => {
      const result = await manager.validateSection("nonexistent" as never, {});
      expect(result.valid).toBe(false);
    });
  });

  describe("update", () => {
    it("should merge changes with existing config", async () => {
      await writeConfig({
        version: "1.0",
        projectMode: "development",
        logLevel: "info",
      });
      const updated = await manager.update({ logLevel: "debug" });
      expect(updated.logLevel).toBe("debug");
      expect(updated.projectMode).toBe("development");
    });

    it("should persist changes to disk", async () => {
      await writeConfig({
        version: "1.0",
        projectMode: "development",
      });
      await manager.update({ projectMode: "writing" });
      const raw = await readJsonFile<Record<string, unknown>>(configJsonPath(testDir));
      expect(raw.projectMode).toBe("writing");
    });

    it("should reject invalid updates", async () => {
      await writeConfig({
        version: "1.0",
        projectMode: "development",
      });
      await expect(manager.update({ projectMode: "bogus" as never })).rejects.toThrow();
    });

    it("should not corrupt config on failed validation", async () => {
      await writeConfig({
        version: "1.0",
        projectMode: "development",
        logLevel: "info",
      });
      try {
        await manager.update({ projectMode: "invalid" as never, logLevel: "trace" });
      } catch {
        // expected
      }
      const raw = await readJsonFile<Record<string, unknown>>(configJsonPath(testDir));
      expect(raw.projectMode).toBe("development");
      expect(raw.logLevel).toBe("info");
    });

    it("should not expose secrets in thrown error messages", async () => {
      await writeConfig({
        version: "1.0",
        projectMode: "development",
        ai: {
          providers: {
            openai: {
              type: "openai",
              apiKeyEnv: "OPENAI_API_KEY",
            },
          },
        },
      });
      await expect(manager.update({ projectMode: "bogus" as never })).rejects.not.toThrow(
        /OPENAI_API_KEY|apiKeyEnv|secret/i,
      );
    });
  });

  describe("get", () => {
    it("should return a specific config value", async () => {
      await writeConfig({
        version: "1.0",
        projectMode: "development",
        logLevel: "warn",
      });
      expect(await manager.get("projectMode")).toBe("development");
      expect(await manager.get("logLevel")).toBe("warn");
    });

    it("should return defaults for unset values", async () => {
      await writeConfig({ version: "1.0", projectMode: "development" });
      expect(await manager.get("defaultExecutor")).toBe("opencode");
    });

    it("should return undefined for non-existent keys", async () => {
      await writeConfig({ version: "1.0", projectMode: "development" });
      expect(await manager.get("nonexistent")).toBeUndefined();
    });
  });
});
