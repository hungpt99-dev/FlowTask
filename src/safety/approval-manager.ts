import Enquirer from "enquirer";

export interface ApprovalRequest {
  taskId: string;
  command: string;
  reason: string;
}

export class ApprovalManager {
  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    const enquirer = new Enquirer();
    try {
      const response = await enquirer.prompt({
        type: "confirm",
        name: "approval",
        message: `Approve command?\n  Task: ${request.taskId}\n  Command: ${request.command}\n  Reason: ${request.reason}\n\n  Approve?`,
      });
      const result = (response as Record<string, boolean>).approval;
      return result ?? false;
    } catch {
      return false;
    }
  }
}
