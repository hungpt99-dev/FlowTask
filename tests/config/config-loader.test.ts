import { describe, it, expect, beforeAll } from "vitest";
import { ConfigLoader } from "../../src/config/config-loader.js";
import { testDir } from "../setup.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

describe("ConfigLoader", () => {
  let loader: ConfigLoader;

  beforeAll(() => {
    loader = new ConfigLoader();
    const flowtaskDir = join(testDir, "config-test", ".flowtask");
    mkdirSync(flowtaskDir, { recursive: true });
    writeFileSync(
      join(flowtaskDir, "config.json"),
      JSON.stringify({
        version: "1.0",
        defaultExecutor: "shell",
        logLevel: "debug",
        rules: {
          enabled: true,
          paths: ["AGENTS.md"],
          required: false,
          maxFileSizeKb: 256,
        },
      }),
    );
  });

  it("should return default config when no config file exists", async () => {
    const config = await loader.load(join(testDir, "nonexistent-project"));
    expect(config.version).toBe("1.0");
    expect(config.defaultExecutor).toBe("shell");
    expect(config.rules.enabled).toBe(true);
  });

  it("should load config from .flowtask directory", async () => {
    const config = await loader.load(join(testDir, "config-test"));
    expect(config.defaultExecutor).toBe("shell");
    expect(config.logLevel).toBe("debug");
  });

  it("should have default rule paths", async () => {
    const config = await loader.load(join(testDir, "nonexistent-project"));
    expect(config.rules.paths.length).toBeGreaterThan(0);
    expect(config.rules.paths).toContain("AGENTS.md");
  });

  it("should have default executors", async () => {
    const config = await loader.load(join(testDir, "nonexistent-project"));
    expect(config.executors.shell).toBeDefined();
    expect(config.executors.shell!.type).toBe("shell");
    expect(config.executors.opencode).toBeDefined();
  });
});
