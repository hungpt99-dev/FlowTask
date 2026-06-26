import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnvFile, formatEnvEntry } from "../../src/utils/env-loader.js";
import { writeTextFile } from "../../src/utils/fs.js";
import { testDir } from "../setup.js";
import { join } from "node:path";

describe("env-loader", () => {
  const envVars = ["TEST_KEY_1", "TEST_KEY_2", "TEST_KEY_3", "TEST_EXISTING"];

  beforeEach(() => {
    for (const v of envVars) {
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of envVars) {
      delete process.env[v];
    }
  });

  it("should load .env file and set process.env", async () => {
    const envPath = join(testDir, ".env");
    await writeTextFile(envPath, "TEST_KEY_1=hello\nTEST_KEY_2=world");

    await loadEnvFile(testDir);

    expect(process.env.TEST_KEY_1).toBe("hello");
    expect(process.env.TEST_KEY_2).toBe("world");
  });

  it("should handle empty lines and comments", async () => {
    const envPath = join(testDir, ".env");
    await writeTextFile(
      envPath,
      "# This is a comment\n\nTEST_KEY_1=value1\n\n# Another comment\nTEST_KEY_2=value2",
    );

    await loadEnvFile(testDir);

    expect(process.env.TEST_KEY_1).toBe("value1");
    expect(process.env.TEST_KEY_2).toBe("value2");
  });

  it("should handle quoted values", async () => {
    const envPath = join(testDir, ".env");
    await writeTextFile(envPath, "TEST_KEY_1=\"quoted value\"\nTEST_KEY_2='single quoted'");

    await loadEnvFile(testDir);

    expect(process.env.TEST_KEY_1).toBe("quoted value");
    expect(process.env.TEST_KEY_2).toBe("single quoted");
  });

  it("should not override existing environment variables", async () => {
    process.env.TEST_EXISTING = "original";

    const envPath = join(testDir, ".env");
    await writeTextFile(envPath, "TEST_EXISTING=overridden");

    await loadEnvFile(testDir);

    expect(process.env.TEST_EXISTING).toBe("original");
  });

  it("should do nothing if .env file does not exist", async () => {
    const emptyDir = join(testDir, "no-env-dir");
    await loadEnvFile(emptyDir);
  });

  it("should handle values with = sign", async () => {
    const envPath = join(testDir, ".env");
    await writeTextFile(envPath, "TEST_KEY_1=value=with=equals");

    await loadEnvFile(testDir);

    expect(process.env.TEST_KEY_1).toBe("value=with=equals");
  });

  it("should skip lines without = sign", async () => {
    const envPath = join(testDir, ".env");
    await writeTextFile(envPath, "TEST_KEY_1=hello\nNOT_A_KEY\nTEST_KEY_2=world");

    await loadEnvFile(testDir);

    expect(process.env.TEST_KEY_1).toBe("hello");
    expect(process.env.TEST_KEY_2).toBe("world");
  });
});

describe("formatEnvEntry", () => {
  it("should format simple key=value", () => {
    expect(formatEnvEntry("KEY", "value")).toBe("KEY=value");
  });

  it("should quote values with spaces", () => {
    const result = formatEnvEntry("KEY", "value with spaces");
    expect(result).toBe('KEY="value with spaces"');
  });

  it("should quote values with #", () => {
    const result = formatEnvEntry("KEY", "value#comment");
    expect(result).toBe('KEY="value#comment"');
  });

  it("should quote values with =", () => {
    const result = formatEnvEntry("KEY", "value=with=equals");
    expect(result).toBe('KEY="value=with=equals"');
  });

  it("should not quote simple values", () => {
    expect(formatEnvEntry("API_KEY", "sk-1234567890abcdef")).toBe("API_KEY=sk-1234567890abcdef");
  });
});
