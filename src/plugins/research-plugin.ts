import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { fileExists, readDir } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

export const RESEARCH_PLUGIN_ID = "research-plugin";
export const RESEARCH_PLUGIN_VERSION = "1.0.0";

export interface ResearchPluginConfig {
  scanPatterns?: string[];
  trackSources?: boolean;
  validateCitations?: boolean;
}

export class ResearchPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: RESEARCH_PLUGIN_ID,
    name: "Research Plugin",
    version: RESEARCH_PLUGIN_VERSION,
    description:
      "Research workflow plugin for scanning sources, tracking citations, and validating findings",
    capabilities: ["scanner", "planner-hint", "validator", "artifact-detector"],
  };

  private config: ResearchPluginConfig = {};
  private projectRoot = "";

  constructor(config?: ResearchPluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;
    const pluginCfg = (context.pluginConfig?.research ?? {}) as Record<string, unknown>;

    this.config = {
      scanPatterns: (pluginCfg.scanPatterns as string[] | undefined) ??
        this.config.scanPatterns ?? [
          "research/**/*.md",
          "research/**/*.{json,csv}",
          "notes/**/*.md",
          "references/**/*",
        ],
      trackSources:
        (pluginCfg.trackSources as boolean | undefined) ?? this.config.trackSources ?? true,
      validateCitations:
        (pluginCfg.validateCitations as boolean | undefined) ??
        this.config.validateCitations ??
        false,
    };
  }

  async destroy(): Promise<void> {
    // nothing to clean up
  }

  getCapabilityProviders(): CapabilityProvider[] {
    return [
      {
        capability: "scanner",
        scan: (rootPath: string, _prompt?: string) => this.scanResearchContext(rootPath),
      },
      {
        capability: "planner-hint",
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator",
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateResearch(params),
      },
      {
        capability: "artifact-detector",
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectResearchArtifacts(params),
      },
    ];
  }

  private async scanResearchContext(rootPath: string): Promise<{
    type: "research";
    researchDirs: string[];
    researchFiles: number;
    sourceNotes: number;
    references: number;
    hasSources: boolean;
  }> {
    const researchDirs: string[] = [];
    const candidates = ["research", "notes", "references", "sources", "findings"];
    for (const d of candidates) {
      if (await fileExists(path.join(rootPath, d))) {
        researchDirs.push(d);
      }
    }

    const researchFiles = new Set<string>();
    for (const pattern of this.config.scanPatterns!) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) researchFiles.add(f);
    }

    let sourceNotes = 0;
    let references = 0;
    for (const f of researchFiles) {
      const ext = path.extname(f).toLowerCase();
      if (ext === ".md" || ext === ".txt") sourceNotes++;
      else references++;
    }

    return {
      type: "research",
      researchDirs,
      researchFiles: researchFiles.size,
      sourceNotes,
      references,
      hasSources: researchFiles.size > 0,
    };
  }

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isResearchTask =
      lower.includes("research") ||
      lower.includes("investigate") ||
      lower.includes("study") ||
      lower.includes("analysis") ||
      lower.includes("find") ||
      lower.includes("explore") ||
      lower.includes("survey") ||
      lower.includes("literature") ||
      lower.includes("source") ||
      lower.includes("citation") ||
      lower.includes("reference") ||
      lower.includes("compare") ||
      lower.includes("evaluate");

    if (!isResearchTask) return hints;

    hints.push("This is a research-related task. Scan for existing notes and references.");
    hints.push("Track sources and citations for reproducibility.");
    hints.push("Summarize findings with clear evidence and source attribution.");

    return hints;
  }

  private async validateResearch(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const researchDir = path.join(this.projectRoot, "research");
    const notesDir = path.join(this.projectRoot, "notes");

    const hasResearch = await fileExists(researchDir);
    const hasNotes = await fileExists(notesDir);

    if (!hasResearch && !hasNotes) {
      return { valid: true, message: "No research context directory found" };
    }

    const scanDir = hasResearch ? researchDir : notesDir;
    const entries = await readDir(scanDir);
    const contentFiles = entries.filter(
      (e) => e.endsWith(".md") || e.endsWith(".txt") || e.endsWith(".json"),
    );

    if (contentFiles.length === 0) {
      return { valid: true, message: "Research directory exists but is empty" };
    }

    return {
      valid: true,
      message: `Found ${contentFiles.length} research files`,
    };
  }

  private async detectResearchArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const patterns = this.config.scanPatterns ?? ["research/**/*", "notes/**/*.md"];

    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: this.projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files.slice(0, 20)) {
        const type = f.endsWith(".md") || f.endsWith(".txt") ? "research-note" : "research-data";
        artifacts.push({
          type,
          path: f,
          summary: `Research file: ${path.basename(f)}`,
        });
      }
    }

    return artifacts;
  }
}
