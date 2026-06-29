import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileExists, readTextFile, readDir } from "../utils/fs.js";
import { commandExists } from "../utils/command-exists.js";
import {
  CodeGraphScanner,
  type CodeGraph,
  type CodeGraphModule,
  type CodeGraphEdge,
} from "../context/codegraph-scanner.js";

// ── CodeGraphProvider Interface ───────────────────────

export interface CodeGraphProviderConfig {
  projectRoot: string;
  enableCache?: boolean;
}

export interface SymbolInfo {
  name: string;
  filePath: string;
  line?: number;
  kind?: string;
  signature?: string;
}

export interface FileRelationship {
  filePath: string;
  imports: string[];
  importedBy: string[];
}

export interface ImpactResult {
  symbol: string;
  callers: { filePath: string; line?: number }[];
  callees: { filePath: string; line?: number }[];
  affectedFiles: string[];
  riskLevel: "low" | "medium" | "high";
}

export interface CodeContextResult {
  relevantFiles: string[];
  importGraph: { from: string; to: string; type: string }[];
  entryPoints: string[];
  relatedTests: string[];
  summary: string;
  codeGraph: CodeGraph | null;
}

// ── Provider Status ───────────────────────────────────

export type CodeGraphStatus = "available" | "unavailable" | "not_indexed";

// ── CodeGraphProvider ─────────────────────────────────

export class CodeGraphProvider {
  private projectRoot: string;
  private codegraphCmd: string | null = null;
  private codegraphAvailable = false;
  private enableCache: boolean;
  private fallbackScanner: CodeGraphScanner;
  private indexed = false;

  constructor(config: CodeGraphProviderConfig) {
    this.projectRoot = config.projectRoot;
    this.enableCache = config.enableCache ?? true;
    this.fallbackScanner = new CodeGraphScanner(this.enableCache ? {} : undefined);
  }

  async initialize(): Promise<CodeGraphStatus> {
    if (await this.detectCodeGraph()) {
      const hasIndex = await this.hasCodeGraphIndex();
      this.codegraphAvailable = true;
      this.indexed = hasIndex;
      return hasIndex ? "available" : "not_indexed";
    }

    this.codegraphAvailable = false;
    this.indexed = false;
    return "unavailable";
  }

  getStatus(): CodeGraphStatus {
    if (!this.codegraphAvailable) return "unavailable";
    if (!this.indexed) return "not_indexed";
    return "available";
  }

  isAvailable(): boolean {
    return this.codegraphAvailable && this.indexed;
  }

  // ── Symbol Lookup ──────────────────────────────────

  async getSymbolInfo(symbolName: string): Promise<SymbolInfo | null> {
    if (this.isAvailable()) {
      return this.queryCodeGraphNode(symbolName);
    }
    return this.fallbackSymbolLookup(symbolName);
  }

  // ── File Relationships ─────────────────────────────

  async getFileRelationships(filePath: string): Promise<FileRelationship> {
    const imports = await this.parseImports(filePath);
    const importedBy = await this.findImporters(filePath);
    return { filePath, imports, importedBy };
  }

  // ── Impact Analysis ────────────────────────────────

  async analyzeImpact(symbolName: string): Promise<ImpactResult> {
    if (this.isAvailable()) {
      return this.queryCodeGraphImpact(symbolName);
    }
    return this.fallbackImpactAnalysis(symbolName);
  }

  // ── Relevant File Discovery ────────────────────────

  async findRelevantFiles(query: string): Promise<string[]> {
    if (this.isAvailable()) {
      const result = await this.queryCodeGraphExplore(query);
      if (result.length > 0) return result;
    }

    return this.fallbackKeywordSearch(query);
  }

  // ── Related Tests ──────────────────────────────────

  async findRelatedTests(filePath: string): Promise<string[]> {
    const relativePath = path.relative(this.projectRoot, filePath);
    const parsed = path.parse(relativePath);
    const baseName = parsed.name;

    return this.discoverTestFiles(baseName);
  }

  // ── Entry Point Detection ──────────────────────────

