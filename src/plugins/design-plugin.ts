import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { fileExists, readDir } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

export const DESIGN_PLUGIN_ID = "design-plugin";
export const DESIGN_PLUGIN_VERSION = "1.0.0";

export interface DesignPluginConfig {
  scanPatterns?: string[];
  imageExtensions?: string[];
  designFileExtensions?: string[];
}

export class DesignPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: DESIGN_PLUGIN_ID,
    name: "Design Plugin",
    version: DESIGN_PLUGIN_VERSION,
    description:
      "Design workflow plugin for scanning design files, tracking screenshots, and validating output",
    capabilities: ["scanner", "planner-hint", "validator", "artifact-detector"],
  };

  private config: DesignPluginConfig = {};
  private projectRoot = "";

  constructor(config?: DesignPluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;
    const pluginCfg = (context.pluginConfig?.design ?? {}) as Record<string, unknown>;

    this.config = {
      scanPatterns: (pluginCfg.scanPatterns as string[] | undefined) ??
        this.config.scanPatterns ?? [
          "design/**/*",
          "assets/**/*",
          "screenshots/**/*",
          "mockups/**/*",
          "figma/**/*",
          "sketch/**/*",
        ],
      imageExtensions: (pluginCfg.imageExtensions as string[] | undefined) ??
        this.config.imageExtensions ?? [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"],
      designFileExtensions: (pluginCfg.designFileExtensions as string[] | undefined) ??
        this.config.designFileExtensions ?? [".fig", ".sketch", ".xd", ".ai", ".psd", ".pdf"],
    };
  }

  async destroy(): Promise<void> {
    // nothing to clean up
  }

  getCapabilityProviders(): CapabilityProvider[] {
    return [
      {
        capability: "scanner",
        scan: (rootPath: string, _prompt?: string) => this.scanDesignAssets(rootPath),
      },
      {
        capability: "planner-hint",
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator",
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateDesign(params),
      },
      {
        capability: "artifact-detector",
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectDesignArtifacts(params),
      },
    ];
  }

  private async scanDesignAssets(rootPath: string): Promise<{
    type: "design";
    designDirs: string[];
    imageCount: number;
    designFileCount: number;
    totalAssets: number;
    formats: string[];
  }> {
    const designDirs: string[] = [];
    const candidates = ["design", "assets", "screenshots", "mockups", "figma", "sketch"];
    for (const d of candidates) {
      if (await fileExists(path.join(rootPath, d))) {
        designDirs.push(d);
      }
    }

    const allExts = [...this.config.imageExtensions!, ...this.config.designFileExtensions!];

    const imageFiles = new Set<string>();
    const designFiles = new Set<string>();
    const formats = new Set<string>();

    for (const pattern of this.config.scanPatterns!) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (this.config.imageExtensions!.includes(ext)) {
          imageFiles.add(f);
        }
        if (this.config.designFileExtensions!.includes(ext)) {
          designFiles.add(f);
        }
        if (allExts.includes(ext)) {
          formats.add(ext);
        }
      }
    }

    return {
      type: "design",
      designDirs,
      imageCount: imageFiles.size,
      designFileCount: designFiles.size,
      totalAssets: imageFiles.size + designFiles.size,
      formats: [...formats].sort(),
    };
  }

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isDesignTask =
      lower.includes("design") ||
      lower.includes("ui") ||
      lower.includes("ux") ||
      lower.includes("layout") ||
      lower.includes("mockup") ||
      lower.includes("wireframe") ||
      lower.includes("prototype") ||
      lower.includes("figma") ||
      lower.includes("sketch") ||
      lower.includes("screen") ||
      lower.includes("visual") ||
      lower.includes("brand") ||
      lower.includes("color") ||
      lower.includes("typography") ||
      lower.includes("icon") ||
      lower.includes("asset");

    if (!isDesignTask) return hints;

    hints.push("This is a design-related task. Scan for design files and image assets.");
    hints.push("Track mockups, screenshots, and design specifications.");
    hints.push("Validate that visual output matches design requirements.");

    return hints;
  }

  private async validateDesign(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const designDir = path.join(this.projectRoot, "design");
    if (!(await fileExists(designDir))) {
      return { valid: true, message: "No design directory to validate" };
    }

    const entries = await readDir(designDir);
    const imageEntries = entries.filter((e) => {
      const ext = path.extname(e).toLowerCase();
      return [
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".webp",
        ".fig",
        ".sketch",
        ".psd",
        ".ai",
      ].includes(ext);
    });

    if (imageEntries.length === 0) {
      return {
        valid: true,
        message: "design/ directory exists but contains no recognized design files",
      };
    }

    return {
      valid: true,
      message: `Found ${imageEntries.length} design assets in design/`,
    };
  }

  private async detectDesignArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const patterns = this.config.scanPatterns ?? ["design/**/*", "assets/**/*", "screenshots/**/*"];

    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: this.projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files.slice(0, 20)) {
        const ext = path.extname(f).toLowerCase();
        const isImage = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"].includes(ext);
        artifacts.push({
          type: isImage ? "design-image" : "design-file",
          path: f,
          summary: `Design asset: ${path.basename(f)}`,
        });
      }
    }

    return artifacts;
  }
}
