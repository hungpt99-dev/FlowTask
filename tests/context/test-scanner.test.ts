import { describe, it, expect, beforeEach } from "vitest";
import {
  TestScanner,
  formatTestSummary,
  type TestScanResult,
} from "../../src/context/test-scanner.js";
import path from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function createProject(overrides?: {
  packageJson?: Record<string, unknown>;
  files?: Record<string, string>;
  dirs?: string[];
}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "test-scanner-"));
  if (overrides?.dirs) {
    for (const d of overrides.dirs) {
      mkdirSync(path.join(dir, d), { recursive: true });
    }
  }
  if (overrides?.files) {
    for (const [filePath, content] of Object.entries(overrides.files)) {
      const fullPath = path.join(dir, filePath);
      mkdirSync(path.dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }
  if (overrides?.packageJson) {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(overrides.packageJson));
  }
  return dir;
}

describe("TestScanner", () => {
  let scanner: TestScanner;

  beforeEach(() => {
    scanner = new TestScanner();
  });

  describe("scan", () => {
    it("should return empty result for project with no test files", async () => {
      const dir = createProject({ packageJson: { name: "empty" } });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFileCount).toBe(0);
        expect(result.testFiles).toEqual([]);
        expect(result.frameworks).toEqual([]);
        expect(result.coverage.available).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should detect vitest framework from package.json devDependencies", async () => {
      const dir = createProject({
        packageJson: {
          name: "test-project",
          devDependencies: { vitest: "^1.0.0" },
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.frameworks.length).toBeGreaterThanOrEqual(1);
        expect(result.frameworks.some((f) => f.name === "vitest")).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should detect jest framework from package.json dependencies", async () => {
      const dir = createProject({
        packageJson: {
          name: "test-project",
          dependencies: { jest: "^29.0.0" },
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.frameworks.some((f) => f.name === "jest")).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should detect test framework from scripts", async () => {
      const dir = createProject({
        packageJson: {
          name: "test-project",
          scripts: { test: "vitest run" },
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.frameworks.some((f) => f.name === "vitest")).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should detect framework from config file", async () => {
      const dir = createProject({
        files: { "jest.config.ts": "export default {}" },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.frameworks.some((f) => f.name === "jest" && f.configPresent)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should find .test.ts test files", async () => {
      const dir = createProject({
        dirs: ["tests"],
        files: {
          "tests/foo.test.ts":
            'import { expect, test } from "vitest";\ntest("foo", () => expect(1).toBe(1));\n',
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFileCount).toBe(1);
        expect(result.testFiles[0]!.relativePath).toBe("tests/foo.test.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should find .spec.ts test files", async () => {
      const dir = createProject({
        dirs: ["tests"],
        files: {
          "tests/bar.spec.ts":
            'import { expect, test } from "vitest";\ntest("bar", () => expect(2).toBe(2));\n',
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFileCount).toBe(1);
        expect(result.testFiles[0]!.relativePath).toBe("tests/bar.spec.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should find test files with various extensions", async () => {
      const dir = createProject({
        dirs: ["tests"],
        files: {
          "tests/a.test.ts": "// ts test\n",
          "tests/b.test.tsx": "// tsx test\n",
          "tests/c.test.js": "// js test\n",
          "tests/d.spec.mjs": "// mjs spec\n",
          "tests/e.test.cjs": "// cjs test\n",
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFileCount).toBe(5);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should exclude test files in node_modules", async () => {
      const dir = createProject({
        dirs: ["node_modules/some-pkg"],
        files: {
          "node_modules/some-pkg/index.test.ts": 'import { test } from "vitest";\n',
          "tests/valid.test.ts": "// valid test\n",
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFileCount).toBe(1);
        expect(result.testFiles[0]!.relativePath).toBe("tests/valid.test.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should exclude test files in .git, dist, coverage dirs", async () => {
      const dir = createProject({
        dirs: [".git", "dist", "coverage"],
        files: {
          ".git/hooks.test.ts": "// no\n",
          "dist/output.test.ts": "// no\n",
          "coverage/report.test.ts": "// no\n",
          "tests/real.test.ts": "// yes\n",
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFileCount).toBe(1);
        expect(result.testFiles[0]!.relativePath).toBe("tests/real.test.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should map test file to related source module in src/", async () => {
      const dir = createProject({
        dirs: ["src", "tests"],
        files: {
          "src/foo.ts": "export const foo = 1;\n",
          "tests/foo.test.ts": 'import { foo } from "../src/foo";\n',
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFiles[0]!.relatedSourceModule).toBe("src/foo.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should map test file in __tests__ dir to source module", async () => {
      const dir = createProject({
        dirs: ["src", "__tests__"],
        files: {
          "src/bar.ts": "export const bar = 2;\n",
          "__tests__/bar.test.ts": 'import { bar } from "../src/bar";\n',
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFiles[0]!.relatedSourceModule).toBe("src/bar.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should map colocated test file (test next to source)", async () => {
      const dir = createProject({
        dirs: ["src"],
        files: {
          "src/util.ts": "export const util = true;\n",
          "src/util.test.ts": 'import { util } from "./util";\n',
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFiles[0]!.relatedSourceModule).toBe("src/util.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should return null related source when no match found", async () => {
      const dir = createProject({
        dirs: ["tests"],
        files: {
          "tests/orphan.test.ts": "// no matching source\n",
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFiles[0]!.relatedSourceModule).toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should detect coverage directory with lcov report", async () => {
      const dir = createProject({
        dirs: ["coverage"],
        files: {
          "coverage/lcov.info": "SF:src/foo.ts\nDA:1,1\nDA:2,1\nend_of_record\n",
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.coverage.available).toBe(true);
        expect(result.coverage.reports.length).toBeGreaterThanOrEqual(1);
        expect(result.coverage.reports[0]).toContain("lcov.info");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should parse coverage-summary.json for percentages", async () => {
      const dir = createProject({
        dirs: ["coverage"],
        files: {
          "coverage/coverage-summary.json": JSON.stringify({
            total: {
              lines: { pct: 85 },
              branches: { pct: 72 },
              functions: { pct: 90 },
            },
          }),
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.coverage.available).toBe(true);
        expect(result.coverage.lines).toBe(85);
        expect(result.coverage.branches).toBe(72);
        expect(result.coverage.functions).toBe(90);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should handle project without coverage directory", async () => {
      const dir = createProject({ packageJson: { name: "no-coverage" } });
      try {
        const result = await scanner.scan(dir);
        expect(result.coverage.available).toBe(false);
        expect(result.coverage.reports).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should detect multiple frameworks", async () => {
      const dir = createProject({
        packageJson: {
          name: "multi-framework",
          devDependencies: { vitest: "^1.0.0", cypress: "^13.0.0" },
        },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.frameworks.length).toBeGreaterThanOrEqual(2);
        const names = result.frameworks.map((f) => f.name).sort();
        expect(names).toContain("vitest");
        expect(names).toContain("cypress");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should handle project with no package.json", async () => {
      const dir = createProject({
        files: { "tests/foo.test.ts": "// test\n" },
      });
      try {
        const result = await scanner.scan(dir);
        expect(result.testFileCount).toBe(1);
        expect(result.frameworks).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("scanForModules", () => {
    it("should return test files related to given source files", async () => {
      const dir = createProject({
        dirs: ["src", "tests"],
        files: {
          "src/foo.ts": "export const foo = 1;\n",
          "src/bar.ts": "export const bar = 2;\n",
          "tests/foo.test.ts": 'import { foo } from "../src/foo";\n',
          "tests/baz.test.ts": 'import { baz } from "../src/baz";\n',
        },
      });
      try {
        const sourceFiles = [path.join(dir, "src/foo.ts")];
        const result = await scanner.scanForModules(dir, sourceFiles);
        expect(result.size).toBe(1);
        expect(result.has("src/foo.ts")).toBe(true);
        expect(result.get("src/foo.ts")![0]!.relativePath).toBe("tests/foo.test.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should return empty map when no source files match", async () => {
      const dir = createProject({
        dirs: ["src", "tests"],
        files: {
          "src/foo.ts": "export const foo = 1;\n",
          "tests/foo.test.ts": 'import { foo } from "../src/foo";\n',
        },
      });
      try {
        const sourceFiles = [path.join(dir, "src/other.ts")];
        const result = await scanner.scanForModules(dir, sourceFiles);
        expect(result.size).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("formatTestSummary", () => {
    it("should format summary with test files", () => {
      const result: Omit<TestScanResult, "summary"> = {
        frameworks: [{ name: "vitest", configFiles: ["vitest.config.ts"], configPresent: true }],
        testFiles: [
          {
            filePath: "/project/tests/foo.test.ts",
            relativePath: "tests/foo.test.ts",
            framework: "vitest",
            relatedSourceModule: "src/foo.ts",
            size: 100,
          },
        ],
        testFileCount: 1,
        coverage: {
          available: true,
          reports: ["coverage/lcov.info"],
          lines: 85,
          branches: 72,
          functions: 90,
        },
      };

      const formatted = formatTestSummary(result);
      expect(formatted).toContain("Framework(s): vitest");
      expect(formatted).toContain("Test files: 1");
      expect(formatted).toContain("lines: 85%");
      expect(formatted).toContain("branches: 72%");
      expect(formatted).toContain("functions: 90%");
      expect(formatted).toContain("foo.test.ts");
      expect(formatted).toContain("src/foo.ts");
    });

    it("should format summary with no coverage", () => {
      const result: Omit<TestScanResult, "summary"> = {
        frameworks: [],
        testFiles: [],
        testFileCount: 0,
        coverage: { available: false, reports: [], lines: null, branches: null, functions: null },
      };

      const formatted = formatTestSummary(result);
      expect(formatted).toContain("Coverage: not available");
      expect(formatted).toContain("Test files: 0");
    });

    it("should format summary with multiple frameworks and no active config", () => {
      const result: Omit<TestScanResult, "summary"> = {
        frameworks: [
          { name: "vitest", configFiles: [], configPresent: false },
          { name: "jest", configFiles: ["jest.config.ts"], configPresent: true },
        ],
        testFiles: [],
        testFileCount: 0,
        coverage: { available: false, reports: [], lines: null, branches: null, functions: null },
      };

      const formatted = formatTestSummary(result);
      expect(formatted).toContain("jest");
      expect(formatted).toContain("vitest");
    });
  });
});
