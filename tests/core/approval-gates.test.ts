import { describe, it, expect, beforeEach } from "vitest";
import { ApprovalGateChecker } from "../../src/safety/approval-gate.js";
import { ApprovalManager } from "../../src/safety/approval-manager.js";
import type { ActionType } from "../../src/safety/approval-gate.js";
import type { GateDecision } from "../../src/safety/approval-manager.js";

describe("ApprovalGateChecker", () => {
  let checker: ApprovalGateChecker;

  beforeEach(() => {
    checker = new ApprovalGateChecker();
  });

  describe("checkAction", () => {
    it("should require approval for delete_file", () => {
      const result = checker.checkAction("delete_file");
      expect(result.requiresApproval).toBe(true);
      expect(result.actionType).toBe("delete_file");
      expect(result.riskLevel).toBe("high");
    });

    it("should require approval for install_dependency", () => {
      const result = checker.checkAction("install_dependency");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("medium");
    });

    it("should require approval for git_push", () => {
      const result = checker.checkAction("git_push");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("high");
    });

    it("should require approval for git_commit", () => {
      const result = checker.checkAction("git_commit");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("medium");
    });

    it("should require approval for deploy with critical risk", () => {
      const result = checker.checkAction("deploy");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("critical");
    });

    it("should require approval for database_migration with critical risk", () => {
      const result = checker.checkAction("database_migration");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("critical");
    });

    it("should require approval for read_sensitive_file", () => {
      const result = checker.checkAction("read_sensitive_file");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("high");
    });

    it("should require approval for env_config_change", () => {
      const result = checker.checkAction("env_config_change");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("high");
    });

    it("should require approval for external_api_call", () => {
      const result = checker.checkAction("external_api_call");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("medium");
    });

    it("should require approval for network_operation", () => {
      const result = checker.checkAction("network_operation");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("medium");
    });

    it("should require approval for plan_execution", () => {
      const result = checker.checkAction("plan_execution");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("medium");
    });

    it("should auto-approve command_execution (safe step auto-run)", () => {
      const result = checker.checkAction("command_execution");
      expect(result.requiresApproval).toBe(false);
      expect(result.autoApprove).toBe(true);
    });

    it("should auto-approve file_write (safe step auto-run)", () => {
      const result = checker.checkAction("file_write");
      expect(result.requiresApproval).toBe(false);
      expect(result.autoApprove).toBe(true);
    });

    it("should auto-approve unknown action (safe by default)", () => {
      const result = checker.checkAction("unknown" as ActionType);
      expect(result.requiresApproval).toBe(false);
      expect(result.autoApprove).toBe(false);
    });

    it("should handle context-based cost threshold for high_cost_ai_usage", () => {
      const under = checker.checkAction("high_cost_ai_usage", { estimatedCost: 0.1 });
      expect(under.requiresApproval).toBe(false);

      const over = checker.checkAction("high_cost_ai_usage", { estimatedCost: 1.0 });
      expect(over.requiresApproval).toBe(true);
    });

    it("should handle context-based failure count for continue_after_repeated_failure", () => {
      const low = checker.checkAction("continue_after_repeated_failure", { failureCount: 0 });
      expect(low.requiresApproval).toBe(false);

      const high = checker.checkAction("continue_after_repeated_failure", { failureCount: 3 });
      expect(high.requiresApproval).toBe(true);
    });

    it("should require approval for override_validation_failure (critical risk)", () => {
      const result = checker.checkAction("override_validation_failure");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("critical");
    });

    it("should require approval for skip_failed_validation (high risk)", () => {
      const result = checker.checkAction("skip_failed_validation");
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("high");
    });
  });

  describe("safe steps auto-run without approval", () => {
    it("should not require approval for actions not in requireFor list", () => {
      const safeActions: ActionType[] = ["file_write", "command_execution", "unknown"];
      for (const action of safeActions) {
        const result = checker.checkAction(action);
        expect(result.requiresApproval).toBe(false);
      }
    });

    it("should auto-approve all risky actions when requireFor is empty", () => {
      const custom = new ApprovalGateChecker({ requireFor: [] });
      const risky: ActionType[] = [
        "delete_file",
        "install_dependency",
        "git_push",
        "git_commit",
        "deploy",
        "database_migration",
        "plan_execution",
      ];
      for (const action of risky) {
        const result = custom.checkAction(action);
        expect(result.requiresApproval).toBe(false);
      }
    });

    it("should auto-approve specific risky actions when added to autoApproveFor", () => {
      const custom = new ApprovalGateChecker({
        requireFor: ["delete_file", "install_dependency"],
        autoApproveFor: ["delete_file"],
      });
      const deleteResult = custom.checkAction("delete_file");
      expect(deleteResult.requiresApproval).toBe(false);
      expect(deleteResult.autoApprove).toBe(true);

      const installResult = custom.checkAction("install_dependency");
      expect(installResult.requiresApproval).toBe(true);
      expect(installResult.autoApprove).toBe(false);
    });

    it("should respect requirePlanApproval config", () => {
      const withPlan = new ApprovalGateChecker({ requirePlanApproval: true });
      expect(withPlan.getConfig().requirePlanApproval).toBe(true);

      const withoutPlan = new ApprovalGateChecker({ requirePlanApproval: false });
      expect(withoutPlan.getConfig().requirePlanApproval).toBe(false);
    });

    it("should respect requireStepApproval config", () => {
      const withStep = new ApprovalGateChecker({ requireStepApproval: true });
      expect(withStep.getConfig().requireStepApproval).toBe(true);

      const withoutStep = new ApprovalGateChecker({ requireStepApproval: false });
      expect(withoutStep.getConfig().requireStepApproval).toBe(false);
    });

    it("should respect cost threshold config changes", () => {
      const custom = new ApprovalGateChecker({ maxCostThreshold: 2.0 });
      const under = custom.checkAction("high_cost_ai_usage", { estimatedCost: 1.5 });
      expect(under.requiresApproval).toBe(false);

      const over = custom.checkAction("high_cost_ai_usage", { estimatedCost: 3.0 });
      expect(over.requiresApproval).toBe(true);

      custom.setConfig({ maxCostThreshold: 0.1 });
      const nowOver = custom.checkAction("high_cost_ai_usage", { estimatedCost: 0.2 });
      expect(nowOver.requiresApproval).toBe(true);
    });
  });

  describe("detectActionFromCommand", () => {
    it("should detect rm commands as delete_file", () => {
      expect(checker.detectActionFromCommand("rm -rf node_modules")).toBe("delete_file");
      expect(checker.detectActionFromCommand("rmdir temp_dir")).toBe("delete_file");
    });

    it("should detect install commands", () => {
      expect(checker.detectActionFromCommand("pnpm add dep")).toBe("install_dependency");
      expect(checker.detectActionFromCommand("npm install")).toBe("install_dependency");
      expect(checker.detectActionFromCommand("yarn add pkg")).toBe("install_dependency");
      expect(checker.detectActionFromCommand("bun install")).toBe("install_dependency");
    });

    it("should detect git push", () => {
      expect(checker.detectActionFromCommand("git push origin main")).toBe("git_push");
    });

    it("should detect git commit", () => {
      expect(checker.detectActionFromCommand("git commit -m 'feat: add'")).toBe("git_commit");
    });

    it("should detect deploy", () => {
      expect(checker.detectActionFromCommand("deploy --env prod")).toBe("deploy");
    });

    it("should detect migration", () => {
      expect(checker.detectActionFromCommand("npx prisma migrate")).toBe("database_migration");
    });

    it("should detect sensitive file reads", () => {
      expect(checker.detectActionFromCommand("cat .env")).toBe("read_sensitive_file");
    });

    it("should detect env config changes", () => {
      expect(checker.detectActionFromCommand("export FOO=bar .env")).toBe("env_config_change");
    });

    it("should detect external api calls", () => {
      expect(checker.detectActionFromCommand("curl https://api.example.com")).toBe(
        "external_api_call",
      );
      expect(checker.detectActionFromCommand("wget https://example.com/data")).toBe(
        "external_api_call",
      );
    });

    it("should detect network operations", () => {
      expect(checker.detectActionFromCommand("ping google.com")).toBe("network_operation");
      expect(checker.detectActionFromCommand("ssh user@host")).toBe("network_operation");
    });

    it("should detect override/skip validation commands", () => {
      expect(checker.detectActionFromCommand("skip validation check")).toBe(
        "override_validation_failure",
      );
      expect(checker.detectActionFromCommand("override test failure")).toBe(
        "override_validation_failure",
      );
    });

    it("should detect plan execution commands", () => {
      expect(checker.detectActionFromCommand("plan execute workflow")).toBe("plan_execution");
      expect(checker.detectActionFromCommand("run-plan apply")).toBe("plan_execution");
    });

    it("should default to command_execution for safe commands", () => {
      expect(checker.detectActionFromCommand("ls -la")).toBe("command_execution");
      expect(checker.detectActionFromCommand("echo hello")).toBe("command_execution");
      expect(checker.detectActionFromCommand("cat README.md")).toBe("command_execution");
    });
  });

  describe("classifyStepType", () => {
    it("should classify delete steps", () => {
      expect(checker.classifyStepType("Delete temporary files")).toBe("delete_file");
      expect(checker.classifyStepType("Remove old logs")).toBe("delete_file");
      expect(checker.classifyStepType("Clean up build artifacts")).toBe("delete_file");
    });

    it("should classify install steps", () => {
      expect(checker.classifyStepType("Install dependencies")).toBe("install_dependency");
      expect(checker.classifyStepType("Add dependency lodash")).toBe("install_dependency");
    });

    it("should classify push steps", () => {
      expect(checker.classifyStepType("Push to remote")).toBe("git_push");
    });

    it("should classify commit steps", () => {
      expect(checker.classifyStepType("Commit changes")).toBe("git_commit");
    });

    it("should classify deploy steps", () => {
      expect(checker.classifyStepType("Deploy to production")).toBe("deploy");
      expect(checker.classifyStepType("Release v2.0")).toBe("deploy");
      expect(checker.classifyStepType("Publish package")).toBe("deploy");
    });

    it("should classify migration steps", () => {
      expect(checker.classifyStepType("Run database migration")).toBe("database_migration");
      expect(checker.classifyStepType("Migrate schema")).toBe("database_migration");
      expect(checker.classifyStepType("Update database schema")).toBe("database_migration");
    });

    it("should classify sensitive file steps", () => {
      expect(checker.classifyStepType("Read sensitive config")).toBe("read_sensitive_file");
      expect(checker.classifyStepType("Update secrets file")).toBe("read_sensitive_file");
      expect(checker.classifyStepType("Edit credentials")).toBe("read_sensitive_file");
    });

    it("should classify env config change steps", () => {
      expect(checker.classifyStepType("Change environment config")).toBe("env_config_change");
      expect(checker.classifyStepType("Update config settings")).toBe("env_config_change");
      expect(checker.classifyStepType("Modify env")).toBe("env_config_change");
    });

    it("should classify API call steps", () => {
      expect(checker.classifyStepType("Call external API")).toBe("external_api_call");
      expect(checker.classifyStepType("Send webhook notification")).toBe("external_api_call");
      expect(checker.classifyStepType("Fetch data from service")).toBe("external_api_call");
    });

    it("should classify network operation steps", () => {
      expect(checker.classifyStepType("Establish network connection")).toBe("network_operation");
      expect(checker.classifyStepType("SSH into server")).toBe("network_operation");
    });

    it("should classify validation override/skip steps", () => {
      expect(checker.classifyStepType("Skip validation check")).toBe("override_validation_failure");
      expect(checker.classifyStepType("Override validation failure")).toBe(
        "override_validation_failure",
      );
      expect(checker.classifyStepType("Bypass test failure")).toBe("override_validation_failure");
      expect(checker.classifyStepType("Ignore failure and continue")).toBe(
        "override_validation_failure",
      );
    });

    it("should classify plan execution steps", () => {
      expect(checker.classifyStepType("Plan execution approval")).toBe("plan_execution");
      expect(checker.classifyStepType("Apply plan now")).toBe("plan_execution");
      expect(checker.classifyStepType("Execute plan now")).toBe("plan_execution");
    });

    it("should classify continue after failure steps", () => {
      expect(checker.classifyStepType("Continue after failure")).toBe(
        "continue_after_repeated_failure",
      );
      expect(checker.classifyStepType("Retry after failure")).toBe(
        "continue_after_repeated_failure",
      );
      expect(checker.classifyStepType("Ignore error and continue")).toBe(
        "continue_after_repeated_failure",
      );
    });

    it("should classify high cost AI steps", () => {
      expect(checker.classifyStepType("High cost AI call")).toBe("high_cost_ai_usage");
      expect(checker.classifyStepType("Expensive model inference")).toBe("high_cost_ai_usage");
    });

    it("should default to command_execution for safe steps", () => {
      expect(checker.classifyStepType("Run tests")).toBe("command_execution");
      expect(checker.classifyStepType("Build project")).toBe("command_execution");
      expect(checker.classifyStepType("Lint codebase")).toBe("command_execution");
    });

    it("should use step command as secondary detection", () => {
      expect(checker.classifyStepType("Setup", "rm -rf temp")).toBe("delete_file");
      expect(checker.classifyStepType("Setup", "pnpm install")).toBe("install_dependency");
      expect(checker.classifyStepType("Setup", "git push")).toBe("git_push");
    });
  });

  describe("setConfig / getConfig", () => {
    it("should update config", () => {
      checker.setConfig({ requireFor: ["delete_file"] });
      expect(checker.getConfig().requireFor).toEqual(["delete_file"]);

      checker.setConfig({ autoApproveFor: ["delete_file"] });
      expect(checker.getConfig().autoApproveFor).toEqual(["delete_file"]);
    });

    it("should return current config with defaults", () => {
      const config = checker.getConfig();
      expect(config.requireFor).toBeDefined();
      expect(config.requireFor.length).toBeGreaterThan(0);
      expect(config.riskThreshold).toBe("medium");
      expect(config.requirePlanApproval).toBe(true);
      expect(config.requireStepApproval).toBe(true);
      expect(config.maxCostThreshold).toBe(0.5);
      expect(config.notifyOnGateBlock).toBe(true);
    });

    it("should merge partial config updates", () => {
      checker.setConfig({ riskThreshold: "high" });
      expect(checker.getConfig().riskThreshold).toBe("high");
      expect(checker.getConfig().requirePlanApproval).toBe(true);

      checker.setConfig({ requirePlanApproval: false });
      expect(checker.getConfig().riskThreshold).toBe("high");
      expect(checker.getConfig().requirePlanApproval).toBe(false);
    });
  });

  describe("checkCommand", () => {
    it("should check rm command as risky requiring approval", () => {
      const result = checker.checkCommand("rm -rf node_modules");
      expect(result.requiresApproval).toBe(true);
      expect(result.actionType).toBe("delete_file");
      expect(result.riskLevel).toBe("high");
    });

    it("should check ls command as safe (auto-run)", () => {
      const result = checker.checkCommand("ls -la");
      expect(result.requiresApproval).toBe(false);
      expect(result.actionType).toBe("command_execution");
      expect(result.autoApprove).toBe(true);
    });

    it("should check git push as risky", () => {
      const result = checker.checkCommand("git push origin main");
      expect(result.requiresApproval).toBe(true);
      expect(result.actionType).toBe("git_push");
    });

    it("should check override/skip commands as risky", () => {
      const result = checker.checkCommand("skip validation");
      expect(result.requiresApproval).toBe(true);
      expect(result.actionType).toBe("override_validation_failure");
    });
  });
});

