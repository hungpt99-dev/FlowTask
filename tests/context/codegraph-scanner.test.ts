import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  CodeGraphScanner,
  formatCodeGraph,
  type CodeGraph,
} from "../../src/context/codegraph-scanner.js";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("CodeGraphScanner", () => {
  let scanner: CodeGraphScanner;

  beforeAll(() => {
    scanner = new CodeGraphScanner();
  });

  describe("parseImports", () => {
    it("should extract named imports", () => {
      const code = `import { useState, useEffect } from "react";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["react"]);
    });

    it("should extract default imports", () => {
      const code = `import React from "react";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["react"]);
    });

    it("should extract namespace imports", () => {
      const code = `import * as d3 from "d3";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["d3"]);
    });

    it("should extract local relative imports", () => {
      const code = `import { login } from "./auth";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["./auth"]);
    });

    it("should extract local deep relative imports", () => {
      const code = `import { User } from "../models/user";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["../models/user"]);
    });

    it("should extract dynamic imports", () => {
      const code = `const mod = await import("./module");`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["./module"]);
    });

    it("should strip .js extensions from imports", () => {
      const code = `import { helper } from "./utils.js";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["./utils"]);
    });

    it("should deduplicate repeated imports", () => {
      const code = `import { a } from "react";\nimport { b } from "react";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["react"]);
    });

    it("should handle import type statements", () => {
      const code = `import type { Config } from "./config";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["./config"]);
    });

    it("should handle side-effect imports", () => {
      const code = `import "./polyfills";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["./polyfills"]);
    });

    it("should strip comments before parsing", () => {
      const code = `// import { old } from "old-lib";\nimport { actual } from "real-lib";`;
      const imports = scanner.parseImports(code);
      expect(imports).not.toContain("old-lib");
      expect(imports).toContain("real-lib");
    });

    it("should skip block comments", () => {
      const code = `/* import { old } from "old-lib"; */\nimport { actual } from "real-lib";`;
      const imports = scanner.parseImports(code);
      expect(imports).not.toContain("old-lib");
      expect(imports).toContain("real-lib");
    });

    it("should handle multi-line imports", () => {
      const code = `import {\n  useState,\n  useEffect,\n  useCallback\n} from "react";`;
      const imports = scanner.parseImports(code);
      expect(imports).toEqual(["react"]);
    });
  });

  describe("parseExports", () => {
    it("should extract named function exports", () => {
      const code = `export function login() {}`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("login");
    });

    it("should extract named class exports", () => {
      const code = `export class UserService {}`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("UserService");
    });

    it("should extract named const exports", () => {
      const code = `export const API_URL = "https://api.example.com";`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("API_URL");
    });

    it("should extract default exports", () => {
      const code = `export default function handler() {}`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("handler");
    });

    it("should extract export lists", () => {
      const code = `const a = 1;\nconst b = 2;\nexport { a, b };`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("a");
      expect(exports).toContain("b");
    });

    it("should extract export lists with aliases", () => {
      const code = `const a = 1;\nexport { a as alpha };`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("a");
    });

    it("should extract re-exports", () => {
      const code = `export { login, register } from "./auth";`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("login");
      expect(exports).toContain("register");
    });

    it("should extract interface exports", () => {
      const code = `export interface User { name: string; }`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("User");
    });

    it("should extract type exports", () => {
      const code = `export type Status = "active" | "inactive";`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("Status");
    });

    it("should extract enum exports", () => {
      const code = `export enum Color { Red, Green, Blue }`;
      const exports = scanner.parseExports(code);
      expect(exports).toContain("Color");
    });

    it("should strip comments", () => {
      const code = `// export function oldFunc() {}\nexport function newFunc() {}`;
      const exports = scanner.parseExports(code);
      expect(exports).not.toContain("oldFunc");
      expect(exports).toContain("newFunc");
    });
  });

  describe("scan", () => {
    let testDir: string;

    beforeAll(async () => {
      testDir = mkdtempSync(path.join(tmpdir(), "codegraph-scan-test-"));

      await fs.mkdir(path.join(testDir, "src"), { recursive: true });
      await fs.mkdir(path.join(testDir, "tests"), { recursive: true });
      await fs.mkdir(path.join(testDir, "node_modules"), { recursive: true });

      // Entry point
      await fs.writeFile(
        path.join(testDir, "src", "index.ts"),
        `export { run } from "./core";
export { config } from "./config";
`,
      );

      // Core module with local imports
      await fs.writeFile(
        path.join(testDir, "src", "core.ts"),
        `import { helper } from "./utils";
import { logger } from "./logger";
import { Config } from "./config";

export function run() {
  helper();
}

export interface Runner {
  start(): void;
}
`,
      );

      // Utils module
      await fs.writeFile(
        path.join(testDir, "src", "utils.ts"),
        `import fs from "node:fs";
import path from "node:path";

export function helper(): void {}
export function format(): string { return ""; }

export const VERSION = "1.0.0";
`,
      );

      // Logger module
      await fs.writeFile(
        path.join(testDir, "src", "logger.ts"),
        `export function log(msg: string): void {}
export function error(msg: string): void {}
`,
      );

      // Config module
      await fs.writeFile(
        path.join(testDir, "src", "config.ts"),
        `export interface Config {
  debug: boolean;
}

export const DEFAULT_CONFIG: Config = { debug: false };
`,
      );

      // Test file
      await fs.writeFile(
        path.join(testDir, "tests", "core.test.ts"),
        `import { run } from "../src/core";
import { describe, it, expect } from "vitest";

describe("core", () => {
  it("should run", () => {
    expect(run()).toBeDefined();
  });
});
`,
      );

      // Non-source file (should be ignored)
      await fs.writeFile(
        path.join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          main: "src/index.ts",
          scripts: { test: "vitest run" },
        }),
      );

      // Dist file (should be excluded via extension check)
      await fs.mkdir(path.join(testDir, "dist"), { recursive: true });
      await fs.writeFile(path.join(testDir, "dist", "bundle.js"), "// compiled\n");
    });

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("should return empty result for empty file list", async () => {
      const result = await scanner.scan([], testDir);
      expect(result.graph.files).toEqual([]);
      expect(result.graph.edges).toEqual([]);
      expect(result.context).toContain("No source files to scan");
    });

    it("should return empty result when no source files found", async () => {
      const result = await scanner.scan([path.join(testDir, "package.json")], testDir);
      expect(result.graph.files).toEqual([]);
    });

    it("should build graph from source files", async () => {
      const files = [
        path.join(testDir, "src", "index.ts"),
        path.join(testDir, "src", "core.ts"),
        path.join(testDir, "src", "utils.ts"),
        path.join(testDir, "src", "logger.ts"),
        path.join(testDir, "src", "config.ts"),
      ];

      const result = await scanner.scan(files, testDir);
      expect(result.graph.files.length).toBe(5);
      expect(result.graph.edges.length).toBeGreaterThan(0);
    });

    it("should correctly count imports per module", async () => {
      const files = [
        path.join(testDir, "src", "core.ts"),
        path.join(testDir, "src", "utils.ts"),
        path.join(testDir, "src", "logger.ts"),
        path.join(testDir, "src", "config.ts"),
      ];

      const result = await scanner.scan(files, testDir);
      const core = result.graph.files.find((f) => f.relativePath.endsWith("core.ts"));
      expect(core).toBeDefined();
      expect(core!.imports).toEqual(["./utils", "./logger", "./config"]);
    });

    it("should correctly count exports per module", async () => {
      const files = [path.join(testDir, "src", "utils.ts")];
      const result = await scanner.scan(files, testDir);
      const utils = result.graph.files.find((f) => f.relativePath.endsWith("utils.ts"));
      expect(utils).toBeDefined();
      expect(utils!.exports).toContain("helper");
      expect(utils!.exports).toContain("format");
      expect(utils!.exports).toContain("VERSION");
    });

    it("should detect entry points from package.json", async () => {
      const files = [path.join(testDir, "src", "index.ts"), path.join(testDir, "src", "core.ts")];

      const result = await scanner.scan(files, testDir);
      const entry = result.graph.files.find((f) => f.isEntryPoint);
      expect(entry).toBeDefined();
      expect(entry!.relativePath).toMatch(/src\/index\.ts$/);
    });

    it("should build edges between modules", async () => {
      const files = [
        path.join(testDir, "src", "index.ts"),
        path.join(testDir, "src", "core.ts"),
        path.join(testDir, "src", "utils.ts"),
      ];

      const result = await scanner.scan(files, testDir);
      expect(result.graph.edges.length).toBeGreaterThan(0);

      const coreToUtils = result.graph.edges.find(
        (e) => path.basename(e.from).includes("core") && path.basename(e.to).includes("utils"),
      );
      expect(coreToUtils).toBeDefined();
    });

    it("should find related test files", async () => {
      const files = [path.join(testDir, "src", "core.ts")];
      const result = await scanner.scan(files, testDir);
      const core = result.graph.files.find((f) => f.relativePath.endsWith("core.ts"));
      expect(core).toBeDefined();
      expect(core!.relatedTests.length).toBeGreaterThan(0);
      expect(core!.relatedTests[0]).toMatch(/core\.test\.ts$/);
    });

    it("should produce context in expected markdown format", async () => {
      const files = [path.join(testDir, "src", "utils.ts")];
      const result = await scanner.scan(files, testDir);
      expect(result.context).toContain("## Code Graph Context");
      expect(result.context).toContain("Scanned 1 source file(s)");
      expect(result.context).toContain("utils.ts");
      expect(result.context).toContain("External deps:");
      expect(result.context).toContain("Exports:");
    });

    it("should handle non-existent files gracefully", async () => {
      const files = [path.join(testDir, "src", "nonexistent.ts")];
      const result = await scanner.scan(files, testDir);
      expect(result.graph.files).toEqual([]);
    });
  });

  describe("formatCodeGraph", () => {
    it("should format empty graph", () => {
      const graph: CodeGraph = { files: [], edges: [], entryPoints: [] };
      const formatted = formatCodeGraph(graph);
      expect(formatted).toContain("Files: 0");
      expect(formatted).toContain("Edges: 0");
    });

    it("should format a graph with modules", () => {
      const graph: CodeGraph = {
        files: [
          {
            filePath: "/project/src/index.ts",
            relativePath: "src/index.ts",
            imports: ["./utils"],
            exports: ["run"],
            isEntryPoint: true,
            relatedTests: [],
          },
          {
            filePath: "/project/src/utils.ts",
            relativePath: "src/utils.ts",
            imports: ["fs", "path"],
            exports: ["helper", "format"],
            isEntryPoint: false,
            relatedTests: ["tests/utils.test.ts"],
          },
        ],
        edges: [{ from: "/project/src/index.ts", to: "/project/src/utils.ts", type: "import" }],
        entryPoints: ["src/index.ts"],
      };

      const formatted = formatCodeGraph(graph);
      expect(formatted).toContain("Files: 2");
      expect(formatted).toContain("Edges: 1");
      expect(formatted).toContain("Entry Points: src/index.ts");
      expect(formatted).toContain("**src/index.ts** (entry)");
      expect(formatted).toContain("src/utils.ts");
      expect(formatted).toContain("Exports: run");
      expect(formatted).toContain("Imports (local): ./utils");
      expect(formatted).toContain("Imports (external): fs, path");
      expect(formatted).toContain("Tests: tests/utils.test.ts");
    });
  });
});
