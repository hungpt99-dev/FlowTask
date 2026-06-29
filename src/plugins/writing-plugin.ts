import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { fileExists, readDir } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

export const WRITING_PLUGIN_ID = "writing-plugin";
export const WRITING_PLUGIN_VERSION = "1.0.0";

export interface WritingPluginConfig {
  scanPatterns?: string[];
  checkTone?: boolean;
  checkGrammar?: boolean;
  checkClarity?: boolean;
}

export class WritingPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: WRITING_PLUGIN_ID,
    name: "Writing Plugin",
    version: WRITING_PLUGIN_VERSION,
    description:
      "Writing workflow plugin for content creation, tone validation, and revision tracking",
    capabilities: ["scanner", "planner-hint", "validator", "artifact-detector"],
  };

  private config: WritingPluginConfig = {};
  private projectRoot = "";

  constructor(config?: WritingPluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;
    const pluginCfg = (context.pluginConfig?.writing ?? {}) as Record<string, unknown>;

    this.config = {
      scanPatterns: (pluginCfg.scanPatterns as string[] | undefined) ??
        this.config.scanPatterns ?? [
          "content/**/*",
          "blog/**/*.md",
          "posts/**/*.md",
          "articles/**/*",
          "drafts/**/*",
          "**/*.md",
          "**/*.txt",
        ],
      checkTone: (pluginCfg.checkTone as boolean | undefined) ?? this.config.checkTone ?? false,
      checkGrammar:
        (pluginCfg.checkGrammar as boolean | undefined) ?? this.config.checkGrammar ?? false,
      checkClarity:
        (pluginCfg.checkClarity as boolean | undefined) ?? this.config.checkClarity ?? false,
    };
  }

  async destroy(): Promise<void> {
    // nothing to clean up
  }

  getCapabilityProviders(): CapabilityProvider[] {
    return [
      {
        capability: "scanner",
        scan: (rootPath: string, _prompt?: string) => this.scanWritingFiles(rootPath),
      },
      {
        capability: "planner-hint",
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator",
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateWriting(params),
      },
      {
        capability: "artifact-detector",
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectWritingArtifacts(params),
      },
    ];
  }

  private async scanWritingFiles(rootPath: string): Promise<{
    type: "writing";
    totalFiles: number;
    writingDirs: string[];
    formats: string[];
    totalWords: number;
    estimatedReadingTimeMinutes: number;
  }> {
    const writingDirs: string[] = [];
    const candidates = ["content", "blog", "posts", "articles", "drafts", "writing"];
    for (const d of candidates) {
      if (await fileExists(path.join(rootPath, d))) {
        writingDirs.push(d);
      }
    }

    const writingFiles = new Set<string>();
    const formats = new Set<string>();

    for (const pattern of this.config.scanPatterns!) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) {
        writingFiles.add(f);
        const ext = path.extname(f).toLowerCase();
        if (ext) formats.add(ext);
      }
    }

    return {
      type: "writing",
      totalFiles: writingFiles.size,
      writingDirs,
      formats: [...formats].sort(),
      totalWords: 0,
      estimatedReadingTimeMinutes: 0,
    };
  }

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isWritingTask =
      lower.includes("write") ||
      lower.includes("writing") ||
      lower.includes("content") ||
      lower.includes("blog") ||
      lower.includes("article") ||
      lower.includes("post") ||
      lower.includes("draft") ||
      lower.includes("copy") ||
      lower.includes("edit") ||
      lower.includes("rewrite") ||
      lower.includes("prose") ||
      lower.includes("story") ||
      lower.includes("newsletter") ||
      lower.includes("document");

    if (!isWritingTask) return hints;

    hints.push("This is a writing-related task. Scan for existing content files.");
    hints.push("Check tone, clarity, and structure consistency.");
    hints.push("Track revisions and maintain a clear revision history.");

    return hints;
  }

  private async validateWriting(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const contentDir = path.join(this.projectRoot, "content");
    if (!(await fileExists(contentDir))) {
      return { valid: true, message: "No content directory to validate" };
    }

    const entries = await readDir(contentDir);
    const contentFiles = entries.filter(
      (e) => e.endsWith(".md") || e.endsWith(".txt") || e.endsWith(".mdx"),
    );

    if (contentFiles.length === 0) {
      return {
        valid: true,
        message: "content/ directory exists but contains no recognized writing files",
      };
    }

    return {
      valid: true,
      message: `Found ${contentFiles.length} content files in content/`,
    };
  }

  private async detectWritingArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const patterns = this.config.scanPatterns ?? [
      "content/**/*.md",
      "blog/**/*.md",
      "posts/**/*.md",
    ];

    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: this.projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files.slice(0, 20)) {
        artifacts.push({
          type: "writing-draft",
          path: f,
          summary: `Writing file: ${path.basename(f)}`,
        });
      }
    }

    return artifacts;
  }
}
