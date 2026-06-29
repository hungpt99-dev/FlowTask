import path from "node:path";
import { Plugin, type CapabilityProvider } from "../core/plugin-manager.js";
import type { PluginMeta, PluginContext } from "../core/plugin-manager.js";
import { fileExists } from "../utils/fs.js";
import { expandGlob } from "../utils/glob.js";

export const RELEASE_PLUGIN_ID = "release-plugin";
export const RELEASE_PLUGIN_VERSION = "1.0.0";

export interface ReleasePluginConfig {
  scanPatterns?: string[];
  checkDeployment?: boolean;
  validateReadiness?: boolean;
}

export class ReleasePlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: RELEASE_PLUGIN_ID,
    name: "Release Plugin",
    version: RELEASE_PLUGIN_VERSION,
    description:
      "Release workflow plugin for checklists, deployment readiness, and release validation",
    capabilities: ["scanner", "planner-hint", "validator", "artifact-detector"],
  };

  private config: ReleasePluginConfig = {};
  private projectRoot = "";

  constructor(config?: ReleasePluginConfig) {
    super();
    this.config = config ?? {};
  }

  async init(context: PluginContext): Promise<void> {
    this.projectRoot = context.rootPath;
    const pluginCfg = (context.pluginConfig?.release ?? {}) as Record<string, unknown>;

    this.config = {
      scanPatterns: (pluginCfg.scanPatterns as string[] | undefined) ??
        this.config.scanPatterns ?? [
          "CHANGELOG*",
          "RELEASE*",
          "releases/**/*",
          "deploy/**/*",
          ".github/**/*",
          "Dockerfile*",
          "docker-compose*",
          "k8s/**/*",
          "helm/**/*",
          "terraform/**/*",
          "scripts/deploy*",
        ],
      checkDeployment:
        (pluginCfg.checkDeployment as boolean | undefined) ?? this.config.checkDeployment ?? true,
      validateReadiness:
        (pluginCfg.validateReadiness as boolean | undefined) ??
        this.config.validateReadiness ??
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
        scan: (rootPath: string, _prompt?: string) => this.scanReleaseContext(rootPath),
      },
      {
        capability: "planner-hint",
        getHints: (prompt: string) => this.generateHints(prompt),
      },
      {
        capability: "validator",
        validate: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.validateRelease(params),
      },
      {
        capability: "artifact-detector",
        detectArtifacts: (params: { runId: string; taskId?: string; stepId?: string }) =>
          this.detectReleaseArtifacts(params),
      },
    ];
  }

  private async scanReleaseContext(rootPath: string): Promise<{
    type: "release";
    hasChangelog: boolean;
    hasDockerfile: boolean;
    hasDeployScripts: boolean;
    hasCI: boolean;
    releaseDir: boolean;
    deploymentConfigs: string[];
    artifactsFound: number;
  }> {
    const hasChangelog = await fileExists(path.join(rootPath, "CHANGELOG.md"));
    const hasDockerfile = await fileExists(path.join(rootPath, "Dockerfile"));
    const hasDeployDir = await fileExists(path.join(rootPath, "deploy"));
    const hasCI = await fileExists(path.join(rootPath, ".github"));
    const hasReleaseDir = await fileExists(path.join(rootPath, "releases"));

    const deploymentConfigs: string[] = [];
    if (hasDockerfile) deploymentConfigs.push("Dockerfile");
    if (await fileExists(path.join(rootPath, "docker-compose.yml"))) {
      deploymentConfigs.push("docker-compose.yml");
    }
    if (hasDeployDir) deploymentConfigs.push("deploy/");
    if (await fileExists(path.join(rootPath, "k8s"))) deploymentConfigs.push("k8s/");
    if (await fileExists(path.join(rootPath, "helm"))) deploymentConfigs.push("helm/");
    if (await fileExists(path.join(rootPath, "terraform"))) deploymentConfigs.push("terraform/");

    let artifactsFound = 0;
    for (const pattern of this.config.scanPatterns!) {
      const files = await expandGlob(pattern, {
        cwd: rootPath,
        absolute: false,
        onlyFiles: true,
      });
      artifactsFound += files.length;
    }

    return {
      type: "release",
      hasChangelog,
      hasDockerfile,
      hasDeployScripts: hasDeployDir,
      hasCI,
      releaseDir: hasReleaseDir,
      deploymentConfigs,
      artifactsFound,
    };
  }

  private async generateHints(prompt: string): Promise<string[]> {
    const hints: string[] = [];
    const lower = prompt.toLowerCase();

    const isReleaseTask =
      lower.includes("release") ||
      lower.includes("deploy") ||
      lower.includes("deployment") ||
      lower.includes("version") ||
      lower.includes("changelog") ||
      lower.includes("rollback") ||
      lower.includes("cut") ||
      lower.includes("tag") ||
      lower.includes("publish") ||
      lower.includes("ship") ||
      lower.includes("ci") ||
      lower.includes("cd") ||
      lower.includes("docker") ||
      lower.includes("kubernetes") ||
      lower.includes("production");

    if (!isReleaseTask) return hints;

    hints.push("This is a release-related task. Check for changelog and deployment configs.");
    hints.push("Validate release readiness: tests pass, docs updated, changelog current.");
    hints.push("Ensure rollback plan is in place before deploying.");

    return hints;
  }

  private async validateRelease(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    const hasChangelog = await fileExists(path.join(this.projectRoot, "CHANGELOG.md"));
    if (!hasChangelog) {
      warnings.push("No CHANGELOG.md found");
    }

    const hasVersionFile =
      (await fileExists(path.join(this.projectRoot, "VERSION"))) ||
      (await fileExists(path.join(this.projectRoot, "version.txt")));
    if (!hasVersionFile && !hasChangelog) {
      warnings.push("No version tracking file found (VERSION or CHANGELOG.md)");
    }

    const packagePath = path.join(this.projectRoot, "package.json");
    if (await fileExists(packagePath)) {
      try {
        const { readTextFile } = await import("../utils/fs.js");
        const content = await readTextFile(packagePath);
        const pkg = JSON.parse(content) as { version?: string };
        if (!pkg.version) {
          issues.push("package.json missing version field");
        }
      } catch {
        issues.push("Could not parse package.json");
      }
    }

    if (issues.length > 0) {
      return {
        valid: false,
        message: `Release validation failed: ${issues.join("; ")}`,
      };
    }

    if (warnings.length > 0) {
      return {
        valid: true,
        message: `Release is configured. Warnings: ${warnings.join("; ")}`,
      };
    }

    return { valid: true, message: "Release configuration looks good" };
  }

  private async detectReleaseArtifacts(_params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]> {
    const artifacts: { type: string; path: string; summary: string }[] = [];

    const changelogPath = path.join(this.projectRoot, "CHANGELOG.md");
    if (await fileExists(changelogPath)) {
      artifacts.push({
        type: "release-changelog",
        path: "CHANGELOG.md",
        summary: "Release changelog tracking version history",
      });
    }

    const dockerPath = path.join(this.projectRoot, "Dockerfile");
    if (await fileExists(dockerPath)) {
      artifacts.push({
        type: "release-dockerfile",
        path: "Dockerfile",
        summary: "Docker build configuration",
      });
    }

    const patterns = this.config.scanPatterns ?? [
      "releases/**/*",
      "deploy/**/*",
      "scripts/deploy*",
    ];

    for (const pattern of patterns) {
      const files = await expandGlob(pattern, {
        cwd: this.projectRoot,
        absolute: false,
        onlyFiles: true,
      });
      for (const f of files.slice(0, 20)) {
        const type =
          f.startsWith("deploy") || f.includes("deploy")
            ? "release-deploy-config"
            : "release-artifact";
        artifacts.push({
          type,
          path: f,
          summary: `Release artifact: ${path.basename(f)}`,
        });
      }
    }

    return artifacts;
  }
}
