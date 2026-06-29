import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { ScanCache } from "../../src/context/scan-cache.js";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("ScanCache", () => {
  let cacheDir: string;
  let cache: ScanCache;

  beforeAll(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), "scan-cache-test-"));
  });

  afterAll(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    cache = new ScanCache({ cacheDir, useCache: true });
  });

  it("returns null for uncached key", async () => {
    const result = await cache.get<string>("nonexistent", []);
    expect(result).toBeNull();
  });

  it("returns null when caching is disabled", async () => {
    const disabled = new ScanCache({ cacheDir, useCache: false });
    await disabled.set("key", "value", []);
    const result = await disabled.get<string>("key", []);
    expect(result).toBeNull();
  });

  it("stores and retrieves data", async () => {
    const data = { hello: "world", number: 42 };
    await cache.set("test-key", data, []);
    const result = await cache.get<typeof data>("test-key", []);
    expect(result).toEqual(data);
  });

  it("stores and retrieves array data", async () => {
    const data = [1, 2, 3, "four"];
    await cache.set("array-key", data, []);
    const result = await cache.get<typeof data>("array-key", []);
    expect(result).toEqual(data);
  });

  it("returns null when dependencies have changed", async () => {
    const depFile = path.join(cacheDir, "dep-file.txt");
    await fs.writeFile(depFile, "content v1");

    await cache.set("dep-key", "cached-value", [depFile]);

    let result = await cache.get<string>("dep-key", [depFile]);
    expect(result).toBe("cached-value");

    await fs.writeFile(depFile, "content v2 - modified");

    result = await cache.get<string>("dep-key", [depFile]);
    expect(result).toBeNull();
  });

  it("returns null when a dependency file is removed", async () => {
    const depFile = path.join(cacheDir, "removable-dep.txt");
    await fs.writeFile(depFile, "content");

    await cache.set("removed-dep-key", "value", [depFile]);
    expect(await cache.get<string>("removed-dep-key", [depFile])).toBe("value");

    await fs.unlink(depFile);

    expect(await cache.get<string>("removed-dep-key", [depFile])).toBeNull();
  });

  it("returns null when a new dependency file is added", async () => {
    const depFile = path.join(cacheDir, "new-dep.txt");

    await cache.set("new-dep-key", "value", []);

    const result = await cache.get<string>("new-dep-key", [depFile]);
    expect(result).toBeNull();
  });

  it("invalidates cache when dependency timestamp changes", async () => {
    const depFile = path.join(cacheDir, "ts-dep.txt");
    await fs.writeFile(depFile, "content");

    await cache.set("ts-key", "original", [depFile]);
    expect(await cache.get<string>("ts-key", [depFile])).toBe("original");

    await new Promise((r) => setTimeout(r, 10));
    await fs.writeFile(depFile, "content");

    expect(await cache.get<string>("ts-key", [depFile])).toBeNull();
  });

  it("persists cache across ScanCache instances", async () => {
    await cache.set("persist-key", { data: "persisted" }, []);

    const cache2 = new ScanCache({ cacheDir, useCache: true });
    const result = await cache2.get<{ data: string }>("persist-key", []);
    expect(result).toEqual({ data: "persisted" });
  });

  it("invalidates cache after explicit invalidation", async () => {
    await cache.set("invalidate-key", "to-be-invalidated", []);
    expect(await cache.get<string>("invalidate-key", [])).toBe("to-be-invalidated");

    await cache.invalidate("invalidate-key");
    expect(await cache.get<string>("invalidate-key", [])).toBeNull();
  });

  it("handles invalid JSON in cache file gracefully", async () => {
    await cache.set("bad-key", "good", []);
    const hash = crypto.createHash("sha256").update("bad-key").digest("hex").slice(0, 16);
    const cachePath = path.join(cacheDir, `${hash}.json`);
    await fs.writeFile(cachePath, "not valid json");

    const result = await cache.get<string>("bad-key", []);
    expect(result).toBeNull();
  });

  it("handles missing cache directory gracefully", async () => {
    const deepCache = new ScanCache({
      cacheDir: path.join(cacheDir, "deep", "nested", "cache"),
      useCache: true,
    });

    await deepCache.set("deep-key", "deep-value", []);
    const result = await deepCache.get<string>("deep-key", []);
    expect(result).toBe("deep-value");
  });

  it("returns null when version mismatch", async () => {
    await cache.set("version-key", "v1-data", []);

    const hash = crypto.createHash("sha256").update("version-key").digest("hex").slice(0, 16);
    const cacheFile = path.join(cacheDir, `${hash}.json`);
    const raw = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
    raw.version = 999;
    await fs.writeFile(cacheFile, JSON.stringify(raw));

    const result = await cache.get<string>("version-key", []);
    expect(result).toBeNull();
  });

  it("handles multiple dependency files", async () => {
    const dep1 = path.join(cacheDir, "multi-dep-1.txt");
    const dep2 = path.join(cacheDir, "multi-dep-2.txt");
    const dep3 = path.join(cacheDir, "multi-dep-3.txt");
    await fs.writeFile(dep1, "a");
    await fs.writeFile(dep2, "b");
    await fs.writeFile(dep3, "c");

    await cache.set("multi-dep-key", "multi-value", [dep1, dep2, dep3]);
    expect(await cache.get<string>("multi-dep-key", [dep1, dep2, dep3])).toBe("multi-value");

    await fs.writeFile(dep2, "b-modified");
    expect(await cache.get<string>("multi-dep-key", [dep1, dep2, dep3])).toBeNull();
  });

  it("disambiguates different keys", async () => {
    await cache.set("key-a", "value-a", []);
    await cache.set("key-b", "value-b", []);

    expect(await cache.get<string>("key-a", [])).toBe("value-a");
    expect(await cache.get<string>("key-b", [])).toBe("value-b");
  });
});
