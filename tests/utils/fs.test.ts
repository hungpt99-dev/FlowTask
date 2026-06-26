import { describe, it, expect } from "vitest";
import {
  atomicWriteJsonFile,
  readJsonFile,
  fileExists,
  writeTextFile,
  readTextFile,
} from "../../src/utils/fs.js";
import { testDir } from "../setup.js";
import { join } from "node:path";

describe("FS utilities", () => {
  it("should atomically write and read JSON", async () => {
    const filePath = join(testDir, "atomic-test.json");
    const data = { hello: "world", count: 42 };
    await atomicWriteJsonFile(filePath, data);

    const loaded = await readJsonFile<typeof data>(filePath);
    expect(loaded.hello).toBe("world");
    expect(loaded.count).toBe(42);
  });

  it("should create parent directories on atomic write", async () => {
    const filePath = join(testDir, "nested", "deep", "test.json");
    await atomicWriteJsonFile(filePath, { nested: true });

    const exists = await fileExists(filePath);
    expect(exists).toBe(true);
  });

  it("should atomically write without leaving .tmp files", async () => {
    const filePath = join(testDir, "clean-test.json");
    await atomicWriteJsonFile(filePath, { clean: true });

    const tmpPath = `${filePath}.tmp`;
    const tmpExists = await fileExists(tmpPath);
    expect(tmpExists).toBe(false);
  });

  it("should write and read text files", async () => {
    const filePath = join(testDir, "text-test.txt");
    await writeTextFile(filePath, "Hello, World!");
    const content = await readTextFile(filePath);
    expect(content).toBe("Hello, World!");
  });

  it("should report false for non-existent files", async () => {
    const exists = await fileExists(join(testDir, "does-not-exist.txt"));
    expect(exists).toBe(false);
  });
});
