import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ReplHistory } from "../../src/cli/interactive/repl-history.js";

describe("ReplHistory", () => {
  let testDir: string;
  let history: ReplHistory;

  beforeAll(() => {
    testDir = mkdtempSync(path.join(tmpdir(), "flowtask-history-test-"));
    history = new ReplHistory({ projectRoot: testDir, maxEntries: 10 });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads [] when file does not exist", async () => {
    const lines = await history.load();
    expect(lines).toEqual([]);
  });

  it("saves safe commands", async () => {
    const saveDir = mkdtempSync(path.join(tmpdir(), "flowtask-save-test-"));
    await fs.mkdir(path.join(saveDir, ".flowtask"), { recursive: true });
    const h = new ReplHistory({ projectRoot: saveDir, maxEntries: 10 });
    await h.load();
    await h.append("doctor");
    await h.append("status");
    const content = await fs.readFile(path.join(saveDir, ".flowtask", "history"), "utf-8");
    expect(content).toContain("doctor");
    expect(content).toContain("status");
    rmSync(saveDir, { recursive: true, force: true });
  });

  it("appends safe command", async () => {
    const appendDir = mkdtempSync(path.join(tmpdir(), "flowtask-append-test-"));
    await fs.mkdir(path.join(appendDir, ".flowtask"), { recursive: true });
    const h = new ReplHistory({ projectRoot: appendDir, maxEntries: 10 });
    await h.load();
    await h.append("run update readme");
    const lines = h.getLines();
    expect(lines).toContain("run update readme");
    rmSync(appendDir, { recursive: true, force: true });
  });

  it("skips empty lines", async () => {
    const h = new ReplHistory({ projectRoot: testDir, maxEntries: 10 });
    await h.load();
    await h.append("");
    const lines = h.getLines();
    expect(lines.filter((l) => l === "").length).toBe(0);
  });

  it("skips duplicate consecutive command", async () => {
    const dupDir = mkdtempSync(path.join(tmpdir(), "flowtask-dup-test-"));
    await fs.mkdir(path.join(dupDir, ".flowtask"), { recursive: true });
    const h = new ReplHistory({ projectRoot: dupDir, maxEntries: 10 });
    await h.load();
    await h.append("unique_cmd");
    await h.append("unique_cmd");
    const lines = h.getLines();
    const count = lines.filter((l) => l === "unique_cmd").length;
    expect(count).toBe(1);
    rmSync(dupDir, { recursive: true, force: true });
  });

  it("skips API_KEY line", async () => {
    const h = new ReplHistory({ projectRoot: testDir, maxEntries: 10 });
    await h.load();
    await h.append("set OPENAI_API_KEY=sk-xxx");
    const lines = h.getLines();
    expect(lines).not.toContain("set OPENAI_API_KEY=sk-xxx");
  });

  it("skips TOKEN line", async () => {
    const h = new ReplHistory({ projectRoot: testDir, maxEntries: 10 });
    await h.load();
    await h.append("TOKEN=abc123");
    const lines = h.getLines();
    expect(lines).not.toContain("TOKEN=abc123");
  });

  it("skips SECRET line", async () => {
    const h = new ReplHistory({ projectRoot: testDir, maxEntries: 10 });
    await h.load();
    await h.append("mySecret=xyz");
    const lines = h.getLines();
    expect(lines).not.toContain("mySecret=xyz");
  });

  it("skips PASSWORD line", async () => {
    const h = new ReplHistory({ projectRoot: testDir, maxEntries: 10 });
    await h.load();
    await h.append("PASSWORD=hunter2");
    const lines = h.getLines();
    expect(lines).not.toContain("PASSWORD=hunter2");
  });

  it("skips DATABASE_URL line", async () => {
    const h = new ReplHistory({ projectRoot: testDir, maxEntries: 10 });
    await h.load();
    await h.append("DATABASE_URL=postgres://user:pass@localhost/db");
    const lines = h.getLines();
    expect(lines).not.toContain("DATABASE_URL");
  });

  it("skips PRIVATE_KEY line", async () => {
    const h = new ReplHistory({ projectRoot: testDir, maxEntries: 10 });
    await h.load();
    await h.append("PRIVATE_KEY=abc");
    const lines = h.getLines();
    expect(lines).not.toContain("PRIVATE_KEY");
  });

  it("keeps only maxEntries", async () => {
    const h = new ReplHistory({ projectRoot: testDir, maxEntries: 3 });
    await h.load();
    await h.append("first");
    await h.append("second");
    await h.append("third");
    await h.append("fourth");
    const lines = h.getLines();
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines).not.toContain("first");
  });

  it("does not persist exit commands", async () => {
    const h = new ReplHistory({ projectRoot: testDir, maxEntries: 10 });
    await h.load();
    await h.append("exit");
    await h.append("/exit");
    await h.append("quit");
    await h.append("/quit");
    const lines = h.getLines();
    expect(lines).not.toContain("exit");
    expect(lines).not.toContain("quit");
  });
});

describe("shouldPersist", () => {
  let testDir: string;
  let history: ReplHistory;

  beforeAll(() => {
    testDir = mkdtempSync(path.join(tmpdir(), "flowtask-sho uld-persist-"));
    history = new ReplHistory({ projectRoot: testDir });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns false for empty line", () => {
    expect(history.shouldPersist("")).toBe(false);
  });

  it("returns true for safe command", () => {
    expect(history.shouldPersist("doctor")).toBe(true);
  });

  it("returns false for API_KEY", () => {
    expect(history.shouldPersist("OPENAI_API_KEY=sk-xxx")).toBe(false);
  });

  it("returns false for TOKEN", () => {
    expect(history.shouldPersist("TOKEN=abc")).toBe(false);
  });

  it("returns false for SECRET", () => {
    expect(history.shouldPersist("SECRET=xyz")).toBe(false);
  });

  it("returns false for PASSWORD", () => {
    expect(history.shouldPersist("PASSWORD=123")).toBe(false);
  });

  it("returns false for DATABASE_URL", () => {
    expect(history.shouldPersist("DATABASE_URL=postgres://...")).toBe(false);
  });

  it("returns false for exit commands", () => {
    expect(history.shouldPersist("exit")).toBe(false);
    expect(history.shouldPersist("/exit")).toBe(false);
    expect(history.shouldPersist("quit")).toBe(false);
    expect(history.shouldPersist("/quit")).toBe(false);
  });
});
