import { describe, it, expect, beforeAll } from "vitest";
import { ProjectManager } from "../../src/core/project-manager.js";
import { RunManager } from "../../src/core/run-manager.js";
import { RunLifecycle } from "../../src/core/run-lifecycle.js";
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

describe("Auto Bypass Approval Mode", () => {
  let projectDir: string;
  let projectId: string;
  let runManager: RunManager;

  beforeAll(async () => {
    projectDir = join(testDir, "auto-bypass-test");
    const manager = new ProjectManager();
    const project = await manager.init(projectDir, "Auto Bypass Test");
    projectId = project.projectId;
    runManager = new RunManager(projectDir);
  });

  it("should pause run in manual mode with autoApprove=false", async () => {
    const run = await runManager.createRun(projectId, "Manual-no-approve", "manual");
    await runManager.savePrompt(run.runId, "test prompt");
    await runManager.saveTasks(run.runId, [makeTask(run.runId, "task_pause", "pending")]);

    const config = await new ProjectManager().loadConfig(projectDir);
    config.approval.autoApprove = false;

    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.continueRun(run.runId);

    expect(result.paused).toBe(true);
    expect(result.success).toBe(true);

    const tasks = await runManager.loadTasks(run.runId);
    const pausedTask = tasks.find((t) => t.id === "task_pause");
    expect(pausedTask).toBeDefined();
    expect(pausedTask!.status).toBe("waiting_approval");
  });

  it("should NOT pause in auto mode regardless of autoApprove", async () => {
    const run = await runManager.createRun(projectId, "Auto-mode", "auto");
    await runManager.savePrompt(run.runId, "test prompt");
    await runManager.saveTasks(run.runId, [makeTask(run.runId, "task_auto", "pending")]);

    const config = await new ProjectManager().loadConfig(projectDir);
    config.approval.autoApprove = false;

    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.continueRun(run.runId);

    expect(result.paused).toBe(false);

    const tasks = await runManager.loadTasks(run.runId);
    const autoTask = tasks.find((t) => t.id === "task_auto");
    expect(autoTask).toBeDefined();
    expect(autoTask!.status).not.toBe("waiting_approval");
  });

  it("should bypass approval in manual mode with autoApprove=true", async () => {
    const run = await runManager.createRun(projectId, "Manual-with-approve", "manual");
    await runManager.savePrompt(run.runId, "test prompt");
    await runManager.saveTasks(run.runId, [makeTask(run.runId, "task_bypass", "pending")]);

    const config = await new ProjectManager().loadConfig(projectDir);
    config.approval.autoApprove = true;

    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.continueRun(run.runId);

    expect(result.paused).toBe(false);

    const tasks = await runManager.loadTasks(run.runId);
    const bypassedTask = tasks.find((t) => t.id === "task_bypass");
    expect(bypassedTask).toBeDefined();
    expect(bypassedTask!.status).not.toBe("waiting_approval");
  });

  it("should default autoApprove to false when using default config", async () => {
    const run = await runManager.createRun(projectId, "Defaults", "manual");
    await runManager.savePrompt(run.runId, "test prompt");
    await runManager.saveTasks(run.runId, [makeTask(run.runId, "task_default", "pending")]);

    const config = await new ProjectManager().loadConfig(projectDir);

    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.continueRun(run.runId);

    expect(result.paused).toBe(true);

    const tasks = await runManager.loadTasks(run.runId);
    const defaultTask = tasks.find((t) => t.id === "task_default");
    expect(defaultTask!.status).toBe("waiting_approval");
  });

  it("should skip already-finished tasks when pausing for approval", async () => {
    const run = await runManager.createRun(projectId, "Mixed-status", "manual");
    await runManager.savePrompt(run.runId, "test prompt");
    await runManager.saveTasks(run.runId, [
      makeTask(run.runId, "task_done", "done"),
      makeTask(run.runId, "task_pending_pause", "pending"),
    ]);

    const config = await new ProjectManager().loadConfig(projectDir);
    config.approval.autoApprove = false;

    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.continueRun(run.runId);

    expect(result.paused).toBe(true);

    const tasks = await runManager.loadTasks(run.runId);
    const completed = tasks.find((t) => t.id === "task_done");
    const paused = tasks.find((t) => t.id === "task_pending_pause");
    expect(completed!.status).toBe("done");
    expect(paused!.status).toBe("waiting_approval");
  });
});
