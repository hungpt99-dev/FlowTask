import { describe, it, expect, beforeAll } from "vitest";
import { ProjectManager } from "../../src/core/project-manager.js";
import { RunManager } from "../../src/core/run-manager.js";
import { RunLifecycle } from "../../src/core/run-lifecycle.js";
import { StepManager } from "../../src/core/step-manager.js";
import { testDir } from "../setup.js";
import { join } from "node:path";

function makeTask(
  runId: string,
  id: string,
  status: "pending" | "waiting_approval" | "done",
  overrides?: Record<string, unknown>,
) {
  return {
    id,
    runId,
    title: `Task ${id}`,
    status,
    executor: "shell",
    dependsOn: [] as string[],
    acceptanceCriteria: [] as string[],
    retryCount: 0,
    maxRetries: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeStep(
  id: string,
  taskId: string,
  runId: string,
  status: "pending" | "pending_approval" | "approved" | "denied" | "done",
  order: number,
  requiresApproval = false,
) {
  return {
    id,
    taskId,
    runId,
    title: `Step ${id}`,
    type: "shell" as const,
    command: "echo hello",
    status,
    requiresApproval,
    approvalReason: requiresApproval ? "Requires review" : undefined,
    dependsOn: [] as string[],
    order,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Step Approval Integration in RunLifecycle", () => {
  let projectDir: string;
  let projectId: string;
  let runManager: RunManager;

  beforeAll(async () => {
    projectDir = join(testDir, "step-approval-lifecycle");
    const manager = new ProjectManager();
    const project = await manager.init(projectDir, "Step Approval Lifecycle Test");
    projectId = project.projectId;
    runManager = new RunManager(projectDir);
  });

  it("should auto-approve pending_approval steps when autoApprove is true", async () => {
    const run = await runManager.createRun(projectId, "Auto-approve steps", "auto");
    await runManager.savePrompt(run.runId, "test prompt");
    await runManager.saveTasks(run.runId, [makeTask(run.runId, "task_auto_approve", "pending")]);

    const stepManager = new StepManager(projectDir);
    await stepManager.saveSteps(run.runId, "task_auto_approve", [
      makeStep("step_req_001", "task_auto_approve", run.runId, "pending_approval", 0, true),
      makeStep("step_pending_001", "task_auto_approve", run.runId, "pending", 1, false),
    ]);

    const config = await new ProjectManager().loadConfig(projectDir);
    config.approval.autoApprove = true;

    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    await lifecycle.continueRun(run.runId);

    const steps = await stepManager.loadSteps(run.runId, "task_auto_approve");
    const reqStep = steps.find((s) => s.id === "step_req_001");
    expect(reqStep!.status).toBe("approved");
  });

  it("should deny pending_approval steps in non-TTY env when approval required", async () => {
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false as unknown as boolean;
    try {
      const run = await runManager.createRun(projectId, "Non-TTY approve", "auto");
      await runManager.savePrompt(run.runId, "test prompt");
      await runManager.saveTasks(run.runId, [makeTask(run.runId, "task_nontty", "pending")]);

      const stepManager = new StepManager(projectDir);
      await stepManager.saveSteps(run.runId, "task_nontty", [
        makeStep("step_nontty_001", "task_nontty", run.runId, "pending_approval", 0, true),
      ]);

      const config = await new ProjectManager().loadConfig(projectDir);
      config.approval.autoApprove = false;

      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      await lifecycle.continueRun(run.runId);

      const steps = await stepManager.loadSteps(run.runId, "task_nontty");
      const approved = steps.find((s) => s.id === "step_nontty_001");
      expect(approved!.status).toBe("denied");
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });

  it("should proceed when no steps require approval", async () => {
    const run = await runManager.createRun(projectId, "No approval steps", "auto");
    await runManager.savePrompt(run.runId, "test prompt");
    await runManager.saveTasks(run.runId, [makeTask(run.runId, "task_no_approval", "pending")]);

    const stepManager = new StepManager(projectDir);
    await stepManager.saveSteps(run.runId, "task_no_approval", [
      makeStep("step_noapp_001", "task_no_approval", run.runId, "pending", 0, false),
      makeStep("step_noapp_002", "task_no_approval", run.runId, "pending", 1, false),
    ]);

    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    await lifecycle.continueRun(run.runId);

    const tasks = await runManager.loadTasks(run.runId);
    const task = tasks.find((t) => t.id === "task_no_approval");
    expect(task).toBeDefined();
  });

  it("should auto-approve when approval is disabled", async () => {
    const run = await runManager.createRun(projectId, "Disabled approval", "auto");
    await runManager.savePrompt(run.runId, "test prompt");
    await runManager.saveTasks(run.runId, [makeTask(run.runId, "task_disabled", "pending")]);

    const stepManager = new StepManager(projectDir);
    await stepManager.saveSteps(run.runId, "task_disabled", [
      makeStep("step_disabled_001", "task_disabled", run.runId, "pending_approval", 0, true),
    ]);

    const config = await new ProjectManager().loadConfig(projectDir);
    config.approval.enabled = false;

    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    await lifecycle.continueRun(run.runId);

    const steps = await stepManager.loadSteps(run.runId, "task_disabled");
    const step = steps.find((s) => s.id === "step_disabled_001");
    expect(step!.status).toBe("approved");
  });

  it("should not block execution for tasks with no steps", async () => {
    const run = await runManager.createRun(projectId, "No steps", "auto");
    await runManager.savePrompt(run.runId, "test prompt");
    await runManager.saveTasks(run.runId, [makeTask(run.runId, "task_no_steps", "pending")]);

    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.continueRun(run.runId);

    expect(result.paused).toBe(false);
  });
});
