import path from "node:path";
import { fileExists, readTextFile } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";
import { ScanCache, type ScanCacheOptions } from "./scan-cache.js";

const TEST_FILE_PATTERNS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.test.js",
  "**/*.spec.js",
  "**/*.test.jsx",
  "**/*.spec.jsx",
  "**/*.test.mjs",
  "**/*.spec.mjs",
  "**/*.test.cjs",
  "**/*.spec.cjs",
];

const FRAMEWORK_CONFIG_MAP: Record<string, string[]> = {
  vitest: ["vitest.config.*", "vitest.workspace.*"],
  jest: ["jest.config.*"],
  mocha: [".mocharc.*", "mocha.*"],
  playwright: ["playwright.config.*"],
  cypress: ["cypress.config.*", "cypress.json"],
  ava: ["ava.config.*"],
  nyc: [".nycrc*"],
  pytest: ["pytest.ini", "pyproject.toml"],
  "go-test": [],
};

const COVERAGE_REPORT_PATTERNS = [
  "coverage/lcov.info",
  "coverage/coverage-final.json",
  "coverage/clover.xml",
  "coverage/cobertura-coverage.xml",
  "coverage/coverage-summary.json",
];

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".flowtask",
  ".codegraph",
  ".turbo",
  ".cache",
  "coverage",
]);

export interface TestFramework {
  name: string;
  configFiles: string[];
  configPresent: boolean;
}

export interface TestFile {
  filePath: string;
  relativePath: string;
  framework: string;
  relatedSourceModule: string | null;
  size: number;
}

export interface TestCoverageInfo {
  available: boolean;
  reports: string[];
  lines: number | null;
  branches: number | null;
  functions: number | null;
}

export interface TestScanResult {
  frameworks: TestFramework[];
  testFiles: TestFile[];
  coverage: TestCoverageInfo;
  testFileCount: number;
  summary: string;
}

export function formatTestSummary(result: Omit<TestScanResult, "summary">): string {
  const lines: string[] = [];

  lines.push("## Test Summary");

  if (result.frameworks.length > 0) {
    const names = result.frameworks.map((f) => f.name);
    lines.push(`Framework(s): ${names.join(", ")}`);
  }

  lines.push(`Test files: ${result.testFileCount}`);

  if (result.coverage.available) {
    const parts: string[] = ["Coverage: available"];
    if (result.coverage.lines !== null) parts.push(`lines: ${result.coverage.lines}%`);
    if (result.coverage.branches !== null) parts.push(`branches: ${result.coverage.branches}%`);
    if (result.coverage.functions !== null) parts.push(`functions: ${result.coverage.functions}%`);
    lines.push(parts.join(", "));
  } else {
    lines.push("Coverage: not available");
  }

  if (result.testFiles.length > 0) {
    lines.push("");
    lines.push("### Test Files");

    const grouped = new Map<string, TestFile[]>();
    for (const tf of result.testFiles) {
      const dir = path.dirname(tf.relativePath);
      const group = grouped.get(dir) ?? [];
      group.push(tf);
      grouped.set(dir, group);
    }

    for (const [dir, files] of [...grouped.entries()].sort()) {
      lines.push(`\n**${dir}/**`);
      for (const f of files) {
        const sourceInfo = f.relatedSourceModule ? ` → ${f.relatedSourceModule}` : "";
        lines.push(`  - ${path.basename(f.relativePath)}${sourceInfo}`);
      }
    }
  }

  return lines.join("\n");
}

export interface TestScannerOptions {
  cache?: ScanCacheOptions;
}

export class TestScanner {
  private cache: ScanCache | null;

  constructor(options?: TestScannerOptions) {
    this.cache = options?.cache ? new ScanCache(options.cache) : null;
  }

  async scan(projectRoot: string): Promise<TestScanResult> {
    const cacheKey = "test-scan";
    const deps = await this.scanDeps(projectRoot);

    if (this.cache) {
      const cached = await this.cache.get<TestScanResult>(cacheKey, deps);
      if (cached) return cached;
    }

    const frameworks = await this.detectFrameworks(projectRoot);
    const testFiles = await this.findTestFiles(projectRoot);
    const coverage = await this.findCoverage(projectRoot);

    const matchedTestFiles: TestFile[] = [];
    for (const tf of testFiles) {
      const relatedSourceModule = await this.matchToSource(tf, projectRoot);
      matchedTestFiles.push({ ...tf, relatedSourceModule });
    }

    const summary = formatTestSummary({
      frameworks,
      testFiles: matchedTestFiles,
      coverage,
      testFileCount: matchedTestFiles.length,
    });

    const result: TestScanResult = {
      frameworks,
      testFiles: matchedTestFiles,
      coverage,
      testFileCount: matchedTestFiles.length,
      summary,
    };

    if (this.cache) {
      await this.cache.set(cacheKey, result, deps);
    }

    return result;
  }

