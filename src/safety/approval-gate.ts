export type ActionType =
  | "delete_file"
  | "install_dependency"
  | "git_push"
  | "git_commit"
  | "deploy"
  | "database_migration"
  | "read_sensitive_file"
  | "env_config_change"
  | "external_api_call"
  | "network_operation"
  | "high_cost_ai_usage"
  | "continue_after_repeated_failure"
  | "skip_failed_validation"
  | "override_validation_failure"
  | "plan_execution"
  | "file_write"
  | "command_execution"
  | "unknown";

export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";

export interface ApprovalGateConfig {
  requireFor: ActionType[];
  autoApproveFor: ActionType[];
  riskThreshold: RiskLevel;
  requirePlanApproval: boolean;
  requireStepApproval: boolean;
  maxCostThreshold: number;
  notifyOnGateBlock: boolean;
}

export interface ApprovalGateResult {
  requiresApproval: boolean;
  actionType: ActionType;
  riskLevel: RiskLevel;
  reason: string;
  autoApprove: boolean;
}

const DEFAULT_REQUIRE_FOR: ActionType[] = [
  "delete_file",
  "install_dependency",
  "git_push",
  "git_commit",
  "deploy",
  "database_migration",
  "read_sensitive_file",
  "env_config_change",
  "external_api_call",
  "network_operation",
  "high_cost_ai_usage",
  "continue_after_repeated_failure",
  "skip_failed_validation",
  "override_validation_failure",
  "plan_execution",
];

const DEFAULT_AUTO_APPROVE_FOR: ActionType[] = ["file_write", "command_execution"];

const ACTION_RISK_MAP: Record<ActionType, RiskLevel> = {
  delete_file: "high",
  install_dependency: "medium",
  git_push: "high",
  git_commit: "medium",
  deploy: "critical",
  database_migration: "critical",
  read_sensitive_file: "high",
  env_config_change: "high",
  external_api_call: "medium",
  network_operation: "medium",
  high_cost_ai_usage: "high",
  continue_after_repeated_failure: "medium",
  skip_failed_validation: "high",
  override_validation_failure: "critical",
  plan_execution: "medium",
  file_write: "safe",
  command_execution: "safe",
  unknown: "safe",
};

export class ApprovalGateChecker {
  private config: ApprovalGateConfig;

  constructor(config?: Partial<ApprovalGateConfig>) {
    this.config = {
      requireFor: config?.requireFor ?? [...DEFAULT_REQUIRE_FOR],
      autoApproveFor: config?.autoApproveFor ?? [...DEFAULT_AUTO_APPROVE_FOR],
      riskThreshold: config?.riskThreshold ?? "medium",
      requirePlanApproval: config?.requirePlanApproval ?? true,
      requireStepApproval: config?.requireStepApproval ?? true,
      maxCostThreshold: config?.maxCostThreshold ?? 0.5,
      notifyOnGateBlock: config?.notifyOnGateBlock ?? true,
    };
  }