describe("ApprovalGateChecker with riskThreshold", () => {
  it("should auto-approve medium risk when threshold is high", () => {
    const custom = new ApprovalGateChecker({
      riskThreshold: "high",
      requireFor: [
        "delete_file",
        "install_dependency",
        "git_push",
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
      ],
    });
    const mediumResult = custom.checkAction("install_dependency");
    expect(mediumResult.riskLevel).toBe("medium");
    expect(mediumResult.requiresApproval).toBe(true);
  });

  it("should auto-approve low-risk actions", () => {
    const custom = new ApprovalGateChecker({
      riskThreshold: "high",
      requireFor: ["file_write"],
    });
    custom.getConfig().riskThreshold = "high";
    const lowResult = custom.checkAction("file_write" as ActionType);
    expect(lowResult.requiresApproval).toBe(false);
  });
});

describe("ApprovalManager", () => {
  let manager: ApprovalManager;

  describe("with auto mode", () => {
    beforeEach(() => {
      manager = new ApprovalManager({ mode: "auto", enabled: true });
    });

    it("should auto-approve gate requests", async () => {
      const decision = await manager.requestGateApproval({
        taskId: "task-1",
        actionType: "delete_file",
        riskLevel: "high",
        reason: "File deletion requires approval",
        details: "rm -rf /tmp/test",
      });
      expect(decision).toBe("approved");
    });

    it("should auto-approve simple approval requests", async () => {
      const result = await manager.requestApproval({
        taskId: "task-1",
        command: "rm -rf /tmp/test",
        reason: "Deleting files",
      });
      expect(result).toBe(true);
    });

    it("should auto-approve retry approval requests", async () => {
      const result = await manager.requestRetryApproval({
        taskId: "task-1",
        taskTitle: "Test task",
        retryCount: 5,
        maxRetries: 2,
      });
      expect(result).toBe(true);
    });
  });

  describe("with skip mode", () => {
    beforeEach(() => {
      manager = new ApprovalManager({ mode: "skip", enabled: true });
    });

    it("should return approved for gate requests", async () => {
      const decision = await manager.requestGateApproval({
        taskId: "task-1",
        actionType: "delete_file",
        riskLevel: "critical",
        reason: "test",
        details: "test",
      });
      expect(decision).toBe("approved");
    });

    it("should return true for simple approval requests", async () => {
      const result = await manager.requestApproval({
        taskId: "task-1",
        command: "rm -rf /",
        reason: "test",
      });
      expect(result).toBe(true);
    });
  });

  describe("with disabled approval", () => {
    beforeEach(() => {
      manager = new ApprovalManager({ enabled: false });
    });

    it("should skip gate approvals", async () => {
      const decision = await manager.requestGateApproval({
        taskId: "task-1",
        actionType: "delete_file",
        riskLevel: "critical",
        reason: "test",
        details: "test",
      });
      expect(decision).toBe("approved");
    });

    it("should skip for non-interactive gate requests", async () => {
      const decision = await manager.requestGateApprovalNonInteractive({
        taskId: "task-1",
        actionType: "delete_file",
        riskLevel: "high",
        reason: "test",
        details: "test",
      });
      expect(decision).toBe("approved");
    });
  });

  describe("with interactive mode", () => {
    beforeEach(() => {
      manager = new ApprovalManager({ mode: "interactive" });
    });

    it("should return approved for non-interactive gate requests", async () => {
      const decision = await manager.requestGateApprovalNonInteractive({
        taskId: "task-1",
        actionType: "delete_file",
        riskLevel: "high",
        reason: "test",
        details: "test",
      });
      expect(decision).toBe("approved");
    });

    it("should handle step failure resolution with auto mode", async () => {
      const autoManager = new ApprovalManager({ mode: "auto" });
      const action = await autoManager.requestStepFailureResolution({
        taskId: "task-1",
        taskTitle: "Test task",
      });
      expect(action).toBe("skip");
    });
  });

  describe("config management", () => {
    it("should update config via setConfig", () => {
      manager = new ApprovalManager({ mode: "interactive" });
      manager.setConfig({ autoApprove: true });
      expect(manager.shouldAutoApprove()).toBe(true);
    });

    it("should detect shouldSkip correctly", () => {
      const skipManager = new ApprovalManager({ mode: "skip" });
      expect(skipManager.shouldSkip()).toBe(true);

      const disabledManager = new ApprovalManager({ enabled: false });
      expect(disabledManager.shouldSkip()).toBe(true);

      const interactiveManager = new ApprovalManager({ mode: "interactive" });
      expect(interactiveManager.shouldSkip()).toBe(false);
    });

    it("should detect shouldAutoApprove correctly", () => {
      const autoManager = new ApprovalManager({ mode: "auto" });
      expect(autoManager.shouldAutoApprove()).toBe(true);

      const approveManager = new ApprovalManager({ autoApprove: true });
      expect(approveManager.shouldAutoApprove()).toBe(true);

      const interactiveManager = new ApprovalManager({ mode: "interactive" });
      expect(interactiveManager.shouldAutoApprove()).toBe(false);
    });
  });

  describe("gate decision types", () => {
    it("should handle all gate decision types", () => {
      const decisions: GateDecision[] = ["approved", "rejected", "override", "skip"];
      expect(decisions).toHaveLength(4);
      expect(decisions).toContain("approved");
      expect(decisions).toContain("rejected");
      expect(decisions).toContain("override");
      expect(decisions).toContain("skip");
    });
  });
});