  private async scanDeps(projectRoot: string): Promise<string[]> {
    const deps: string[] = [];
    const pkg = path.join(projectRoot, "package.json");
    if (await fileExists(pkg)) deps.push(pkg);
    const gitHead = path.join(projectRoot, ".git", "HEAD");
    if (await fileExists(gitHead)) deps.push(gitHead);
    const configPatterns = [
      "vitest.config.*",
      "jest.config.*",
      "playwright.config.*",
      "cypress.config.*",
      ".mocharc.*",
      "ava.config.*",
    ];
    for (const pattern of configPatterns) {
      const found = await expandGlob(pattern, {
        cwd: projectRoot,
        absolute: true,
        onlyFiles: true,
      });
      deps.push(...found);
    }
    return deps;
  }

  async scanForModules(
    projectRoot: string,
    sourceFiles: string[],
  ): Promise<Map<string, TestFile[]>> {
    const testFiles = await this.findTestFiles(projectRoot);
    const matchMap = new Map<string, TestFile[]>();

    const sourceRels = new Map<string, string>();
    for (const src of sourceFiles) {
      const rel = path.relative(projectRoot, src);
      sourceRels.set(rel, src);
    }

    for (const tf of testFiles) {
      const matchedSource = await this.matchToSource(tf, projectRoot);
      if (matchedSource !== null && sourceRels.has(matchedSource)) {
        const rel = matchedSource;
        const existing = matchMap.get(rel) ?? [];
        existing.push({ ...tf, relatedSourceModule: matchedSource });
        matchMap.set(rel, existing);
      }
    }

    return matchMap;
  }

  private async detectFrameworks(projectRoot: string): Promise<TestFramework[]> {
    const knownFrameworks = ["vitest", "jest", "mocha", "playwright", "cypress", "ava"];
    const results: TestFramework[] = [];

    const pkgPath = path.join(projectRoot, "package.json");
    let pkgDeps: Record<string, string> = {};
    let pkgDevDeps: Record<string, string> = {};
    let scripts: Record<string, string> = {};

    if (await fileExists(pkgPath)) {
      try {
        const content = await readTextFile(pkgPath);
        const pkg = JSON.parse(content) as Record<string, unknown>;
        pkgDeps = (pkg.dependencies as Record<string, string>) ?? {};
        pkgDevDeps = (pkg.devDependencies as Record<string, string>) ?? {};
        scripts = (pkg.scripts as Record<string, string>) ?? {};
      } catch {
        // ignore
      }
    }

    const allDeps = new Set([...Object.keys(pkgDeps), ...Object.keys(pkgDevDeps)]);

    for (const name of knownFrameworks) {
      const hasDep = allDeps.has(name);
      const hasScriptDep = Object.values(scripts).some((s) => s.includes(name));
      const configPatterns = FRAMEWORK_CONFIG_MAP[name] ?? [];
      const configFiles: string[] = [];
      for (const pattern of configPatterns) {
        const found = await expandGlob(pattern, {
          cwd: projectRoot,
          absolute: false,
          onlyFiles: true,
        });
        configFiles.push(...found);
      }

      if (hasDep || hasScriptDep || configFiles.length > 0) {
        results.push({
          name,
          configFiles,
          configPresent: configFiles.length > 0,
        });
      }
    }

    const allScripts = Object.values(scripts).join(" ");
    if (allScripts.includes("pytest") && !results.some((f) => f.name === "pytest")) {
      results.push({ name: "pytest", configFiles: [], configPresent: false });
    }
    if (allScripts.includes("go test") && !results.some((f) => f.name === "go-test")) {
      results.push({ name: "go-test", configFiles: [], configPresent: false });
    }

    return results;
  }