  async findEntryPoints(): Promise<string[]> {
    const entries: string[] = [];

    const pkgPath = path.join(this.projectRoot, "package.json");
    if (await fileExists(pkgPath)) {
      try {
        const content = await readTextFile(pkgPath);
        const pkg = JSON.parse(content) as Record<string, unknown>;
        const main = pkg.main as string | undefined;
        const module = pkg.module as string | undefined;
        if (main && !entries.includes(main)) entries.push(main);
        if (module && !entries.includes(module)) entries.push(module);
      } catch {
        // ignore
      }
    }

    const srcIndex = path.join(this.projectRoot, "src", "index.ts");
    if (await fileExists(srcIndex)) {
      const rel = "src/index.ts";
      if (!entries.includes(rel)) entries.push(rel);
    }

    return entries;
  }

  // ── Import Graph ───────────────────────────────────

  async buildImportGraph(
    filePaths: string[],
  ): Promise<{ from: string; to: string; type: string }[]> {
    const result = await this.fallbackScanner.scan(filePaths, this.projectRoot);
    return result.graph.edges.map((e: CodeGraphEdge) => ({
      from: path.relative(this.projectRoot, e.from),
      to: path.relative(this.projectRoot, e.to),
      type: e.type,
    }));
  }

  // ── Code Context ───────────────────────────────────

  async buildCodeContext(codeFiles: string[]): Promise<CodeContextResult> {
    const scanResult = await this.fallbackScanner.scan(codeFiles, this.projectRoot);
    const graph = scanResult.graph;

    const relevantFiles = graph.files.map((f: CodeGraphModule) => f.relativePath);
    const importGraph = graph.edges.map((e: CodeGraphEdge) => ({
      from: path.relative(this.projectRoot, e.from),
      to: path.relative(this.projectRoot, e.to),
      type: e.type,
    }));

    const relatedTests: string[] = [];
    for (const mod of graph.files) {
      for (const test of mod.relatedTests) {
        if (!relatedTests.includes(test)) relatedTests.push(test);
      }
    }

    let summary = "";
    if (this.isAvailable()) {
      summary = `CodeGraph indexed: ${graph.files.length} files, ${graph.edges.length} import edges`;
    } else {
      summary = `Lightweight scan: ${graph.files.length} files, ${graph.edges.length} import edges (CodeGraph CLI unavailable)`;
    }

    return {
      relevantFiles,
      importGraph,
      entryPoints: graph.entryPoints,
      relatedTests,
      summary,
      codeGraph: graph.files.length > 0 ? graph : null,
    };
  }

  // ── Index Project ──────────────────────────────────

  async indexProject(): Promise<boolean> {
    if (!this.codegraphAvailable) return false;

    try {
      const result = spawnSync(this.codegraphCmd!, ["trigger"], {
        cwd: this.projectRoot,
        stdio: "ignore",
        timeout: 30000,
      });
      this.indexed = result.status === 0;
      return this.indexed;
    } catch {
      this.indexed = false;
      return false;
    }
  }

  // ── Private: detect CodeGraph CLI ──────────────────

  private async detectCodeGraph(): Promise<boolean> {
    if (commandExists("codegraph")) {
      this.codegraphCmd = "codegraph";
      return true;
    }

    try {
      const result = spawnSync("npx", ["--yes", "codegraph", "--version"], {
        stdio: "pipe",
        timeout: 15000,
      });
      if (result.status === 0) {
        this.codegraphCmd = "codegraph";
        return true;
      }
    } catch {
      // not available via npx either
    }

    return false;
  }

  private async hasCodeGraphIndex(): Promise<boolean> {
    const codegraphDir = path.join(this.projectRoot, ".codegraph");
    return fileExists(codegraphDir);
  }

  // ── Private: query CodeGraph CLI ───────────────────

