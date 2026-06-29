import path from "node:path";
import { ProjectScanner, type ProjectMetadata } from "./project-scanner.js";
import { GitScanner, type GitStatus } from "./git-scanner.js";
import { KeywordScanner, type KeywordMatch } from "./keyword-scanner.js";
import { CodeGraphScanner, type CodeGraph } from "./codegraph-scanner.js";
import { TestScanner, type TestScanResult } from "./test-scanner.js";

export interface TaskContext {
  projectMeta: ProjectMetadata;
  gitStatus: GitStatus;
  keywordMatches: KeywordMatch[];
  codeGraph: CodeGraph | null;
  testResult: TestScanResult | null;
  contextPack: string;
}

export interface TaskContextBuilderOptions {
  cacheDir?: string;
  useCache?: boolean;
}

export class TaskContextBuilder {
  private projectScanner: ProjectScanner;
  private gitScanner: GitScanner;
  private keywordScanner: KeywordScanner;
  private codeGraphScanner: CodeGraphScanner;
  private testScanner: TestScanner;

  constructor(options?: TaskContextBuilderOptions) {
    const cacheDir = options?.cacheDir;
    const useCache = options?.useCache ?? true;
    const cache = cacheDir && useCache ? { cacheDir, useCache } : undefined;

    this.projectScanner = new ProjectScanner(cache ? { cache } : undefined);
    this.gitScanner = new GitScanner(cache ? { cache } : undefined);
    this.keywordScanner = new KeywordScanner(cache ? { cache } : undefined);
    this.codeGraphScanner = new CodeGraphScanner(cache ? { cache } : undefined);
    this.testScanner = new TestScanner(cache ? { cache } : undefined);
  }

  async build(projectRoot: string, prompt: string): Promise<TaskContext> {
    const projectMeta: ProjectMetadata = await this.projectScanner.scanMetadata(projectRoot);
    const gitStatus: GitStatus = await this.gitScanner.scan(projectRoot);

    const keywordResult = await this.keywordScanner.scan(projectRoot, prompt);
    const keywordMatches: KeywordMatch[] = keywordResult.matches;

    const isCodeProject = projectMeta.type === "code" || projectMeta.type === "mixed";
    let codeGraph: CodeGraph | null = null;
    if (isCodeProject && keywordMatches.length > 0) {
      const result = await this.codeGraphScanner.scan(
        keywordMatches.map((m) => m.filePath),
        projectRoot,
      );
      if (result.graph.files.length > 0) {
        codeGraph = result.graph;
      }
    }

    let testResult: TestScanResult | null = null;
    if (projectMeta.hasTests) {
      const result = await this.testScanner.scan(projectRoot);
      if (result.testFiles.length > 0) {
        testResult = result;
      }
    }

    const contextPack = this.buildContextPack(
      projectMeta,
      gitStatus,
      keywordMatches,
      codeGraph,
      testResult,
    );

    return {
      projectMeta,
      gitStatus,
      keywordMatches,
      codeGraph,
      testResult,
      contextPack,
    };
  }

  formatSummary(ctx: TaskContext): string {
    return [
      `Project: ${ctx.projectMeta.name} (${ctx.projectMeta.type})`,
      `Branch: ${ctx.gitStatus.branch ?? "detached"}`,
      `Changes: ${ctx.gitStatus.hasChanges ? "yes" : "no"}`,
      `Keywords matched: ${ctx.keywordMatches.length} file(s)`,
      `Code graph: ${ctx.codeGraph ? `${ctx.codeGraph.files.length} module(s)` : "none"}`,
      `Tests: ${ctx.testResult ? `${ctx.testResult.testFileCount} file(s)` : "none"}`,
    ].join("\n");
  }

  private buildContextPack(
    projectMeta: ProjectMetadata,
    gitStatus: GitStatus,
    keywordMatches: KeywordMatch[],
    codeGraph: CodeGraph | null,
    testResult: TestScanResult | null,
  ): string {
    const parts: string[] = [];

    parts.push("## Project Context\n");
    this.appendProjectMeta(parts, projectMeta);
    parts.push("");

    parts.push("### Git Status\n");
    this.appendGitStatus(parts, gitStatus);
    parts.push("");

    if (keywordMatches.length > 0) {
      parts.push("### Relevant Files\n");
      this.appendKeywordMatches(parts, keywordMatches);
      parts.push("");
    }

    if (codeGraph) {
      parts.push("### Code Graph\n");
      this.appendCodeGraph(parts, codeGraph);
      parts.push("");
    }

    if (testResult) {
      parts.push("### Tests\n");
      this.appendTestResult(parts, testResult);
      parts.push("");
    }

    return parts.join("\n").trim();
  }

