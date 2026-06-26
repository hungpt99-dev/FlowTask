import { describe, it, expect, beforeAll } from "vitest";
import { RuleLoader } from "../../src/rules/rule-loader.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testDir } from "../setup.js";

describe("RuleLoader", () => {
  let rulesDir: string;
  let loader: RuleLoader;

  beforeAll(() => {
    loader = new RuleLoader();
    rulesDir = join(testDir, "rules-test");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, "project.md"), "# Project Rules\n\nTest rules content.");
    writeFileSync(join(rulesDir, "coding.md"), "# Coding Rules\n\nUse strict TypeScript.");
  });

  it("should create an instance", () => {
    expect(loader).toBeInstanceOf(RuleLoader);
  });

  it("should return empty array when rules are disabled", async () => {
    const rules = await loader.loadRules(testDir, {
      enabled: false,
      paths: [],
      required: false,
      maxFileSizeKb: 256,
    });
    expect(rules).toEqual([]);
  });

  it("should return empty array when no paths match", async () => {
    const rules = await loader.loadRules(testDir, {
      enabled: true,
      paths: ["nonexistent/*.md"],
      required: false,
      maxFileSizeKb: 256,
    });
    expect(rules).toEqual([]);
  });

  it("should load rules from configured paths", async () => {
    const rules = await loader.loadRules(testDir, {
      enabled: true,
      paths: ["rules-test/*.md"],
      required: false,
      maxFileSizeKb: 256,
    });
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(rules.some((r) => r.sourcePath.endsWith("project.md"))).toBe(true);
    expect(rules.some((r) => r.sourcePath.endsWith("coding.md"))).toBe(true);
  });

  it("should return empty string when merging empty rules", () => {
    const merged = loader.mergeRules([]);
    expect(merged).toBe("");
  });

  it("should merge rules into a single string", () => {
    const merged = loader.mergeRules([
      { sourcePath: "/test/project.md", content: "Project rules", sizeBytes: 13 },
      { sourcePath: "/test/coding.md", content: "Coding rules", sizeBytes: 12 },
    ]);
    expect(merged).toContain("Project rules");
    expect(merged).toContain("Coding rules");
    expect(merged).toContain("Source:");
  });
});
