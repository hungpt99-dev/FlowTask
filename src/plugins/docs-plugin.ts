import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { fileExists, readDir } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

export const DOCS_PLUGIN_ID = "docs-plugin";
export const DOCS_PLUGIN_VERSION = "1.0.0";

export interface DocsPluginConfig {
  scanPatterns?: string[];
  docExtensions?: string[];
  checkBrokenLinks?: boolean;
  validateStructure?: boolean;
}

export class DocsPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: DOCS_PLUGIN_ID,
    name: "Docs Plugin",
    version: DOCS_PLUGIN_VERSION,
    description: "Documentation workflow plugin for scanning, validating, and tracking docs",
    capabilities: ["scanner", "planner-hint", "validator", "artifact-detector"],
  };

  private config: DocsPluginConfig = {};
  private projectRoot = "";

  constructor(config?: DocsPluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;
    const pluginCfg = (context.pluginConfig?.docs ?? {}) as Record<string, unknown>;

    this.config = {
      scanPatterns: (pluginCfg.scanPatterns as string[] | undefined) ??
        this.config.scanPatterns ?? [
          "docs/**/*.md",
          "docs/**/*.mdx",
          "**/*.md",
          "**/*.mdx",
          "**/README*",
        ],
      docExtensions: (pluginCfg.docExtensions as string[] | undefined) ??
        this.config.docExtensions ?? [".md", ".mdx", ".pdf", ".txt", ".rst"],
      checkBrokenLinks:
        (pluginCfg.checkBrokenLinks as boolean | undefined) ??
        this.config.checkBrokenLinks ??
        false,
      validateStructure:
        (pluginCfg.validateStructure as boolean | undefined) ??
        this.config.validateStructure ??
        true,
    };
  }

  async destroy(): Promise<void> {
    // nothing to clean up
  }

  getCapabilityProviders(): CapabilityProvider[] {
    return [
      {
        capability: "scanner",
        scan: (rootPath: string, _prompt?: string) => this.scanDocs(rootPath),
      },
      {
        capability: "planner-hint",
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator",
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateDocs(params),
      },
      {
        capability: "artifact-detector",
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectDocArtifacts(params),
      },
    ];
  }

  private async scanDocs(rootPath: string): Promise<{
    type: "docs";
    docFiles: number;
    formats: string[];
    hasReadme: boolean;
    hasDocsDir: boolean;
    docDirs: string[];
    totalSizeBytes: number;
    structureSummary: string;
  }> {
    const patterns = this.config.scanPatterns!;
    const docFiles = new Set<string>();
    const formats = new Set<string>();

    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) {
        docFiles.add(f);
        const ext = path.extname(f).toLowerCase();
        if (ext) formats.add(ext);
      }
    }

    const hasReadme = await fileExists(path.join(rootPath, "README.md"));
    const hasDocsDir = await fileExists(path.join(rootPath, "docs"));
    const docDirs: string[] = [];
    const candidates = ["docs", "documentation", "wiki", "guide", "guides"];
    for (const d of candidates) {
      if (await fileExists(path.join(rootPath, d))) {
        docDirs.push(d);
      }
    }

    let totalSizeBytes = 0;
    for (const f of docFiles) {
      try {
        const stat = await import("node:fs/promises").then((m) => m.stat(f));
        totalSizeBytes += stat.size;
      } catch {
        // ignore
      }
    }

    return {
      type: "docs",
      docFiles: docFiles.size,
      formats: [...formats].sort(),
      hasReadme,
      hasDocsDir,
      docDirs,
      totalSizeBytes,
      structureSummary: hasDocsDir
        ? "Project has a docs directory with organized documentation"
        : "Documentation is scattered across the project",
    };
  }

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isDocsTask =
      lower.includes("document") ||
      lower.includes("docs") ||
      lower.includes("readme") ||
      lower.includes("readme") ||
      lower.includes("wiki") ||
      lower.includes("guide") ||
      lower.includes("tutorial") ||
      lower.includes("api reference") ||
      lower.includes("changelog") ||
      lower.includes("migration guide");

    if (!isDocsTask) return hints;

    hints.push("This is a documentation-related task. Scan docs directory for existing files.");
    hints.push("Check README and docs/ directory for structure understanding.");
    hints.push("Validate documentation for completeness, consistency, and broken links.");

    return hints;
  }

  private async validateDocs(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const docsDir = path.join(this.projectRoot, "docs");
    const hasDocs = await fileExists(docsDir);

    if (!hasDocs) {
      const readmePath = path.join(this.projectRoot, "README.md");
      if (!(await fileExists(readmePath))) {
        return { valid: false, message: "No documentation files found (no docs/ or README.md)" };
      }
      return { valid: true, message: "README.md found" };
    }

    const entries = await readDir(docsDir);
    const docEntries = entries.filter(
      (e) => e.endsWith(".md") || e.endsWith(".mdx") || e.endsWith(".txt") || e.endsWith(".rst"),
    );

    if (docEntries.length === 0) {
      return {
        valid: false,
        message: "docs/ directory exists but contains no documentation files",
      };
    }

    return {
      valid: true,
      message: `Found ${docEntries.length} documentation files in docs/`,
    };
  }

  private async detectDocArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const readmePath = path.join(this.projectRoot, "README.md");
    if (await fileExists(readmePath)) {
      artifacts.push({
        type: "documentation",
        path: "README.md",
        summary: "Project README documentation",
      });
    }

    const docsDir = path.join(this.projectRoot, "docs");
    if (await fileExists(docsDir)) {
      artifacts.push({
        type: "documentation",
        path: "docs/",
        summary: "Documentation directory",
      });
    }

    const patterns = this.config.scanPatterns ?? ["docs/**/*.md", "**/*.md"];
    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: this.projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files.slice(0, 20)) {
        if (f === "README.md" || f.startsWith("docs/")) {
          artifacts.push({
            type: "documentation",
            path: f,
            summary: `Documentation file: ${path.basename(f)}`,
          });
        }
      }
    }

    return artifacts;
  }
}
