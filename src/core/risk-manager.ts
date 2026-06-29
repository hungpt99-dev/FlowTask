import path from "node:path";
import fs from "node:fs/promises";

export type RiskScore = "none" | "low" | "medium" | "high" | "critical";

export interface RiskFinding {
  type: string;
  description: string;
  score: RiskScore;
  numericScore: number;
  details?: string;
}

export interface RiskAssessment {
  score: RiskScore;
  numericScore: number;
  findings: RiskFinding[];
  blocked: boolean;
  blockedReasons: string[];
  warnings: string[];
  infoMessages: string[];
}

export interface RiskConfig {
  enabled: boolean;
  riskThreshold: RiskScore;
  maxRetries: number;
  maxExecutionTimeMs: number;
  maxCostUsd: number;
  safeMode: boolean;
  readOnlyMode: boolean;
  maxFileChangeBytes: number;
  warnOnSudo: boolean;
  warnOnMigration: boolean;
  warnOnGitPush: boolean;
  warnOnExternalNetwork: boolean;
  warnOnDependencyInstall: boolean;
  blockEnvFileAccess: boolean;
  blockProductionConfigChanges: boolean;
  blockFileDeletion: boolean;
  detectCredentials: boolean;
  protectedFilePatterns: string[];
  dangerousCommandPatterns: string[];
}

export interface FileChangeInfo {
  path: string;
  size: number;
  operation: "create" | "modify" | "delete" | "rename";
}

export interface CommandInfo {
  command: string;
  args?: string[];
}

const RISK_SCORE_MAP: Record<RiskScore, number> = {
  none: 0,
  low: 15,
  medium: 40,
  high: 65,
  critical: 90,
};

const SCORE_THRESHOLDS: Array<{ max: number; level: RiskScore }> = [
  { max: 0, level: "none" },
  { max: 25, level: "low" },
  { max: 50, level: "medium" },
  { max: 75, level: "high" },
  { max: 100, level: "critical" },
];

const CREDENTIAL_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  { regex: /(?:sk-(?:proj|org|live|sess)-[a-zA-Z0-9]{20,})/g, description: "OpenAI API key" },
  { regex: /(?:ghp_[a-zA-Z0-9]{36,})/g, description: "GitHub personal access token" },
  { regex: /(?:ghs_[a-zA-Z0-9]{36,})/g, description: "GitHub server-to-server token" },
  { regex: /(?:ghr_[a-zA-Z0-9]{36,})/g, description: "GitHub refresh token" },
  { regex: /(?:xox[baprs]-[a-zA-Z0-9]{10,})/g, description: "Slack token" },
  { regex: /(?:AKIA[0-9A-Z]{16})/g, description: "AWS access key" },
  {
    regex: /-----BEGIN\s(?:RSA\s)?PRIVATE\sKEY-----/g,
    description: "Private key block",
  },
  { regex: /(?:Bearer\s+)[a-zA-Z0-9._\-\+\/=]{20,}/g, description: "Bearer token" },
  {
    regex: /(?:ghu_[a-zA-Z0-9]{36,})/g,
    description: "GitHub user access token",
  },
  { regex: /(?:ghb_[a-zA-Z0-9]{36,})/g, description: "GitHub App token" },
  {
    regex: /(?:sk-[a-zA-Z0-9]{20,})/g,
    description: "Generic secret key pattern",
  },
];