  private async findTestFiles(
    projectRoot: string,
  ): Promise<Omit<TestFile, "relatedSourceModule">[]> {
    const testFiles: Omit<TestFile, "relatedSourceModule">[] = [];
    const frameworkNames = (await this.detectFrameworks(projectRoot)).map((f) => f.name);
    const primaryFramework = frameworkNames[0] ?? "unknown";

    for (const pattern of TEST_FILE_PATTERNS) {
      const files = await expandGlob(pattern, {
        cwd: projectRoot,
        absolute: true,
        onlyFiles: true,
      });

      for (const filePath of files) {
        const rel = path.relative(projectRoot, filePath);
        const parts = rel.split(path.sep);
        if (parts.some((p) => EXCLUDED_DIRS.has(p))) continue;

        if (testFiles.some((f) => f.filePath === filePath)) continue;

        let stat: { size: number } | null = null;
        try {
          const fsStat = await import("node:fs/promises").then((m) => m.stat(filePath));
          stat = fsStat;
        } catch {
          stat = { size: 0 };
        }

        testFiles.push({
          filePath,
          relativePath: rel,
          framework: primaryFramework,
          size: stat?.size ?? 0,
        });
      }
    }

    return testFiles;
  }

  private async matchToSource(
    testFile: Omit<TestFile, "relatedSourceModule">,
    projectRoot: string,
  ): Promise<string | null> {
    const parsed = path.parse(testFile.relativePath);
    const baseName = parsed.name.replace(/\.(test|spec)$/, "");

    const srcDirs = ["src", "lib", "app"];
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

    const testDirRoot = parsed.dir.split(path.sep)[0]!;
    const testDirs = new Set(["tests", "__tests__", "spec", "test", "e2e"]);

    const subPath = testDirs.has(testDirRoot)
      ? parsed.dir.slice(testDirRoot.length).replace(/^[/\\]/, "")
      : parsed.dir;

    for (const srcDir of srcDirs) {
      for (const ext of extensions) {
        const candidate = subPath
          ? path.join(projectRoot, srcDir, subPath, `${baseName}${ext}`)
          : path.join(projectRoot, srcDir, `${baseName}${ext}`);

        if (await fileExists(candidate)) {
          return path.relative(projectRoot, candidate);
        }
      }
    }

    for (const ext of extensions) {
      const candidate = path.join(projectRoot, parsed.dir, `${baseName}${ext}`);
      if (await fileExists(candidate)) {
        return path.relative(projectRoot, candidate);
      }
    }

    return null;
  }

  private async findCoverage(projectRoot: string): Promise<TestCoverageInfo> {
    const coverageDir = path.join(projectRoot, "coverage");
    const reports: string[] = [];
    let lines: number | null = null;
    let branches: number | null = null;
    let functions: number | null = null;

    const dirExists = await fileExists(coverageDir);
    if (!dirExists) {
      return { available: false, reports: [], lines: null, branches: null, functions: null };
    }

    for (const pattern of COVERAGE_REPORT_PATTERNS) {
      const files = await expandGlob(pattern, {
        cwd: projectRoot,
        absolute: true,
        onlyFiles: true,
      });
      reports.push(...files);
    }

    const summaryPath = path.join(projectRoot, "coverage", "coverage-summary.json");
    if (await fileExists(summaryPath)) {
      try {
        const content = await readTextFile(summaryPath);
        const summary = JSON.parse(content) as Record<string, unknown>;
        const total = summary.total as Record<string, { pct: number }> | undefined;
        if (total) {
          lines = total.lines?.pct ?? null;
          branches = total.branches?.pct ?? null;
          functions = total.functions?.pct ?? null;
        }
      } catch {
        // ignore parse errors
      }
    }

    if (lines === null) {
      const lcovPath = path.join(projectRoot, "coverage", "lcov.info");
      if (await fileExists(lcovPath)) {
        try {
          const content = await readTextFile(lcovPath);
          const linesMatch = content.match(/^DA:(\d+),(\d+)/gm);
          if (linesMatch && linesMatch.length > 0) {
            const total = linesMatch.length;
            const hit = linesMatch.filter((l) => l.endsWith(",1")).length;
            lines = total > 0 ? Math.round((hit / total) * 100) : null;
          }
        } catch {
          // ignore
        }
      }
    }

    return {
      available: reports.length > 0 || lines !== null,
      reports,
      lines,
      branches,
      functions,
    };
  }
}
