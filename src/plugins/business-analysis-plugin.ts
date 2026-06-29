import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { fileExists, readDir } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

export const BA_PLUGIN_ID = "business-analysis-plugin";
export const BA_PLUGIN_VERSION = "1.0.0";

export interface BusinessAnalysisPluginConfig {
  scanPatterns?: string[];
  checkGaps?: boolean;
  validateAcceptanceCriteria?: boolean;
}

export class BusinessAnalysisPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: BA_PLUGIN_ID,
    name: "Business Analysis Plugin",
    version: BA_PLUGIN_VERSION,
    description: "Business analysis workflow plugin for requirements, gap analysis, and BA reports",
    capabilities: ["scanner", "planner-hint", "validator", "artifact-detector"],
  };

  private config: BusinessAnalysisPluginConfig = {};
  private projectRoot = "";

  constructor(config?: BusinessAnalysisPluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;
    const pluginCfg = (context.pluginConfig?.businessAnalysis ?? {}) as Record<string, unknown>;

    this.config = {
      scanPatterns: (pluginCfg.scanPatterns as string[] | undefined) ??
        this.config.scanPatterns ?? [
          "requirements/**/*",
          "specs/**/*",
          "prd/**/*",
          "product/**/*",
          "business/**/*",
          "analysis/**/*",
          "**/*requirements*",
          "**/*spec*.md",
        ],
      checkGaps: (pluginCfg.checkGaps as boolean | undefined) ?? this.config.checkGaps ?? true,
      validateAcceptanceCriteria:
        (pluginCfg.validateAcceptanceCriteria as boolean | undefined) ??
        this.config.validateAcceptanceCriteria ??
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
        scan: (rootPath: string, _prompt?: string) => this.scanBAContext(rootPath),
      },
      {
        capability: "planner-hint",
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator",
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateBA(params),
      },
      {
        capability: "artifact-detector",
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectBAArtifacts(params),
      },
    ];
  }

  private async scanBAContext(rootPath: string): Promise<{
    type: "business-analysis";
    baDirs: string[];
    requirementsFiles: number;
    specFiles: number;
    totalFiles: number;
    hasPRD: boolean;
  }> {
    const baDirs: string[] = [];
    const candidates = ["requirements", "specs", "prd", "product", "business", "analysis"];
    for (const d of candidates) {
      if (await fileExists(path.join(rootPath, d))) {
        baDirs.push(d);
      }
    }

    const allFiles = new Set<string>();
    let requirementsFiles = 0;
    let specFiles = 0;

    for (const pattern of this.config.scanPatterns!) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) {
        allFiles.add(f);
        const lower = path.basename(f).toLowerCase();
        if (lower.includes("requirement")) requirementsFiles++;
        if (lower.includes("spec")) specFiles++;
      }
    }

    const hasPRD =
      (await fileExists(path.join(rootPath, "prd"))) ||
      (await fileExists(path.join(rootPath, "PRD.md"))) ||
      (await fileExists(path.join(rootPath, "PRD.pdf")));

    return {
      type: "business-analysis",
      baDirs,
      requirementsFiles,
      specFiles,
      totalFiles: allFiles.size,
      hasPRD,
    };
  }

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isBATask =
      lower.includes("requirement") ||
      lower.includes("business analysis") ||
      /\bba\b/.test(lower) ||
      lower.includes("spec") ||
      lower.includes("prd") ||
      lower.includes("product requirement") ||
      lower.includes("stakeholder") ||
      lower.includes("gap analysis") ||
      lower.includes("acceptance criteria") ||
      lower.includes("user story") ||
      lower.includes("epic") ||
      lower.includes("feature request") ||
      lower.includes("market analysis") ||
      lower.includes("feasibility");

    if (!isBATask) return hints;

    hints.push(
      "This is a business analysis task. Scan for requirements and specification documents.",
    );
    hints.push("Identify gaps between requirements and current implementation.");
    hints.push("Validate that acceptance criteria are clear and testable.");

    return hints;
  }

  private async validateBA(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const reqDir = path.join(this.projectRoot, "requirements");
    const specsDir = path.join(this.projectRoot, "specs");
    const prdDir = path.join(this.projectRoot, "prd");

    const hasReq = await fileExists(reqDir);
    const hasSpecs = await fileExists(specsDir);
    const hasPRD = await fileExists(prdDir);

    if (!hasReq && !hasSpecs && !hasPRD) {
      return {
        valid: true,
        message: "No requirements, specs, or PRD directories found",
      };
    }

    const dirs: string[] = [];
    if (hasReq) dirs.push(reqDir);
    if (hasSpecs) dirs.push(specsDir);
    if (hasPRD) dirs.push(prdDir);

    let fileCount = 0;
    for (const d of dirs) {
      const entries = await readDir(d);
      fileCount += entries.filter(
        (e) => e.endsWith(".md") || e.endsWith(".pdf") || e.endsWith(".txt"),
      ).length;
    }

    if (fileCount === 0) {
      return {
        valid: true,
        message: "BA directories exist but contain no recognized files",
      };
    }

    return {
      valid: true,
      message: `Found ${fileCount} BA files across ${dirs.length} directories`,
    };
  }

  private async detectBAArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const patterns = this.config.scanPatterns ?? ["requirements/**/*", "specs/**/*", "prd/**/*"];

    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: this.projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files.slice(0, 20)) {
        const lower = f.toLowerCase();
        let type = "ba-document";
        if (lower.includes("requirement")) type = "ba-requirements";
        else if (lower.includes("spec")) type = "ba-specification";
        else if (lower.includes("prd")) type = "ba-prd";

        artifacts.push({
          type,
          path: f,
          summary: `${type.replace("ba-", "BA ")}: ${path.basename(f)}`,
        });
      }
    }

    return artifacts;
  }
}
