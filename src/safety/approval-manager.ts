import Enquirer from "enquirer";
import picocolors from "picocolors";

export interface ApprovalRequest {
  taskId: string;
  command: string;
  reason: string;
  stepId?: string;
  stepTitle?: string;
}

export interface RetryApprovalRequest {
  taskId: string;
  taskTitle: string;
  retryCount: number;
  maxRetries: number;
}

export type ApprovalMode = "interactive" | "auto" | "skip";

export interface ApprovalConfig {
  enabled: boolean;
  autoApprove: boolean;
  mode: ApprovalMode;
}

export class ApprovalManager {
  private config: ApprovalConfig;

  constructor(config?: Partial<ApprovalConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      autoApprove: config?.autoApprove ?? false,
      mode: config?.mode ?? "interactive",
    };
  }

  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    if (!this.config.enabled || this.config.mode === "skip") {
      return true;
    }

    if (this.config.autoApprove || this.config.mode === "auto") {
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

  async requestRetryApproval(request: RetryApprovalRequest): Promise<boolean> {
    if (!this.config.enabled || this.config.mode === "skip") {
      return true;
    }

    if (this.config.autoApprove || this.config.mode === "auto") {
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
}
