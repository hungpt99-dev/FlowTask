import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { fileExists, readDir } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

export const DATA_PLUGIN_ID = "data-plugin";
export const DATA_PLUGIN_VERSION = "1.0.0";

export interface DataPluginConfig {
  scanPatterns?: string[];
  supportedFormats?: string[];
  maxPreviewRows?: number;
}

export class DataPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: DATA_PLUGIN_ID,
    name: "Data Plugin",
    version: DATA_PLUGIN_VERSION,
    description: "Data workflow plugin for scanning CSV, JSON, spreadsheets and validating data",
    capabilities: ["scanner", "planner-hint", "validator", "artifact-detector"],
  };

  private config: DataPluginConfig = {};
  private projectRoot = "";

  constructor(config?: DataPluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;
    const pluginCfg = (context.pluginConfig?.data ?? {}) as Record<string, unknown>;

    this.config = {
      scanPatterns: (pluginCfg.scanPatterns as string[] | undefined) ??
        this.config.scanPatterns ?? [
          "data/**/*",
          "**/*.csv",
          "**/*.json",
          "**/*.yaml",
          "**/*.yml",
          "**/*.xml",
          "**/*.xlsx",
          "**/*.xls",
        ],
      supportedFormats: (pluginCfg.supportedFormats as string[] | undefined) ??
        this.config.supportedFormats ?? [".csv", ".json", ".yaml", ".yml", ".xml"],
      maxPreviewRows:
        (pluginCfg.maxPreviewRows as number | undefined) ?? this.config.maxPreviewRows ?? 10,
    };
  }

  async destroy(): Promise<void> {
    // nothing to clean up
  }

  getCapabilityProviders(): CapabilityProvider[] {
    return [
      {
        capability: "scanner",
        scan: (rootPath: string, _prompt?: string) => this.scanDataFiles(rootPath),
      },
      {
        capability: "planner-hint",
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator",
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateData(params),
      },
      {
        capability: "artifact-detector",
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectDataArtifacts(params),
      },
    ];
  }

  private async scanDataFiles(rootPath: string): Promise<{
    type: "data";
    totalFiles: number;
    formats: Record<string, number>;
    dataDirs: string[];
    hasDataDir: boolean;
    schemaDetected: boolean;
    sampleFiles: string[];
  }> {
    const dataFiles = new Set<string>();
    const formats: Record<string, number> = {};

    for (const pattern of this.config.scanPatterns!) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) {
        dataFiles.add(f);
        const ext = path.extname(f).toLowerCase();
        formats[ext] = (formats[ext] ?? 0) + 1;
      }
    }

    const dataDirs: string[] = [];
    const candidates = ["data", "datasets", "fixtures", "samples"];
    for (const d of candidates) {
      if (await fileExists(path.join(rootPath, d))) {
        dataDirs.push(d);
      }
    }

    const sampleFiles: string[] = [];
    for (const f of dataFiles) {
      if (sampleFiles.length >= 5) break;
      const relPath = path.relative(rootPath, f);
      sampleFiles.push(relPath);
    }

    return {
      type: "data",
      totalFiles: dataFiles.size,
      formats,
      dataDirs,
      hasDataDir: dataDirs.length > 0,
      schemaDetected: dataFiles.size > 0,
      sampleFiles,
    };
  }

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isDataTask =
      lower.includes("data") ||
      lower.includes("csv") ||
      lower.includes("json") ||
      lower.includes("transform") ||
      lower.includes("parse") ||
      lower.includes("import") ||
      lower.includes("export") ||
      lower.includes("migration") ||
      lower.includes("pipeline") ||
      lower.includes("etl") ||
      lower.includes("analytics") ||
      lower.includes("schema") ||
      lower.includes("spreadsheet") ||
      lower.includes("dataset");

    if (!isDataTask) return hints;

    hints.push("This is a data-related task. Scan for data files in the project.");
    hints.push("Detect file formats and infer schemas where possible.");
    hints.push("Validate data integrity and transformation correctness.");

    return hints;
  }

  private async validateData(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const dataDir = path.join(this.projectRoot, "data");
    if (!(await fileExists(dataDir))) {
      return { valid: true, message: "No data directory to validate" };
    }

    const entries = await readDir(dataDir);
    const dataFiles = entries.filter(
      (e) =>
        e.endsWith(".csv") ||
        e.endsWith(".json") ||
        e.endsWith(".yaml") ||
        e.endsWith(".yml") ||
        e.endsWith(".xml"),
    );

    if (dataFiles.length === 0) {
      return {
        valid: true,
        message: "data/ directory exists but contains no recognized data files",
      };
    }

    return {
      valid: true,
      message: `Found ${dataFiles.length} data files in data/`,
    };
  }

  private async detectDataArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const patterns = this.config.scanPatterns ?? [
      "data/**/*",
      "**/*.csv",
      "**/*.json",
      "**/*.yaml",
      "**/*.yml",
      "**/*.xml",
    ];

    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: this.projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files.slice(0, 20)) {
        const ext = path.extname(f).toLowerCase();
        const typeMap: Record<string, string> = {
          ".csv": "data-csv",
          ".json": "data-json",
          ".yaml": "data-yaml",
          ".yml": "data-yaml",
          ".xml": "data-xml",
          ".xlsx": "data-spreadsheet",
          ".xls": "data-spreadsheet",
        };
        artifacts.push({
          type: typeMap[ext] ?? "data-file",
          path: f,
          summary: `Data file: ${path.basename(f)}`,
        });
      }
    }

    return artifacts;
  }
}