  private appendProjectMeta(parts: string[], meta: ProjectMetadata): void {
    parts.push(`- Name: ${meta.name}`);
    parts.push(`- Type: ${meta.type}`);
    if (meta.languages.length > 0) parts.push(`- Languages: ${meta.languages.join(", ")}`);
    if (meta.frameworks.length > 0) parts.push(`- Frameworks: ${meta.frameworks.join(", ")}`);
    if (meta.packageManager) parts.push(`- Package manager: ${meta.packageManager}`);
    if (meta.buildTool) parts.push(`- Build tool: ${meta.buildTool}`);
    if (meta.testFramework) parts.push(`- Test framework: ${meta.testFramework}`);
    if (meta.entryPoints.length > 0) parts.push(`- Entry points: ${meta.entryPoints.join(", ")}`);
    if (meta.importantFolders.length > 0)
      parts.push(`- Folders: ${meta.importantFolders.join(", ")}`);
    if (meta.configFiles.length > 0) parts.push(`- Config files: ${meta.configFiles.join(", ")}`);
    if (meta.docs.length > 0) parts.push(`- Docs: ${meta.docs.join(", ")}`);
    parts.push(`- Dependencies: ${meta.dependencies} (dev: ${meta.devDependencies})`);
  }

  private appendGitStatus(parts: string[], status: GitStatus): void {
    parts.push(`- Branch: ${status.branch ?? "detached"}`);
    parts.push(
      `- Modified: ${status.staged + status.unstaged} file(s) (${status.staged} staged, ${status.unstaged} unstaged, ${status.untracked} untracked)`,
    );
    if (status.recentCommits.length > 0) {
      const recent = status.recentCommits.slice(0, 3);
      for (const c of recent) {
        parts.push(`- [${c.hash.slice(0, 7)}] ${c.subject}`);
      }
    }
  }

  private appendKeywordMatches(parts: string[], matches: KeywordMatch[]): void {
    const grouped = new Map<string, KeywordMatch[]>();
    for (const m of matches) {
      const dir = path.dirname(m.relativePath);
      const group = grouped.get(dir) ?? [];
      group.push(m);
      grouped.set(dir, group);
    }

    for (const [, files] of [...grouped.entries()].sort()) {
      for (const f of files) {
        const label = "matched by " + f.matchedBy;
        parts.push(`- ${f.relativePath} (${label})`);
      }
    }
  }

  private appendCodeGraph(parts: string[], graph: CodeGraph): void {
    parts.push(`Modules: ${graph.files.length}, Edges: ${graph.edges.length}`);
    if (graph.entryPoints.length > 0) {
      parts.push(`Entry points: ${graph.entryPoints.join(", ")}`);
    }
    for (const mod of graph.files.slice(0, 20)) {
      const entryLabel = mod.isEntryPoint ? " [entry]" : "";
      parts.push(`\n#### ${mod.relativePath}${entryLabel}`);
      if (mod.exports.length > 0) {
        parts.push(`  Exports: ${mod.exports.join(", ")}`);
      }
      const localImports = mod.imports.filter((i) => i.startsWith("."));
      if (localImports.length > 0) {
        parts.push(`  Imports: ${localImports.join(", ")}`);
      }
      if (mod.relatedTests.length > 0) {
        parts.push(`  Tests: ${mod.relatedTests.join(", ")}`);
      }
    }
    if (graph.files.length > 20) {
      parts.push(`\n... and ${graph.files.length - 20} more module(s)`);
    }
  }

  private appendTestResult(parts: string[], result: TestScanResult): void {
    if (result.frameworks.length > 0) {
      const names = result.frameworks.map((f) => f.name);
      parts.push(`Framework(s): ${names.join(", ")}`);
    }
    parts.push(`Test files: ${result.testFileCount}`);
    if (result.coverage.available) {
      const covParts: string[] = ["Coverage:"];
      if (result.coverage.lines !== null) covParts.push(`lines ${result.coverage.lines}%`);
      if (result.coverage.branches !== null) covParts.push(`branches ${result.coverage.branches}%`);
      if (result.coverage.functions !== null)
        covParts.push(`functions ${result.coverage.functions}%`);
      if (covParts.length > 1) parts.push(covParts.join(" "));
    }
    if (result.testFiles.length > 0) {
      for (const tf of result.testFiles.slice(0, 15)) {
        const sourceInfo = tf.relatedSourceModule ? ` → ${tf.relatedSourceModule}` : "";
        parts.push(`- ${tf.relativePath}${sourceInfo}`);
      }
      if (result.testFiles.length > 15) {
        parts.push(`... and ${result.testFiles.length - 15} more`);
      }
    }
  }
}
