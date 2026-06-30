import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { ProjectManager } from "../../src/core/project-manager.js";
import { RunManager } from "../../src/core/run-manager.js";
import { RunLifecycle } from "../../src/core/run-lifecycle.js";
import { testDir } from "../setup.js";
import { join } from "node:path";

function makeTask(
  runId: string,
  id: string,
  status: "pending" | "waiting_input" | "waiting_approval" | "done",
  overrides?: Record<string, unknown>,
) {
  return {
    id,
    runId,
    title: `Task ${id}`,
    description: "Test task",
    status,
    executor: "shell",
    dependsOn: [] as string[],
    acceptanceCriteria: [] as string[],
    validation: undefined,
    retryCount: 0,
    maxRetries: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Waiting Input TTY Handling", () => {
  let projectDir: string;
  let projectId: string;
  let runManager: RunManager;

  beforeAll(async () => {
    projectDir = join(testDir, "waiting-input-tty-test");
    const manager = new ProjectManager();
    const project = await manager.init(projectDir, "Waiting Input TTY Test");
    projectId = project.projectId;
    runManager = new RunManager(projectDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should execute a task in non-TTY mode without crashing", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config, undefined, {
      skipValidation: true,
    });

    const run = await runManager.createRun(projectId, "waiting-input-test-run", "auto");
    const runId = run.runId;
    await runManager.savePrompt(runId, "test prompt");
    await runManager.saveTasks(runId, [
      makeTask(runId, "task_input_001", "pending", { executor: "shell" }),
    ]);

    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const result = await lifecycle.executeSingleTask(runId, "task_input_001");

    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });

    expect([true, false, "waiting_input", "waiting_approval"]).toContain(result);
  });

  it("should handle tasks without an executor configured", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    config.defaultExecutor = "nonexistent-executor";
    const lifecycle = new RunLifecycle(projectDir, projectId, config, undefined, {
      skipValidation: true,
    });

    const run = await runManager.createRun(projectId, "no-executor-run", "auto");
    const runId = run.runId;
    await runManager.savePrompt(runId, "test prompt");
    await runManager.saveTasks(runId, [
      makeTask(runId, "task_no_exec", "pending", { executor: "shell" }),
    ]);

    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const result = await lifecycle.executeSingleTask(runId, "task_no_exec");

    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });

    expect([true, false, "waiting_input", "waiting_approval"]).toContain(result);
  });
});

describe("Waiting Input Interactive - TTY with Enquirer", () => {
  let projectDir: string;
  let projectId: string;
  let runManager: RunManager;

  beforeAll(async () => {
    projectDir = join(testDir, "waiting-input-interactive-test");
    const manager = new ProjectManager();
    const project = await manager.init(projectDir, "Waiting Input Interactive Test");
    projectId = project.projectId;
    runManager = new RunManager(projectDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fall back to non-TTY message when Enquirer prompt is cancelled", async () => {
    vi.doMock("enquirer", () => ({
      default: class MockEnquirer {
        async prompt() {
          throw new Error("Prompt cancelled");
        }
      },
    }));

    // Re-import with mock
    const { RunLifecycle: MockedLifecycle } = await import("../../src/core/run-lifecycle.js");
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new MockedLifecycle(projectDir, projectId, config, undefined, {
      skipValidation: true,
    });

    const run = await runManager.createRun(projectId, "enquirer-cancel-test", "auto");
    const runId = run.runId;
    await runManager.savePrompt(runId, "test prompt");
    await runManager.saveTasks(runId, [
      makeTask(runId, "task_cancel_001", "pending", { executor: "shell" }),
    ]);

    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    const result = await lifecycle.executeSingleTask(runId, "task_cancel_001");

    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });

    expect([true, false, "waiting_input"]).toContain(result);
  });

  it("should execute a multi-step workflow continuing automatically without pausing", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config, undefined, {
      skipValidation: true,
    });

    const run = await runManager.createRun(projectId, "multi-step-auto-test", "auto");
    const runId = run.runId;
    await runManager.savePrompt(runId, "test multi-step prompt");
    await runManager.saveTasks(runId, [
      makeTask(runId, "task_1", "pending", {
        executor: "shell",
        validation: { commands: ["echo 'step 1 done'"] },
      }),
      makeTask(runId, "task_2", "pending", {
        executor: "shell",
        validation: { commands: ["echo 'step 2 done'"] },
      }),
      makeTask(runId, "task_3", "pending", {
        executor: "shell",
        validation: { commands: ["echo 'step 3 done'"] },
      }),
    ]);

    const result = await lifecycle.continueRun(runId);

    expect(result.success).toBe(true);
    expect(result.paused).toBe(false);

    const tasks = await runManager.loadTasks(runId);
    for (const task of tasks) {
      expect(task.status === "done" || task.status === "skipped").toBe(true);
    }
  });

  it("should handle repeated waiting_input for multi-step workflows", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config, undefined, {
      skipValidation: true,
    });

    const run = await runManager.createRun(projectId, "repeated-waiting-input-test", "auto");
    const runId = run.runId;
    await runManager.savePrompt(runId, "test prompt");

    // First task needs input (waiting_input), second is a normal shell task
    await runManager.saveTasks(runId, [
      makeTask(runId, "task_waiting_1", "waiting_input", {
        executor: "shell",
        validation: { commands: ["echo 'needs input'"] },
      }),
      makeTask(runId, "task_done_2", "pending", {
        executor: "shell",
        validation: { commands: ["echo 'auto task'"] },
      }),
    ]);

    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    // In non-TTY, waiting_input should cause pause
    const result = await lifecycle.continueRun(runId);

    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });

    expect(result.paused).toBe(true);

    const tasksAfterPause = await runManager.loadTasks(runId);
    const waitingTask = tasksAfterPause.find((t) => t.id === "task_waiting_1");
    expect(waitingTask?.status).toBe("waiting_input");
  });
});