  setConfig(config: Partial<ApprovalGateConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ApprovalGateConfig {
    return { ...this.config };
  }

  checkAction(
    action: ActionType,
    context?: {
      command?: string;
      filePath?: string;
      estimatedCost?: number;
      failureCount?: number;
    },
  ): ApprovalGateResult {
    const riskLevel = ACTION_RISK_MAP[action] ?? "safe";

    if (this.config.autoApproveFor.includes(action)) {
      return {
        requiresApproval: false,
        actionType: action,
        riskLevel,
        reason: `Auto-approved action: ${action}`,
        autoApprove: true,
      };
    }

    if (!this.config.requireFor.includes(action)) {
      return {
        requiresApproval: false,
        actionType: action,
        riskLevel,
        reason: `Action '${action}' is not in requireFor list`,
        autoApprove: false,
      };
    }

    if (action === "high_cost_ai_usage" && context?.estimatedCost !== undefined) {
      if (context.estimatedCost <= this.config.maxCostThreshold) {
        return {
          requiresApproval: false,
          actionType: action,
          riskLevel,
          reason: `Estimated cost $${context.estimatedCost} is within threshold $${this.config.maxCostThreshold}`,
          autoApprove: false,
        };
      }
    }

    if (action === "continue_after_repeated_failure" && context?.failureCount !== undefined) {
      if (context.failureCount <= 1) {
        return {
          requiresApproval: false,
          actionType: action,
          riskLevel,
          reason: `Failure count ${context.failureCount} is low, auto-continuing`,
          autoApprove: false,
        };
      }
    }

    return {
      requiresApproval: true,
      actionType: action,
      riskLevel,
      reason: this.buildReason(action, riskLevel, context),
      autoApprove: false,
    };
  }

  checkCommand(command: string): ApprovalGateResult {
    const actionType = this.detectActionFromCommand(command);
    return this.checkAction(actionType, { command });
  }

  detectActionFromCommand(command: string): ActionType {
    const normalized = command.toLowerCase().trim();

    if (/\brm\s+/.test(normalized) || /\brmdir\b/.test(normalized)) {
      return "delete_file";
    }
    if (/\b(pnpm|npm|yarn|bun)\s+(add|install)\b/.test(normalized)) {
      return "install_dependency";
    }
    if (/\bgit\s+push\b/.test(normalized)) {
      return "git_push";
    }
    if (/\bgit\s+commit\b/.test(normalized)) {
      return "git_commit";
    }
    if (/\bdeploy\b/.test(normalized)) {
      return "deploy";
    }
    if (/\bmigrate\b/.test(normalized)) {
      return "database_migration";
    }
    if (/\bcat\s+\.env\b/.test(normalized) || /\.(key|pem|secret)/.test(normalized)) {
      return "read_sensitive_file";
    }
    if (/\b(chmod|chown|export|set)\s+/.test(normalized) && /\.env/i.test(normalized)) {
      return "env_config_change";
    }
    if (/\b(curl|wget|fetch|http)\b/.test(normalized) && !/\bping\b/.test(normalized)) {
      return "external_api_call";
    }
    if (/\b(ping|ssh|scp|rsync|nc)\b/.test(normalized)) {
      return "network_operation";
    }
    if (
      /\bskip.*(validation|test|check)\b/.test(normalized) ||
      /\boverride.*(validation|test|check|fail)\b/.test(normalized)
    ) {
      return "override_validation_failure";
    }
    if (/\b(plan|run-plan)\b/.test(normalized) && /execut|apply/.test(normalized)) {
      return "plan_execution";
    }

    return "command_execution";
  }

  private buildReason(
    action: ActionType,
    riskLevel: RiskLevel,
    context?: {
      command?: string;
      filePath?: string;
      estimatedCost?: number;
      failureCount?: number;
    },
  ): string {
    const parts: string[] = [`Action '${action}' requires approval`];
    parts.push(`Risk level: ${riskLevel}`);

    if (context?.command) {
      parts.push(`Command: ${context.command}`);
    }
    if (context?.filePath) {
      parts.push(`File: ${context.filePath}`);
    }
    if (context?.estimatedCost !== undefined) {
      parts.push(`Estimated cost: $${context.estimatedCost}`);
    }
    if (context?.failureCount !== undefined && context.failureCount > 1) {
      parts.push(`Previous failures: ${context.failureCount}`);
    }

    return parts.join(" | ");
  }

  classifyStepType(stepTitle: string, stepCommand?: string): ActionType {
    const title = stepTitle.toLowerCase();
    const cmd = (stepCommand ?? "").toLowerCase();

    if (
      title.includes("delete") ||
      title.includes("remove") ||
      title.includes("clean") ||
      /\brm\s+/.test(cmd)
    ) {
      return "delete_file";
    }
    if (
      title.includes("install") ||
      title.includes("dependency") ||
      title.includes("add dep") ||
      /\b(pnpm|npm|yarn)\s+(add|install)\b/.test(cmd)
    ) {
      return "install_dependency";
    }
    if (title.includes("push") || title.includes("git push") || /\bgit\s+push\b/.test(cmd)) {
      return "git_push";
    }
    if (title.includes("commit") || title.includes("git commit") || /\bgit\s+commit\b/.test(cmd)) {
      return "git_commit";
    }
    if (
      title.includes("deploy") ||
      title.includes("release") ||
      title.includes("publish") ||
      /\bdeploy\b/.test(cmd)
    ) {
      return "deploy";
    }
    if (
      title.includes("migrate") ||
      title.includes("migration") ||
      title.includes("schema") ||
      /\bmigrate\b/.test(cmd)
    ) {
      return "database_migration";
    }
    if (
      title.includes("sensitive") ||
      title.includes("secret") ||
      title.includes("credential") ||
      title.includes(".env") ||
      /\bcat\s+\.env\b/.test(cmd)
    ) {
      return "read_sensitive_file";
    }
    if (
      title.includes("config") ||
      title.includes("environment") ||
      title.includes("env") ||
      (title.includes("change") && (title.includes("config") || title.includes("setting")))
    ) {
      return "env_config_change";
    }
    if (
      title.includes("api call") ||
      title.includes("external") ||
      title.includes("webhook") ||
      title.includes("fetch") ||
      /\b(curl|wget)\b/.test(cmd)
    ) {
      return "external_api_call";
    }
    if (
      title.includes("network") ||
      title.includes("ssh") ||
      title.includes("connect") ||
      /\b(ping|ssh|scp|rsync)\b/.test(cmd)
    ) {
      return "network_operation";
    }
    if (
      title.includes("skip validation") ||
      title.includes("override validation") ||
      title.includes("bypass validation") ||
      title.includes("ignore failure") ||
      /\b(skip|override|bypass)\b.*\b(validation|test|check|fail)\b/.test(title)
    ) {
      return "override_validation_failure";
    }
    if (
      title.includes("plan execution") ||
      title.includes("apply plan") ||
      title.includes("execute plan") ||
      (title.includes("plan") && title.includes("run"))
    ) {
      return "plan_execution";
    }
    if (
      title.includes("continue after failure") ||
      title.includes("retry after failure") ||
      title.includes("ignore error") ||
      /\bcontinue\b.*\bfail(ure)?\b/.test(title)
    ) {
      return "continue_after_repeated_failure";
    }
    if (
      title.includes("high cost") ||
      title.includes("expensive") ||
      title.includes("costly ai") ||
      /\bexpensive\b.*\b(ai|api|model)\b/.test(title)
    ) {
      return "high_cost_ai_usage";
    }

    return "command_execution";
  }
}