const DANGEROUS_COMMAND_PATTERNS: Array<{ regex: RegExp; score: RiskScore; description: string }> =
  [
    { regex: /\brm\s+-rf\s+/, score: "critical", description: "Force recursive delete" },
    {
      regex: /\brm\s+-rf\s+--no-preserve-root\s+\//,
      score: "critical",
      description: "Destructive delete",
    },
    { regex: /\brm\s+-rf\s+\$?HOME/i, score: "critical", description: "Home directory delete" },
    { regex: /\brm\s+-rf\s+\.git\b/, score: "critical", description: "Git directory delete" },
    { regex: /\brm\s+/, score: "medium", description: "File deletion" },
    { regex: /\brmdir\b/, score: "medium", description: "Directory removal" },
    { regex: /\bchmod\s+-R\s+777\b/, score: "critical", description: "Overly permissive chmod" },
    { regex: /\bchmod\s+777\b/, score: "high", description: "Overly permissive chmod" },
    { regex: /\bchown\s+-R\b/, score: "high", description: "Recursive ownership change" },
    {
      regex: /\bdangerously\b/,
      score: "critical",
      description: "Deliberately dangerous operation",
    },
    { regex: /\bforce.*delete\b/i, score: "high", description: "Forced deletion" },
    { regex: /\bdelete.*force\b/i, score: "high", description: "Forced deletion" },
    { regex: /\bformat\b/, score: "critical", description: "Format operation" },
    { regex: /\bmkfs\b/, score: "critical", description: "Filesystem creation" },
    { regex: /\bdd\s+if=/, score: "critical", description: "Raw disk write" },
    { regex: /\b>\/dev\/\w+/i, score: "medium", description: "Redirect to device" },
    {
      regex: /\bwget\s+.*\||\bcurl\s+.*\|/,
      score: "high",
      description: "Piped network download to shell",
    },
    {
      regex: /\bbash\s+<(?:curl|wget)/i,
      score: "critical",
      description: "Remote script execution",
    },
    {
      regex: /\bsh\s+-c\s+["'].*?(?:curl|wget)/i,
      score: "critical",
      description: "Remote script execution via shell",
    },
    { regex: /\beval\b/, score: "critical", description: "Eval command" },
    { regex: /\bexec\s+/, score: "high", description: "Exec replacement" },
    { regex: /\bsource\s+\/dev\/stdin/i, score: "critical", description: "Remote code execution" },
    { regex: /\b\.\s+<(?:curl|wget)/i, score: "critical", description: "Remote sourcing" },
  ];

const pnpmAddPattern = /\bpnpm\s+(add|install)\b/;
const npmAddPattern = /\bnpm\s+(add|install)\b/;
const yarnAddPattern = /\byarn\s+(add|install)\b/;
const bunAddPattern = /\bbun\s+(add|install)\b/;
const gitPushPattern = /\bgit\s+push\b/;
const migratePattern = /\bmigrate\b/;
const deployPattern = /\bdeploy\b/;
const networkPatterns = [
  /\bcurl\s+/,
  /\bwget\s+/,
  /\bping\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\brsync\b/,
  /\bnc\b/,
  /\bnmap\b/,
];

const PRODUCTION_CONFIG_PATTERNS = ["production", "prod.", "prod-", "prod/", ".prod"];

function scoreToLevel(numeric: number): RiskScore {
  for (const t of SCORE_THRESHOLDS) {
    if (numeric <= t.max) return t.level;
  }
  return "critical";
}

function levelToScore(level: RiskScore): number {
  return RISK_SCORE_MAP[level] ?? 0;
}

export class RiskManager {
  private config: RiskConfig;

  constructor(config?: Partial<RiskConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      riskThreshold: config?.riskThreshold ?? "medium",
      maxRetries: config?.maxRetries ?? 5,
      maxExecutionTimeMs: config?.maxExecutionTimeMs ?? 7200000,
      maxCostUsd: config?.maxCostUsd ?? 10,
      safeMode: config?.safeMode ?? false,
      readOnlyMode: config?.readOnlyMode ?? false,
      maxFileChangeBytes: config?.maxFileChangeBytes ?? 1048576,
      warnOnSudo: config?.warnOnSudo ?? true,
      warnOnMigration: config?.warnOnMigration ?? true,
      warnOnGitPush: config?.warnOnGitPush ?? true,
      warnOnExternalNetwork: config?.warnOnExternalNetwork ?? true,
      warnOnDependencyInstall: config?.warnOnDependencyInstall ?? true,
      blockEnvFileAccess: config?.blockEnvFileAccess ?? true,
      blockProductionConfigChanges: config?.blockProductionConfigChanges ?? true,
      blockFileDeletion: config?.blockFileDeletion ?? false,
      detectCredentials: config?.detectCredentials ?? true,
      protectedFilePatterns: config?.protectedFilePatterns ?? [
        ".env",
        ".env.local",
        ".env.production",
        ".env.test",
        "id_rsa",
        "id_ed25519",
        "*.pem",
        "*.key",
        "config/production*",
        "secrets*",
        "credentials*",
        "*.cert",
        "*.keystore",
        "service-account*",
        ".credentials*",
        "docker-compose*.yml",
      ],
      dangerousCommandPatterns: config?.dangerousCommandPatterns ?? [],
    };
  }

  setConfig(config: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): RiskConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isSafeMode(): boolean {
    return this.config.safeMode;
  }

  isReadOnlyMode(): boolean {
    return this.config.readOnlyMode;
  }

  assessCommand(command: string): RiskAssessment {
    const findings: RiskFinding[] = [];

    if (!this.config.enabled) {
      return this.buildAssessment(findings);
    }

    this.detectDangerousCommands(command, findings);
    this.detectSudoUsage(command, findings);
    this.detectDependencyInstall(command, findings);
    this.detectGitPush(command, findings);
    this.detectMigration(command, findings);
    this.detectExternalNetwork(command, findings);
    this.detectFileDeletion(command, findings);
    this.detectSecretsInCommand(command, findings);

    const result = this.buildAssessment(findings);

    if (this.config.safeMode && result.numericScore > levelToScore("medium")) {
      return {
        ...result,
        blocked: true,
        blockedReasons: [
          ...result.blockedReasons,
          "Blocked by safe mode (risk exceeds medium threshold)",
        ],
      };
    }

    return result;
  }

  assessFileChange(change: FileChangeInfo): RiskAssessment {
    const findings: RiskFinding[] = [];

    if (!this.config.enabled) {
      return this.buildAssessment(findings);
    }

    this.detectProtectedFileAccess(change, findings);
    this.detectProductionConfigChange(change, findings);
    this.detectLargeFileChange(change, findings);
    this.detectFileDeletionChange(change, findings);

    const result = this.buildAssessment(findings);

    if (
      this.config.readOnlyMode &&
      (change.operation === "create" ||
        change.operation === "modify" ||
        change.operation === "delete")
    ) {
      return {
        ...result,
        blocked: true,
        blockedReasons: [...result.blockedReasons, "Blocked by read-only mode"],
      };
    }

    if (this.config.safeMode && result.numericScore > levelToScore("high")) {
      return {
        ...result,
        blocked: true,
        blockedReasons: [...result.blockedReasons, "Blocked by safe mode"],
      };
    }

    return result;
  }

  async assessCommandWithFileCheck(command: string, filePaths?: string[]): Promise<RiskAssessment> {
    const findings: RiskFinding[] = [];

    if (!this.config.enabled) {
      return this.buildAssessment(findings);
    }

    this.detectDangerousCommands(command, findings);
    this.detectSudoUsage(command, findings);
    this.detectDependencyInstall(command, findings);
    this.detectGitPush(command, findings);
    this.detectMigration(command, findings);
    this.detectExternalNetwork(command, findings);
    this.detectFileDeletion(command, findings);
    this.detectSecretsInCommand(command, findings);

    if (filePaths && filePaths.length > 0) {
      const changes: FileChangeInfo[] = filePaths.map((fp) => ({
        path: fp,
        size: 0,
        operation: "modify" as const,
      }));
      for (const fc of changes) {
        this.detectProtectedFileAccess(fc, findings);
        this.detectProductionConfigChange(fc, findings);
      }

      if (this.config.detectCredentials && this.config.blockEnvFileAccess) {
        for (const fp of filePaths) {
          const isSensitive = await this.checkFileContainsSecrets(fp);
          if (isSensitive) {
            findings.push({
              type: "credential_detected",
              description: `File contains potential credential patterns: ${path.basename(fp)}`,
              score: "high",
              numericScore: levelToScore("high"),
              details: "File content matches credential patterns",
            });
          }
        }
      }
    }

    const result = this.buildAssessment(findings);

    if (this.config.safeMode && result.numericScore > levelToScore("medium")) {
      return {
        ...result,
        blocked: true,
        blockedReasons: [
          ...result.blockedReasons,
          "Blocked by safe mode (risk exceeds medium threshold)",
        ],
      };
    }

    return result;
  }

  async checkFileContainsSecrets(filePath: string): Promise<boolean> {
    if (!this.config.detectCredentials) return false;
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 1048576) return false;
      const content = await fs.readFile(filePath, "utf-8");
      for (const pattern of CREDENTIAL_PATTERNS) {
        if (pattern.regex.test(content)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  isThresholdExceeded(assessment: RiskAssessment): boolean {
    const thresholdScore = levelToScore(this.config.riskThreshold);
    return assessment.numericScore >= thresholdScore;
  }

  requiresApproval(assessment: RiskAssessment): boolean {
    if (this.config.readOnlyMode && assessment.blocked) return true;
    if (this.config.safeMode && assessment.blocked) return true;
    return this.isThresholdExceeded(assessment);
  }

  getEscalationMessage(assessment: RiskAssessment): string {
    const parts: string[] = [];
    if (assessment.blocked) {
      parts.push("Action blocked:");
      parts.push(...assessment.blockedReasons);
    } else if (this.isThresholdExceeded(assessment)) {
      parts.push(
        `Risk threshold (${this.config.riskThreshold}) exceeded: score ${assessment.numericScore}/100`,
      );
    }
    if (assessment.warnings.length > 0) {
      parts.push("Warnings:");
      parts.push(...assessment.warnings);
    }
    return parts.join("\n");
  }

  checkRetryLimit(currentRetries: number): { allowed: boolean; message?: string } {
    if (currentRetries > this.config.maxRetries) {
      return {
        allowed: false,
        message: `Max retry limit (${this.config.maxRetries}) reached`,
      };
    }
    return { allowed: true };
  }

  checkExecutionTimeLimit(elapsedMs: number): { allowed: boolean; message?: string } {
    if (elapsedMs >= this.config.maxExecutionTimeMs) {
      return {
        allowed: false,
        message: `Max execution time limit (${this.config.maxExecutionTimeMs}ms) exceeded`,
      };
    }
    return { allowed: true };
  }

  checkCostLimit(currentCostUsd: number): {
    allowed: boolean;
    requiresApproval: boolean;
    message?: string;
  } {
    const remaining = this.config.maxCostUsd - currentCostUsd;
    if (currentCostUsd >= this.config.maxCostUsd) {
      return {
        allowed: false,
        requiresApproval: false,
        message: `Max cost limit ($${this.config.maxCostUsd}) exceeded`,
      };
    }
    if (remaining <= this.config.maxCostUsd * 0.2) {
      return {
        allowed: true,
        requiresApproval: true,
        message: `Approaching cost limit: $${currentCostUsd.toFixed(2)} of $${this.config.maxCostUsd}`,
      };
    }
    return { allowed: true, requiresApproval: false };
  }

  formatRiskScore(score: number): string {
    if (score <= 0) return "none";
    if (score <= 25) return "low";
    if (score <= 50) return "medium";
    if (score <= 75) return "high";
    return "critical";
  }

  private buildAssessment(findings: RiskFinding[]): RiskAssessment {
    const totalScore = findings.reduce((sum, f) => sum + f.numericScore, 0);
    const cappedScore = Math.min(totalScore, 100);
    const level = scoreToLevel(cappedScore);
    const blocked: string[] = [];
    const warnings: string[] = [];
    const info: string[] = [];

    for (const f of findings) {
      if (f.numericScore >= levelToScore("high")) {
        blocked.push(f.description);
      } else if (f.numericScore >= levelToScore("medium")) {
        warnings.push(f.description);
      } else {
        info.push(f.description);
      }
    }

    return {
      score: level,
      numericScore: cappedScore,
      findings,
      blocked: blocked.length > 0,
      blockedReasons: blocked,
      warnings,
      infoMessages: info,
    };
  }

  private detectDangerousCommands(command: string, findings: RiskFinding[]): void {
    const normalized = command.toLowerCase().replace(/['"]+/g, "").replace(/\s+/g, " ").trim();
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.regex.test(normalized)) {
        findings.push({
          type: "dangerous_command",
          description: pattern.description,
          score: pattern.score,
          numericScore: levelToScore(pattern.score),
          details: `Matched pattern: ${pattern.regex}`,
        });
      }
    }
  }

  private detectSudoUsage(command: string, findings: RiskFinding[]): void {
    if (!this.config.warnOnSudo) return;
    if (/\bsudo\s+/.test(command)) {
      findings.push({
        type: "sudo_usage",
        description: "Command uses sudo (elevated privileges)",
        score: "high",
        numericScore: levelToScore("high"),
        details: "Sudo commands can modify system files",
      });
    }
  }

  private detectDependencyInstall(command: string, findings: RiskFinding[]): void {
    if (!this.config.warnOnDependencyInstall) return;
    const normalized = command.toLowerCase();
    if (
      pnpmAddPattern.test(normalized) ||
      npmAddPattern.test(normalized) ||
      yarnAddPattern.test(normalized) ||
      bunAddPattern.test(normalized)
    ) {
      findings.push({
        type: "dependency_install",
        description: "Installing dependencies may introduce untrusted code",
        score: "medium",
        numericScore: levelToScore("medium"),
        details: "Dependency install detected",
      });
    }
  }

  private detectGitPush(command: string, findings: RiskFinding[]): void {
    if (!this.config.warnOnGitPush) return;
    if (gitPushPattern.test(command)) {
      findings.push({
        type: "git_push",
        description: "Pushing to remote repository",
        score: "high",
        numericScore: levelToScore("high"),
        details: "Git push detected",
      });
    }
  }

  private detectMigration(command: string, findings: RiskFinding[]): void {
    if (!this.config.warnOnMigration) return;
    if (migratePattern.test(command) || deployPattern.test(command)) {
      findings.push({
        type: "migration_or_deploy",
        description: "Migration or deployment operation",
        score: "high",
        numericScore: levelToScore("high"),
        details: "Migration/deploy detected",
      });
    }
  }

  private detectExternalNetwork(command: string, findings: RiskFinding[]): void {
    if (!this.config.warnOnExternalNetwork) return;
    const normalized = command.toLowerCase();
    for (const pattern of networkPatterns) {
      if (pattern.test(normalized)) {
        findings.push({
          type: "external_network",
          description: "External network operation detected",
          score: "medium",
          numericScore: levelToScore("medium"),
          details: `Matched network pattern: ${pattern}`,
        });
        return;
      }
    }
  }

  private detectFileDeletion(command: string, findings: RiskFinding[]): void {
    if (!this.config.blockFileDeletion) return;
    const normalized = command.toLowerCase();
    if (
      /\brm\s+-rf\s+/.test(normalized) ||
      /\brm\s+-rf\s+--no-preserve-root/.test(normalized) ||
      /\brm\s+-rf\s+\$?HOME/.test(normalized) ||
      /\brm\s+-rf\s+\.git\b/.test(normalized)
    ) {
      findings.push({
        type: "file_deletion",
        description: "Destructive file deletion detected",
        score: "critical",
        numericScore: levelToScore("critical"),
        details: "Blocked by file deletion protection",
      });
    }
  }

  private detectSecretsInCommand(command: string, findings: RiskFinding[]): void {
    if (!this.config.detectCredentials) return;
    for (const pattern of CREDENTIAL_PATTERNS) {
      const matches = command.match(pattern.regex);
      if (matches && matches.length > 0) {
        findings.push({
          type: "credential_in_command",
          description: `Potential ${pattern.description} detected in command`,
          score: "high",
          numericScore: levelToScore("high"),
          details: "Command contains what looks like a credential token",
        });
        return;
      }
    }
  }

  private detectProtectedFileAccess(change: FileChangeInfo, findings: RiskFinding[]): void {
    if (!this.config.blockEnvFileAccess) return;
    const normalized = change.path.toLowerCase();

    for (const pattern of this.config.protectedFilePatterns) {
      const globPattern = pattern.toLowerCase();
      if (globPattern.includes("*")) {
        const basePattern = globPattern.replace(/\*/g, "");
        if (normalized.includes(basePattern)) {
          findings.push({
            type: "protected_file_access",
            description: `Access to protected file: ${path.basename(change.path)}`,
            score: "high",
            numericScore: levelToScore("high"),
            details: `Protected pattern: ${pattern}`,
          });
          return;
        }
      } else if (normalized.includes(globPattern)) {
        findings.push({
          type: "protected_file_access",
          description: `Access to protected file: ${path.basename(change.path)}`,
          score: "high",
          numericScore: levelToScore("high"),
          details: `Protected pattern: ${pattern}`,
        });
        return;
      }
    }
  }

  private detectProductionConfigChange(change: FileChangeInfo, findings: RiskFinding[]): void {
    if (!this.config.blockProductionConfigChanges) return;
    const normalized = change.path.toLowerCase();
    for (const pattern of PRODUCTION_CONFIG_PATTERNS) {
      if (normalized.includes(pattern)) {
        findings.push({
          type: "production_config_change",
          description: `Change to production configuration: ${path.basename(change.path)}`,
          score: "critical",
          numericScore: levelToScore("critical"),
          details: "Production config changes may affect live services",
        });
        return;
      }
    }
  }

  private detectLargeFileChange(change: FileChangeInfo, findings: RiskFinding[]): void {
    if (change.size > this.config.maxFileChangeBytes) {
      findings.push({
        type: "large_file_change",
        description: `Large file change detected (${(change.size / 1024 / 1024).toFixed(1)}MB)`,
        score: "medium",
        numericScore: levelToScore("medium"),
        details: `Max allowed: ${(this.config.maxFileChangeBytes / 1024 / 1024).toFixed(1)}MB`,
      });
    }
  }

  private detectFileDeletionChange(change: FileChangeInfo, findings: RiskFinding[]): void {
    if (change.operation === "delete") {
      findings.push({
        type: "file_deletion",
        description: `File deletion: ${path.basename(change.path)}`,
        score: "medium",
        numericScore: levelToScore("medium"),
        details: "File deletion detected in file changes",
      });
    }
  }
}
