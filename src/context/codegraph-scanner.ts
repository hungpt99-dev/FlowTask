import path from "node:path";
import crypto from "node:crypto";
import { fileExists, readTextFile } from "../utils/fs.js";
import { ScanCache, type ScanCacheOptions } from "./scan-cache.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

const IMPORT_PATTERN =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"])([^'"]+)(?:['"])|(?:import\s*\(\s*['"])([^'"]+)(?:['"]\s*\))/g;
const EXPORT_PATTERN =
  /export\s+(?:(?:default\s+)?(?:function|class|const|let|var|interface|type|enum|abstract\s+class)\s+(\w+)|default\s+(\w+)|{([^}]+)})/g;
const RE_EXPORT_PATTERN = /export\s+(?:type\s+)?{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g;

export interface CodeGraphModule {
  filePath: string;
  relativePath: string;
  imports: string[];
  exports: string[];
  isEntryPoint: boolean;
  relatedTests: string[];
}

export interface CodeGraphEdge {
  from: string;
  to: string;
  type: "import";
}

export interface CodeGraph {
  files: CodeGraphModule[];
  edges: CodeGraphEdge[];
  entryPoints: string[];
}

export interface CodeGraphScanResult {
  graph: CodeGraph;
  context: string;
}

export function formatCodeGraph(graph: CodeGraph): string {
  const lines: string[] = [];
  lines.push(`Files: ${graph.files.length}`);
  lines.push(`Edges: ${graph.edges.length}`);
  lines.push(`Entry Points: ${graph.entryPoints.join(", ") || "none"}`);

  if (graph.files.length > 0) {
    lines.push("\n### Module Graph");
    for (const mod of graph.files) {
      lines.push(`\n**${mod.relativePath}**${mod.isEntryPoint ? " (entry)" : ""}`);

      if (mod.exports.length > 0) {
        lines.push(`  Exports: ${mod.exports.join(", ")}`);
      }

      if (mod.imports.length > 0) {
        const localImports = mod.imports.filter((i) => i.startsWith("."));
        const externalImports = mod.imports.filter((i) => !i.startsWith("."));
        if (localImports.length > 0) {
          lines.push(`  Imports (local): ${localImports.join(", ")}`);
        }
        if (externalImports.length > 0) {
          lines.push(`  Imports (external): ${externalImports.join(", ")}`);
        }
      }

      if (mod.relatedTests.length > 0) {
        lines.push(`  Tests: ${mod.relatedTests.join(", ")}`);
      }
    }
  }

  return lines.join("\n");
}

export interface CodeGraphScannerOptions {
  cache?: ScanCacheOptions;
}

export class CodeGraphScanner {
  private cache: ScanCache | null;

  constructor(options?: CodeGraphScannerOptions) {
    this.cache = options?.cache ? new ScanCache(options.cache) : null;
  }

  async scan(files: string[], projectRoot: string): Promise<CodeGraphScanResult> {
    const sourceFiles = files.filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return SOURCE_EXTENSIONS.has(ext);
    });

    if (sourceFiles.length === 0) {
      return emptyResult();
    }

    const cacheKey = this.cacheKey(sourceFiles);

    if (this.cache) {
      const cached = await this.cache.get<CodeGraphScanResult>(cacheKey, sourceFiles);
      if (cached) return cached;
    }

    const parsed = new Map<string, { imports: string[]; exports: string[] }>();

    for (const filePath of sourceFiles) {
      try {
        const content = await readTextFile(filePath);
        const imports = this.parseImports(content);
        const exports = this.parseExports(content);
        parsed.set(filePath, { imports, exports });
      } catch {
        continue;
      }
    }

    if (parsed.size === 0) {
      return emptyResult();
    }

    const entryPoints = await this.findEntryPoints(projectRoot);

    const modules: CodeGraphModule[] = [];
    const edges: CodeGraphEdge[] = [];

    for (const [filePath, data] of parsed) {
      const relativePath = path.relative(projectRoot, filePath);
      const relatedTests = await this.findRelatedTests(filePath, relativePath, projectRoot);
      const isEntryPoint = entryPoints.some((ep) => {
        const abs = path.resolve(projectRoot, ep);
        return abs === filePath;
      });

      modules.push({
        filePath,
        relativePath: relativePath.replaceAll(path.sep, "/"),
        imports: data.imports,
        exports: data.exports,
        isEntryPoint,
        relatedTests,
      });

      for (const imp of data.imports) {
        if (imp.startsWith(".")) {
          const resolved = await this.resolveRelativeImport(filePath, imp);
          if (resolved && parsed.has(resolved)) {
            edges.push({
              from: filePath,
              to: resolved,
              type: "import",
            });
          }
        }
      }
    }

    const context = await this.buildContext(modules, edges, entryPoints);

    const result: CodeGraphScanResult = { graph: { files: modules, edges, entryPoints }, context };

    if (this.cache) {
      await this.cache.set(cacheKey, result, sourceFiles);
    }

    return result;
  }

  private cacheKey(files: string[]): string {
    const sorted = [...files].sort();
    const hash = crypto.createHash("sha256").update(sorted.join("\0")).digest("hex").slice(0, 16);
    return `codegraph-${hash}`;
  }

  private async buildContext(
    modules: CodeGraphModule[],
    edges: CodeGraphEdge[],
    entryPoints: string[],
  ): Promise<string> {
    const parts: string[] = [];

    parts.push("## Code Graph Context");
    parts.push(`Scanned ${modules.length} source file(s) with ${edges.length} import edge(s).`);
    parts.push("");

    if (entryPoints.length > 0) {
      const ep = entryPoints.map((e) => {
        const fromRoot = modules.find(
          (m) => m.filePath === path.resolve(process.cwd(), e) || m.relativePath === e,
        );
        return fromRoot ? fromRoot.relativePath : e;
      });
      parts.push(`Entry Points: ${ep.join(", ")}`);
      parts.push("");
    }

    for (const mod of modules) {
      parts.push(`### ${mod.relativePath}${mod.isEntryPoint ? " (entry point)" : ""}`);

      if (mod.exports.length > 0) {
        parts.push(`Exports: ${mod.exports.join(", ")}`);
      }

      const localImports = mod.imports.filter((i) => i.startsWith("."));
      const externalImports = mod.imports.filter((i) => !i.startsWith("."));

      if (localImports.length > 0) {
        for (const li of localImports) {
          const resolved = await this.findResolvedTarget(mod.filePath, li, modules);
          if (resolved) {
            parts.push(`→ imports ${li} → \`${resolved}\``);
          } else {
            parts.push(`→ imports \`${li}\``);
          }
        }
      }

      if (externalImports.length > 0) {
        const unique = [...new Set(externalImports)];
        parts.push(`External deps: ${unique.join(", ")}`);
      }

      if (mod.relatedTests.length > 0) {
        parts.push(`Tests: ${mod.relatedTests.join(", ")}`);
      }

      parts.push("");
    }

    return parts.join("\n");
  }

  private async findResolvedTarget(
    fromFile: string,
    importPath: string,
    modules: CodeGraphModule[],
  ): Promise<string | null> {
    const resolved = await this.resolveRelativeImport(fromFile, importPath);
    if (!resolved) return null;
    const found = modules.find((m) => m.filePath === resolved);
    return found ? found.relativePath : null;
  }

  parseImports(content: string): string[] {
    const imports: string[] = [];
    let match: RegExpExecArray | null;

    const cleaned = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    const reImport = IMPORT_PATTERN;
    reImport.lastIndex = 0;
    while ((match = reImport.exec(cleaned)) !== null) {
      const source = (match[1] ?? match[2])!;
      const normalized = source.endsWith(".js") ? source.slice(0, -3) : source;
      if (!imports.includes(normalized)) {
        imports.push(normalized);
      }
    }

    return imports;
  }

  parseExports(content: string): string[] {
    const exports: string[] = [];

    const cleaned = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    let match: RegExpExecArray | null;

    const reExport = EXPORT_PATTERN;
    reExport.lastIndex = 0;
    while ((match = reExport.exec(cleaned)) !== null) {
      const name = match[1] ?? match[2];
      if (name) {
        if (!exports.includes(name)) {
          exports.push(name);
        }
      }
      if (match[3]) {
        const members = match[3].split(",").map((s) => {
          const trimmed = s.trim();
          const asMatch = trimmed.match(/^(\w+)\s+as\s+\w+$/);
          return asMatch ? asMatch[1]! : trimmed;
        });
        for (const m of members) {
          if (m && !exports.includes(m)) {
            exports.push(m);
          }
        }
      }
    }

    const reReExport = RE_EXPORT_PATTERN;
    reReExport.lastIndex = 0;
    while ((match = reReExport.exec(cleaned)) !== null) {
      const members = match[1]!.split(",").map((s) => {
        const trimmed = s.trim();
        const asMatch = trimmed.match(/^(\w+)\s+as\s+\w+$/);
        return asMatch ? asMatch[1]! : trimmed;
      });
      for (const m of members) {
        if (m && !exports.includes(m)) {
          exports.push(m);
        }
      }
    }

    return exports;
  }

  private async resolveRelativeImport(
    fromFile: string,
    importPath: string,
  ): Promise<string | null> {
    const dir = path.dirname(fromFile);
    const resolvedBase = path.resolve(dir, importPath);

    const candidates = [
      resolvedBase,
      `${resolvedBase}.ts`,
      `${resolvedBase}.tsx`,
      `${resolvedBase}.js`,
      `${resolvedBase}.jsx`,
      `${resolvedBase}.mjs`,
      `${resolvedBase}.cjs`,
      `${resolvedBase}.mts`,
      `${resolvedBase}.cts`,
      path.join(resolvedBase, "index.ts"),
      path.join(resolvedBase, "index.tsx"),
      path.join(resolvedBase, "index.js"),
      path.join(resolvedBase, "index.jsx"),
    ];

    for (const candidate of candidates) {
      if (candidate === resolvedBase) continue;
      if (await fileExists(candidate)) return candidate;
    }

    return null;
  }

  private async findEntryPoints(projectRoot: string): Promise<string[]> {
    const entries: string[] = [];

    try {
      const pkgPath = path.join(projectRoot, "package.json");
      if (await fileExists(pkgPath)) {
        const content = await readTextFile(pkgPath);
        const pkg = JSON.parse(content) as Record<string, unknown>;

        const main = pkg.main as string | undefined;
        const module = pkg.module as string | undefined;
        const bin = pkg.bin as Record<string, string> | string | undefined;

        if (main) entries.push(main);
        if (module && !entries.includes(module)) entries.push(module);
        if (bin) {
          if (typeof bin === "string") {
            if (!entries.includes(bin)) entries.push(bin);
          } else {
            for (const b of Object.values(bin)) {
              if (!entries.includes(b)) entries.push(b);
            }
          }
        }
      }
    } catch {
      // ignore
    }

    const srcIndex = path.join(projectRoot, "src", "index.ts");
    if (await fileExists(srcIndex)) {
      const rel = "src/index.ts";
      if (!entries.includes(rel)) entries.push(rel);
    }

    return entries;
  }

  private async findRelatedTests(
    filePath: string,
    relativePath: string,
    projectRoot: string,
  ): Promise<string[]> {
    const tests: string[] = [];
    const parsed = path.parse(relativePath);
    const testDirs = ["tests", "__tests__", "spec", "test", "e2e"];

    const baseName = parsed.name;
    const testVariants = [
      `${baseName}.test.ts`,
      `${baseName}.test.tsx`,
      `${baseName}.spec.ts`,
      `${baseName}.spec.tsx`,
      `${baseName}.test.js`,
      `${baseName}.spec.js`,
    ];

    for (const td of testDirs) {
      const testDir = path.join(projectRoot, td);
      if (!(await fileExists(testDir))) continue;

      for (const variant of testVariants) {
        const testPath = path.join(testDir, variant);
        if (await fileExists(testPath)) {
          tests.push(`${td}/${variant}`);
        }
      }
    }

    return tests;
  }
}

function emptyResult(): CodeGraphScanResult {
  return {
    graph: { files: [], edges: [], entryPoints: [] },
    context: "## Code Graph Context\nNo source files to scan.\n",
  };
}
