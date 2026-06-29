import Enquirer from "enquirer";
import picocolors from "picocolors";
import type { RiskLevel } from "./approval-gate.js";

export interface ApprovalRequest {
  taskId: string;
  command: string;
  reason: string;
  stepId?: string;
  stepTitle?: string;
}

export interface GateApprovalRequest {
  taskId: string;
  actionType: string;
  riskLevel: RiskLevel;
  reason: string;
  details: string;
  stepId?: string;
  stepTitle?: string;
  estimatedCost?: number;
  failureCount?: number;
}

export interface RetryApprovalRequest {
  taskId: string;
  taskTitle: string;
  retryCount: number;
  maxRetries: number;
}

export type StepFailureAction = "retry" | "skip" | "stop";

export interface StepFailureRequest {
  taskId: string;
  taskTitle: string;
  error?: string;
}

export type ApprovalMode = "interactive" | "auto" | "skip";

export interface ApprovalConfig {
  enabled: boolean;
  autoApprove: boolean;
  mode: ApprovalMode;
}

export type GateDecision = "approved" | "rejected" | "override" | "skip";

export class ApprovalManager {
  private config: ApprovalConfig;

  constructor(config?: Partial<ApprovalConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      autoApprove: config?.autoApprove ?? false,
      mode: config?.mode ?? "interactive",
    };
  }

  shouldAutoApprove(): boolean {
    return this.config.mode === "auto" || this.config.autoApprove;
  }

  shouldSkip(): boolean {
    return this.config.mode === "skip" || !this.config.enabled;
  }

  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    if (this.shouldSkip()) {
      return true;
    }

    if (this.shouldAutoApprove()) {
      return true;
    }

    if (!process.stdin.isTTY) {
      return true;
    }

    const enquirer = new Enquirer();
    try {
      const label = request.stepTitle ?? request.taskId;
      const response = await enquirer.prompt({
        type: "confirm" as const,
        name: "approval",
        message: `Approve?\n  Step: ${picocolors.cyan(label)}\n  Command: ${picocolors.dim(request.command)}\n  Reason: ${request.reason}\n\n  Approve?`,
      });
      const result = (response as Record<string, boolean>).approval;
      return result ?? false;
    } catch {
      return false;
    }
  }

  async requestGateApproval(request: GateApprovalRequest): Promise<GateDecision> {
    if (this.shouldSkip()) {
      return "approved";
    }

    if (this.shouldAutoApprove()) {
      return "approved";
    }

    if (!process.stdin.isTTY) {
      return "approved";
    }

    const riskColor = this.getRiskColor(request.riskLevel);
    const enquirer = new Enquirer();
    try {
      const label = request.stepTitle ?? request.taskId;
      const response = await enquirer.prompt({
        type: "select" as const,
        name: "decision",
        message: `Approval Gate: ${picocolors.cyan(request.actionType)}\n  Step: ${picocolors.cyan(label)}\n  Risk: ${riskColor(request.riskLevel)}\n  ${request.details}\n\n  Decision?`,
        choices: ["approve", "reject", "override"],
      });
      const decision = (response as Record<string, string>).decision;
      if (decision === "approve") return "approved";
      if (decision === "override") return "override";
      return "rejected";
    } catch {
      return "rejected";
    }
  }

  async requestGateApprovalNonInteractive(request: GateApprovalRequest): Promise<GateDecision> {
    if (this.shouldSkip()) {
      return "approved";
    }

    if (this.shouldAutoApprove()) {
      return "approved";
    }

    return "approved";
  }

  async requestStepFailureResolution(request: StepFailureRequest): Promise<StepFailureAction> {
    if (!process.stdin.isTTY) {
      return "skip";
    }

    if (this.config.mode === "auto" || this.config.mode === "skip" || this.config.autoApprove) {
      return "skip";
    }

    const enquirer = new Enquirer();
    try {
      const response = await enquirer.prompt({
        type: "select" as const,
        name: "action",
        message: `Task "${request.taskTitle}" failed.\nWhat would you like to do?`,
        choices: ["retry", "skip", "stop"],
      });
      return (response as Record<string, StepFailureAction>).action ?? "stop";
    } catch {
      return "stop";
    }
  }

  async requestRetryApproval(request: RetryApprovalRequest): Promise<boolean> {
    if (this.shouldSkip()) {
      return true;
    }

    if (this.shouldAutoApprove()) {
      return true;
    }

    if (!process.stdin.isTTY) {
      return true;
    }

    if (request.retryCount <= request.maxRetries) {
      return true;
    }

    const enquirer = new Enquirer();
    try {
      const response = await enquirer.prompt({
        type: "confirm" as const,
        name: "approval",
        message: `Task "${request.taskTitle}" failed after ${request.maxRetries} retries.\nRetry again?`,
      });
      return (response as Record<string, boolean>).approval ?? false;
    } catch {
      return false;
    }
  }

  setConfig(config: Partial<ApprovalConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private getRiskColor(risk: RiskLevel): (text: string) => string {
    const map: Record<RiskLevel, (t: string) => string> = {
      safe: picocolors.green,
      low: picocolors.cyan,
      medium: picocolors.yellow,
      high: picocolors.red,
      critical: picocolors.red,
    };
    return map[risk] ?? picocolors.dim;
  }
}