  private async queryCodeGraphNode(symbol: string): Promise<SymbolInfo | null> {
    try {
      const result = spawnSync(this.codegraphCmd!, ["node", symbol], {
        cwd: this.projectRoot,
        stdio: "pipe",
        timeout: 10000,
      });
      if (result.status !== 0 || !result.stdout) return null;

      const output = result.stdout.toString("utf-8");
      const lines = output.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length === 0) return null;

      const firstLine = lines[0]!;
      const locationMatch = firstLine.match(/(.+):(\d+)/);
      if (locationMatch) {
        return {
          name: symbol,
          filePath: locationMatch[1]!.trim(),
          line: parseInt(locationMatch[2]!, 10),
          kind: this.inferKind(output),
        };
      }

      return { name: symbol, filePath: firstLine.trim(), kind: this.inferKind(output) };
    } catch {
      return null;
    }
  }

  private async queryCodeGraphImpact(_symbol: string): Promise<ImpactResult> {
    try {
      const result = spawnSync(this.codegraphCmd!, ["callers", _symbol], {
        cwd: this.projectRoot,
        stdio: "pipe",
        timeout: 10000,
      });
      const callers: { filePath: string; line?: number }[] = [];
      if (result.status === 0 && result.stdout) {
        const output = result.stdout.toString("utf-8");
        for (const line of output.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          const match = trimmed.match(/^(.*\.ts):(\d+)/);
          if (match) {
            callers.push({ filePath: match[1]!, line: parseInt(match[2]!, 10) });
          } else {
            callers.push({ filePath: trimmed });
          }
        }
      }

      const affectedFiles = [...new Set(callers.map((c) => c.filePath))];
      return {
        symbol: _symbol,
        callers,
        callees: [],
        affectedFiles,
        riskLevel: affectedFiles.length > 5 ? "high" : affectedFiles.length > 2 ? "medium" : "low",
      };
    } catch {
      return {
        symbol: _symbol,
        callers: [],
        callees: [],
        affectedFiles: [],
        riskLevel: "low",
      };
    }
  }

  private async queryCodeGraphExplore(query: string): Promise<string[]> {
    try {
      const result = spawnSync(this.codegraphCmd!, ["explore", query], {
        cwd: this.projectRoot,
        stdio: "pipe",
        timeout: 15000,
      });
      if (result.status !== 0 || !result.stdout) return [];

      const output = result.stdout.toString("utf-8");
      const files: string[] = [];
      for (const line of output.split("\n")) {
        const match = line.match(/^#\s+(.+\.(?:ts|tsx|js|jsx))/);
        if (match && !files.includes(match[1]!)) {
          files.push(match[1]!);
        }
      }
      return files;
    } catch {
      return [];
    }
  }

  // ── Private: fallback methods ──────────────────────

  private async fallbackSymbolLookup(symbolName: string): Promise<SymbolInfo | null> {
    const sourceExts = [".ts", ".tsx", ".js", ".jsx"];
    const srcDir = path.join(this.projectRoot, "src");
    const dirExists = await fileExists(srcDir);
    if (!dirExists) return null;

    const allFiles = await this.walkDir(srcDir);
    const sourceFiles = allFiles.filter((f) => sourceExts.includes(path.extname(f)));

    const exportPattern = new RegExp(
      `export\\s+(?:(?:default\\s+)?(?:function|class|const|let|var|interface|type|enum)\\s+)?${symbolName}\\b`,
    );
    const functionPattern = new RegExp(
      `(?:function|const|let|var)\\s+${symbolName}\\s*(?:[=<:(]|\\s+)`,
    );

    for (const filePath of sourceFiles) {
      try {
        const content = await readTextFile(filePath);
        if (exportPattern.test(content) || functionPattern.test(content)) {
          return {
            name: symbolName,
            filePath: path.relative(this.projectRoot, filePath),
            kind: "symbol",
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async fallbackImpactAnalysis(_symbol: string): Promise<ImpactResult> {
    const srcDir = path.join(this.projectRoot, "src");
    const dirExists = await fileExists(srcDir);
    if (!dirExists) {
      return { symbol: _symbol, callers: [], callees: [], affectedFiles: [], riskLevel: "low" };
    }

    const allFiles = await this.walkDir(srcDir);
    const sourceFiles = allFiles.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

    const affectedFiles: string[] = [];
    const pattern = new RegExp(`\\b${_symbol}\\b`);

    for (const filePath of sourceFiles) {
      try {
        const content = await readTextFile(filePath);
        if (pattern.test(content)) {
          affectedFiles.push(path.relative(this.projectRoot, filePath));
        }
      } catch {
        continue;
      }
    }

    return {
      symbol: _symbol,
      callers: [],
      callees: [],
      affectedFiles,
      riskLevel: affectedFiles.length > 5 ? "high" : affectedFiles.length > 2 ? "medium" : "low",
    };
  }

  private async fallbackKeywordSearch(query: string): Promise<string[]> {
    const srcDir = path.join(this.projectRoot, "src");
    const dirExists = await fileExists(srcDir);
    if (!dirExists) return [];

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (keywords.length === 0) return [];

    const allFiles = await this.walkDir(srcDir);
    const sourceFiles = allFiles.filter(
      (f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"),
    );

    const scored: { filePath: string; score: number }[] = [];
    for (const filePath of sourceFiles) {
      try {
        const content = await readTextFile(filePath);
        const lower = content.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
          const regex = new RegExp(`\\b${kw}\\b`, "gi");
          const matches = lower.match(regex);
          if (matches) score += matches.length * 10;
          if (path.basename(filePath).toLowerCase().includes(kw)) score += 50;
          if (path.dirname(filePath).toLowerCase().includes(kw)) score += 20;
        }
        if (score > 0) {
          scored.push({ filePath: path.relative(this.projectRoot, filePath), score });
        }
      } catch {
        continue;
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 20).map((s) => s.filePath);
  }

  // ── Private: file utilities ─────────────────────────

  private async walkDir(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await readDir(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stat = await import("node:fs/promises").then((fs) => fs.stat(fullPath));
        if (stat.isDirectory()) {
          if (!entry.startsWith(".") && entry !== "node_modules") {
            const sub = await this.walkDir(fullPath);
            results.push(...sub);
          }
        } else {
          results.push(fullPath);
        }
      } catch {
        continue;
      }
    }

    return results;
  }

  private async parseImports(filePath: string): Promise<string[]> {
    try {
      const content = await readTextFile(filePath);
      const importRegex =
        /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"])([^'"]+)(?:['"])|(?:import\s*\(\s*['"])([^'"]+)(?:['"]\s*\))/g;
      const imports: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const source = (match[1] ?? match[2])!;
        if (!imports.includes(source)) imports.push(source);
      }
      return imports;
    } catch {
      return [];
    }
  }

  private async findImporters(filePath: string): Promise<string[]> {
    const relativePath = path.relative(this.projectRoot, filePath);
    const nameWithoutExt = relativePath.replace(/\.(ts|tsx|js|jsx)$/, "");

    const srcDir = path.join(this.projectRoot, "src");
    const dirExists = await fileExists(srcDir);
    if (!dirExists) return [];

    const allFiles = await this.walkDir(srcDir);
    const sourceFiles = allFiles.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

    const importers: string[] = [];
    const importPattern = new RegExp(
      `from\\s+['"]\\.\\.?/(?:[^'"]*/)?${nameWithoutExt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`,
    );

    for (const sf of sourceFiles) {
      if (sf === filePath) continue;
      try {
        const content = await readTextFile(sf);
        if (importPattern.test(content)) {
          importers.push(path.relative(this.projectRoot, sf));
        }
      } catch {
        continue;
      }
    }

    return importers;
  }

  private async discoverTestFiles(baseName: string): Promise<string[]> {
    const testDirs = ["tests", "__tests__", "spec", "test", "e2e"];
    const testVariants = [
      `${baseName}.test.ts`,
      `${baseName}.test.tsx`,
      `${baseName}.spec.ts`,
      `${baseName}.spec.tsx`,
      `${baseName}.test.js`,
      `${baseName}.spec.js`,
    ];

    const results: string[] = [];
    for (const td of testDirs) {
      const testDir = path.join(this.projectRoot, td);
      if (!(await fileExists(testDir))) continue;
      for (const variant of testVariants) {
        const testPath = path.join(testDir, variant);
        if (await fileExists(testPath)) {
          results.push(`${td}/${variant}`);
        }
      }
    }

    return results;
  }

  private inferKind(_output: string): string {
    if (_output.includes("function ") || _output.includes("function\t")) return "function";
    if (_output.includes("class ") || _output.includes("class\t")) return "class";
    if (_output.includes("interface ")) return "interface";
    if (_output.includes("type ")) return "type";
    if (_output.includes("const ") || _output.includes("let ") || _output.includes("var ")) {
      return "variable";
    }
    return "symbol";
  }
}
