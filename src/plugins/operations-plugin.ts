import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { fileExists, readDir } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

export const OPS_PLUGIN_ID = "operations-plugin";
export const OPS_PLUGIN_VERSION = "1.0.0";

export interface OperationsPluginConfig {
  scanPatterns?: string[];
  checkConfigs?: boolean;
  validateHealth?: boolean;
}

export class OperationsPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: OPS_PLUGIN_ID,
    name: "Operations Plugin",
    version: OPS_PLUGIN_VERSION,
    description:
      "Operations workflow plugin for operational tasks, monitoring, and runbook validation",
    capabilities: ["scanner", "planner-hint", "validator", "artifact-detector"],
  };

  private config: OperationsPluginConfig = {};
  private projectRoot = "";

  constructor(config?: OperationsPluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;
    const pluginCfg = (context.pluginConfig?.operations ?? {}) as Record<string, unknown>;

    this.config = {
      scanPatterns: (pluginCfg.scanPatterns as string[] | undefined) ??
        this.config.scanPatterns ?? [
          "ops/**/*",
          "scripts/**/*",
          "monitoring/**/*",
          "runbooks/**/*",
          "incidents/**/*",
          "alerts/**/*",
          "backup/**/*",
          "cron/**/*",
          "crontab*",
          "config/**/*",
          ".env*",
          "docker-compose*",
          "Makefile",
          "justfile*",
          "Taskfile*",
        ],
      checkConfigs:
        (pluginCfg.checkConfigs as boolean | undefined) ?? this.config.checkConfigs ?? true,
      validateHealth:
        (pluginCfg.validateHealth as boolean | undefined) ?? this.config.validateHealth ?? false,
    };
  }

  async destroy(): Promise<void> {
    // nothing to clean up
  }

  getCapabilityProviders(): CapabilityProvider[] {
    return [
      {
        capability: "scanner",
        scan: (rootPath: string, _prompt?: string) => this.scanOpsContext(rootPath),
      },
      {
        capability: "planner-hint",
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator",
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateOps(params),
      },
      {
        capability: "artifact-detector",
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectOpsArtifacts(params),
      },
    ];
  }

  private async scanOpsContext(rootPath: string): Promise<{
    type: "operations";
    opsDirs: string[];
    scriptCount: number;
    configFiles: number;
    hasDockerCompose: boolean;
    hasMakefile: boolean;
    hasRunbooks: boolean;
    hasMonitoring: boolean;
    totalOpsFiles: number;
  }> {
    const opsDirs: string[] = [];
    const candidates = [
      "ops",
      "scripts",
      "monitoring",
      "runbooks",
      "incidents",
      "backup",
      "config",
    ];
    for (const d of candidates) {
      if (await fileExists(path.join(rootPath, d))) {
        opsDirs.push(d);
      }
    }

    let scriptCount = 0;
    let configFiles = 0;
    let totalOpsFiles = 0;

    for (const pattern of this.config.scanPatterns!) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: false,
        onlyFiles: true,
      });
      totalOpsFiles += files.length;
      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (ext === ".sh" || ext === ".py" || ext === ".js" || !ext || ext === ".mjs") {
          if (f.startsWith("scripts") || f.startsWith("ops")) scriptCount++;
        }
        if (
          ext === ".yml" ||
          ext === ".yaml" ||
          ext === ".json" ||
          ext === ".conf" ||
          ext === ".ini" ||
          ext === ".env"
        ) {
          configFiles++;
        }
      }
    }

    const hasDockerCompose =
      (await fileExists(path.join(rootPath, "docker-compose.yml"))) ||
      (await fileExists(path.join(rootPath, "docker-compose.yaml")));
    const hasMakefile = await fileExists(path.join(rootPath, "Makefile"));
    const hasRunbooks = await fileExists(path.join(rootPath, "runbooks"));
    const hasMonitoring = await fileExists(path.join(rootPath, "monitoring"));

    return {
      type: "operations",
      opsDirs,
      scriptCount,
      configFiles,
      hasDockerCompose,
      hasMakefile,
      hasRunbooks,
      hasMonitoring,
      totalOpsFiles,
    };
  }

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isOpsTask =
      lower.includes("ops") ||
      lower.includes("operation") ||
      lower.includes("deploy") ||
      lower.includes("monitor") ||
      lower.includes("monitoring") ||
      lower.includes("alert") ||
      lower.includes("incident") ||
      lower.includes("runbook") ||
      lower.includes("backup") ||
      lower.includes("restore") ||
      lower.includes("cron") ||
      lower.includes("scheduled") ||
      lower.includes("maintenance") ||
      lower.includes("health") ||
      lower.includes("infrastructure") ||
      lower.includes("server") ||
      lower.includes("config") ||
      lower.includes("docker") ||
      lower.includes("kubernetes") ||
      lower.includes("scale") ||
      lower.includes("log") ||
      lower.includes("audit");

    if (!isOpsTask) return hints;

    hints.push("This is an operations task. Scan for operational configs and runbooks.");
    hints.push("Check environment configuration and deployment settings.");
    hints.push("Validate monitoring alerts and incident response procedures.");

    return hints;
  }

  private async validateOps(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const warnings: string[] = [];
    const issues: string[] = [];

    const configDir = path.join(this.projectRoot, "config");
    if (!(await fileExists(configDir))) {
      warnings.push("No config/ directory found");
    }

    const makefilePath = path.join(this.projectRoot, "Makefile");
    const hasMakefile = await fileExists(makefilePath);

    const dockerComposePath = path.join(this.projectRoot, "docker-compose.yml");
    const hasDockerCompose =
      (await fileExists(dockerComposePath)) ||
      (await fileExists(path.join(this.projectRoot, "docker-compose.yaml")));

    if (hasDockerCompose && !hasMakefile) {
      warnings.push("Docker Compose exists but no Makefile for orchestration");
    }

    const scriptsDir = path.join(this.projectRoot, "scripts");
    if (await fileExists(scriptsDir)) {
      const entries = await readDir(scriptsDir);
      const execScripts = entries.filter(
        (e) => e.endsWith(".sh") || e.endsWith(".py") || e.endsWith(".mjs"),
      );
      if (execScripts.length === 0) {
        warnings.push("scripts/ directory exists but no executable scripts found");
      }
    }

    if (issues.length > 0) {
      return {
        valid: false,
        message: `Operations validation failed: ${issues.join("; ")}`,
      };
    }

    if (warnings.length > 0) {
      return {
        valid: true,
        message: `Operations context identified. Warnings: ${warnings.join("; ")}`,
      };
    }

    return { valid: true, message: "Operations configuration looks good" };
  }

  private async detectOpsArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const makefilePath = path.join(this.projectRoot, "Makefile");
    if (await fileExists(makefilePath)) {
      artifacts.push({
        type: "ops-makefile",
        path: "Makefile",
        summary: "Build and operations Makefile",
      });
    }

    const dockerComposePath = path.join(this.projectRoot, "docker-compose.yml");
    if (await fileExists(dockerComposePath)) {
      artifacts.push({
        type: "ops-docker-compose",
        path: "docker-compose.yml",
        summary: "Docker Compose configuration",
      });
    }

    const patterns = this.config.scanPatterns ?? [
      "scripts/**/*.sh",
      "runbooks/**/*.md",
      "monitoring/**/*",
      "config/**/*",
    ];

    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: this.projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files.slice(0, 20)) {
        const ext = path.extname(f).toLowerCase();
        let type = "ops-file";
        if (f.endsWith(".sh")) type = "ops-script";
        else if (f.startsWith("runbooks")) type = "ops-runbook";
        else if (f.startsWith("monitoring") || f.startsWith("alerts")) type = "ops-monitoring";
        else if (f.startsWith("config") || ext === ".conf" || ext === ".ini") type = "ops-config";

        artifacts.push({
          type,
          path: f,
          summary: `Operations file: ${path.basename(f)}`,
        });
      }
    }

    return artifacts;
  }
}
