import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { stepsCommand } from "../../src/cli/commands/steps.command.js";

describe("steps CLI command", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;

  beforeEach(async () => {
    projectDir = join(testDir, `steps-cmd-test-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
    process.stdin.isTTY = false as unknown as boolean;

    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    await initCommand({ name: "StepsTest" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should show no steps for a non-existent task", async () => {
    try {
      await stepsCommand("task_nonexistent", {});
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });

  it("should show no steps when no steps exist for a task", async () => {
    const runManager = new (await import("../../src/core/run-manager.js")).RunManager(projectDir);
    const run = await runManager.createRun("StepsTest", "Test run", "auto");
    const task = {
      id: "task_001",
      runId: run.runId,
      title: "Test task",
      status: "pending" as const,
      executor: "shell",
      dependsOn: [] as string[],
      acceptanceCriteria: [] as string[],
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await runManager.saveTasks(run.runId, [task]);

    const originalExit2 = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    let output = "";
    const originalLog = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      await stepsCommand("task_001", { run: run.runId });
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    } finally {
      process.exit = originalExit2;
      console.log = originalLog;
    }

    expect(output).toContain("No steps found");
  });

  it("should filter steps by status", async () => {
    const runManager = new (await import("../../src/core/run-manager.js")).RunManager(projectDir);
    const run = await runManager.createRun("StepsTest", "Filter test", "auto");
    const task = {
      id: "task_filter_001",
      runId: run.runId,
      title: "Filter task",
      status: "pending" as const,
      executor: "shell",
      dependsOn: [] as string[],
      acceptanceCriteria: [] as string[],
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await runManager.saveTasks(run.runId, [task]);

    const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
      projectDir,
    );
    const now = new Date().toISOString();
    await stepManager.saveSteps(run.runId, "task_filter_001", [
      {
        id: "step_done_002",
        taskId: "task_filter_001",
        runId: run.runId,
        title: "Done step",
        type: "shell",
        command: "echo done",
        status: "done",
        requiresApproval: false,
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "step_pending_002",
        taskId: "task_filter_001",
        runId: run.runId,
        title: "Pending step",
        type: "shell",
        command: "echo pending",
        status: "pending",
        requiresApproval: false,
        dependsOn: [],
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    let output = "";
    const originalLog = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };
    const originalExit2 = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    try {
      await stepsCommand("task_filter_001", { run: run.runId, status: "done" });
    } catch {
      // process.exit expected
    } finally {
      console.log = originalLog;
      process.exit = originalExit2;
    }

    expect(output).toContain("Done step");
    expect(output).not.toContain("Pending step");
  });

  it("should show when no steps match the status filter", async () => {
    const runManager = new (await import("../../src/core/run-manager.js")).RunManager(projectDir);
    const run = await runManager.createRun("StepsTest", "Filter empty test", "auto");
    const task = {
      id: "task_filter_empty_001",
      runId: run.runId,
      title: "Empty filter task",
      status: "pending" as const,
      executor: "shell",
      dependsOn: [] as string[],
      acceptanceCriteria: [] as string[],
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await runManager.saveTasks(run.runId, [task]);

    const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
      projectDir,
    );
    const now = new Date().toISOString();
    await stepManager.saveSteps(run.runId, "task_filter_empty_001", [
      {
        id: "step_done_003",
        taskId: "task_filter_empty_001",
        runId: run.runId,
        title: "Done step",
        type: "shell",
        command: "echo done",
        status: "done",
        requiresApproval: false,
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    let output = "";
    const originalLog = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };
    const originalExit2 = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    try {
      await stepsCommand("task_filter_empty_001", { run: run.runId, status: "pending" });
    } catch {
      // process.exit expected
    } finally {
      console.log = originalLog;
      process.exit = originalExit2;
    }

    expect(output).toContain("No steps found");
    expect(output).toContain('No steps with status "pending"');
  });

  it("should fail when run does not exist", async () => {
    try {
      await stepsCommand("task_001", { run: "nonexistent_run" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
  });

  it("should fail with no run specified when state has no active/last run", async () => {
    const runManager = new (await import("../../src/core/run-manager.js")).RunManager(projectDir);
    const run = await runManager.createRun("StepsTest", "Test for state", "auto");
    await runManager.saveTasks(run.runId, [
      {
        id: "task_state_001",
        runId: run.runId,
        title: "State task",
        status: "pending" as const,
        executor: "shell",
        dependsOn: [] as string[],
        acceptanceCriteria: [] as string[],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const originalExit2 = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    let output = "";
    const originalLog = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      await stepsCommand("task_state_001", {});
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
      expect(output).toContain("No run specified");
    } finally {
      process.exit = originalExit2;
      console.log = originalLog;
    }
  });

  it("should exit when not initialized", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);
    try {
      await stepsCommand("task_001", { run: "some_run" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit");
    }
  });

  it("should list steps with correct formatting", async () => {
    const runManager = new (await import("../../src/core/run-manager.js")).RunManager(projectDir);
    const run = await runManager.createRun("StepsTest", "Test run", "auto");
    const task = {
      id: "task_001",
      runId: run.runId,
      title: "Test task",
      status: "pending" as const,
      executor: "shell",
      dependsOn: [] as string[],
      acceptanceCriteria: [] as string[],
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await runManager.saveTasks(run.runId, [task]);

    const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
      projectDir,
    );
    const now = new Date().toISOString();
    await stepManager.saveSteps(run.runId, "task_001", [
      {
        id: "step_001",
        taskId: "task_001",
        runId: run.runId,
        title: "First step",
        type: "shell",
        command: "echo hello",
        status: "done",
        requiresApproval: false,
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "step_002",
        taskId: "task_001",
        runId: run.runId,
        title: "Second step",
        type: "command",
        status: "pending_approval",
        requiresApproval: true,
        approvalReason: "Needs review",
        dependsOn: [],
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    let output = "";
    const originalLog = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      await stepsCommand("task_001", { run: run.runId });
      expect(output).toContain("First step");
      expect(output).toContain("Second step");
      expect(output).toContain("step_001");
      expect(output).toContain("step_002");
      expect(output).toContain("pending_approval");
    } finally {
      console.log = originalLog;
    }
  });

  it("should display step ordering starting from 1", async () => {
    const runManager = new (await import("../../src/core/run-manager.js")).RunManager(projectDir);
    const run = await runManager.createRun("StepsTest", "Order test", "auto");
    const task = {
      id: "task_order_001",
      runId: run.runId,
      title: "Order task",
      status: "pending" as const,
      executor: "shell",
      dependsOn: [] as string[],
      acceptanceCriteria: [] as string[],
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await runManager.saveTasks(run.runId, [task]);

    const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
      projectDir,
    );
    const now = new Date().toISOString();
    await stepManager.saveSteps(run.runId, "task_order_001", [
      {
        id: "step_order_001",
        taskId: "task_order_001",
        runId: run.runId,
        title: "First ordered step",
        type: "shell",
        command: "echo first",
        status: "done",
        requiresApproval: false,
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "step_order_002",
        taskId: "task_order_001",
        runId: run.runId,
        title: "Second ordered step",
        type: "shell",
        command: "echo second",
        status: "pending",
        dependsOn: [],
        requiresApproval: false,
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    let output = "";
    const originalLog = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      await stepsCommand("task_order_001", { run: run.runId });
      expect(output).toContain("1.");
      expect(output).toContain("2.");
      expect(output).toContain("First ordered step");
      expect(output).toContain("Second ordered step");
    } finally {
      console.log = originalLog;
    }
  });

  it("should show pending approval hint when steps await approval", async () => {
    const runManager = new (await import("../../src/core/run-manager.js")).RunManager(projectDir);
    const run = await runManager.createRun("StepsTest", "Approval hint test", "auto");
    const task = {
      id: "task_approval_hint_001",
      runId: run.runId,
      title: "Approval hint task",
      status: "pending" as const,
      executor: "shell",
      dependsOn: [] as string[],
      acceptanceCriteria: [] as string[],
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await runManager.saveTasks(run.runId, [task]);

    const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
      projectDir,
    );
    const now = new Date().toISOString();
    await stepManager.saveSteps(run.runId, "task_approval_hint_001", [
      {
        id: "step_approval_hint_001",
        taskId: "task_approval_hint_001",
        runId: run.runId,
        title: "Needs approval",
        type: "shell",
        command: "echo risky",
        status: "pending_approval",
        requiresApproval: true,
        approvalReason: "Needs review",
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    let output = "";
    const originalLog = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      await stepsCommand("task_approval_hint_001", { run: run.runId });
      expect(output).toContain("step(s) pending approval");
      expect(output).toContain("flowtask step approve");
      expect(output).toContain("flowtask step deny");
    } finally {
      console.log = originalLog;
    }
  });

  it("should display task title in header", async () => {
    const runManager = new (await import("../../src/core/run-manager.js")).RunManager(projectDir);
    const run = await runManager.createRun("StepsTest", "Header test", "auto");
    const task = {
      id: "task_header_001",
      runId: run.runId,
      title: "Header Test Task",
      status: "pending" as const,
      executor: "shell",
      dependsOn: [] as string[],
      acceptanceCriteria: [] as string[],
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await runManager.saveTasks(run.runId, [task]);

    const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
      projectDir,
    );
    const now = new Date().toISOString();
    await stepManager.saveSteps(run.runId, "task_header_001", [
      {
        id: "step_header_001",
        taskId: "task_header_001",
        runId: run.runId,
        title: "Header step",
        type: "shell",
        command: "echo header",
        status: "pending",
        requiresApproval: false,
        dependsOn: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    let output = "";
    const originalLog = console.log;
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      await stepsCommand("task_header_001", { run: run.runId });
      expect(output).toContain("Header Test Task");
      expect(output).toContain("Steps for task");
    } finally {
      console.log = originalLog;
    }
  });
});