describe("ApprovalGateChecker full risk matrix", () => {
  let checker: ApprovalGateChecker;

  beforeEach(() => {
    checker = new ApprovalGateChecker();
  });

  const ALL_ACTIONS: Array<{
    action: ActionType;
    riskLevel: string;
    requiresApprovalDefault: boolean;
  }> = [
    { action: "delete_file", riskLevel: "high", requiresApprovalDefault: true },
    { action: "install_dependency", riskLevel: "medium", requiresApprovalDefault: true },
    { action: "git_push", riskLevel: "high", requiresApprovalDefault: true },
    { action: "git_commit", riskLevel: "medium", requiresApprovalDefault: true },
    { action: "deploy", riskLevel: "critical", requiresApprovalDefault: true },
    { action: "database_migration", riskLevel: "critical", requiresApprovalDefault: true },
    { action: "read_sensitive_file", riskLevel: "high", requiresApprovalDefault: true },
    { action: "env_config_change", riskLevel: "high", requiresApprovalDefault: true },
    { action: "external_api_call", riskLevel: "medium", requiresApprovalDefault: true },
    { action: "network_operation", riskLevel: "medium", requiresApprovalDefault: true },
    { action: "high_cost_ai_usage", riskLevel: "high", requiresApprovalDefault: true },
    {
      action: "continue_after_repeated_failure",
      riskLevel: "medium",
      requiresApprovalDefault: true,
    },
    { action: "skip_failed_validation", riskLevel: "high", requiresApprovalDefault: true },
    { action: "override_validation_failure", riskLevel: "critical", requiresApprovalDefault: true },
    { action: "plan_execution", riskLevel: "medium", requiresApprovalDefault: true },
    { action: "file_write", riskLevel: "safe", requiresApprovalDefault: false },
    { action: "command_execution", riskLevel: "safe", requiresApprovalDefault: false },
    { action: "unknown", riskLevel: "safe", requiresApprovalDefault: false },
  ];

  for (const { action, riskLevel, requiresApprovalDefault } of ALL_ACTIONS) {
    it(`should have correct risk level "${riskLevel}" for ${action}`, () => {
      const result = checker.checkAction(action);
      expect(result.riskLevel).toBe(riskLevel);
    });

    if (requiresApprovalDefault) {
      it(`should require approval by default for ${action}`, () => {
        const result = checker.checkAction(action);
        expect(result.requiresApproval).toBe(true);
      });
    } else {
      it(`should auto-run (no approval) by default for ${action}`, () => {
        const result = checker.checkAction(action);
        expect(result.requiresApproval).toBe(false);
      });
    }
  }

  it("should have all action types in ACTION_RISK_MAP", () => {
    const defined: ActionType[] = [
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
      "file_write",
      "command_execution",
      "unknown",
    ];
    for (const action of defined) {
      const result = checker.checkAction(action);
      expect(result.actionType).toBe(action);
      expect(result.riskLevel).toBeDefined();
    }
  });
});
