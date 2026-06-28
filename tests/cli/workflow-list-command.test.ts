import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { RunManager } from "../../src/core/run-manager.js";
import { workflowListCommand } from "../../src/cli/commands/workflow.command.js";
import { type Task } from "../../src/schemas/task.schema.js";

describe("workflowListCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `wf-list-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
    process.stdin.isTTY = false as unknown as boolean;

    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    output = "";
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    await initCommand({ name: "WorkflowListTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Workflow list test", "auto");
    runId = run.runId;

    const now = new Date().toISOString();
    const tasks: Task[] = [
      {
        id: "task_001",
        runId,
        title: "Setup environment",
        description: "Install dependencies",
        status: "done",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "task_002",
        runId,
        title: "Run tests",
        status: "done",
        executor: "shell",
        dependsOn: ["task_001"],
        acceptanceCriteria: [],
        retryCount: 1,
        maxRetries: 3,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "task_003",
        runId,
        title: "Build project",
        status: "failed",
        executor: "opencode",
        dependsOn: ["task_002"],
        acceptanceCriteria: [],
        retryCount: 2,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "task_004",
        runId,
        title: "Deploy",
        status: "pending",
        executor: "shell",
        dependsOn: ["task_003"],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await runManager.saveTasks(runId, tasks);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should list all tasks in workflow", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("task_001");
    expect(output).toContain("task_002");
    expect(output).toContain("task_003");
    expect(output).toContain("task_004");
    expect(output).toContain("Setup environment");
    expect(output).toContain("Run tests");
    expect(output).toContain("Build project");
    expect(output).toContain("Deploy");
  });

  it("should show workflow title and run ID", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("Workflow list test");
    expect(output).toContain(runId);
  });

  it("should show progress bar and completion stats", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("Progress:");
    expect(output).toContain("2/4");
    expect(output).toContain("50%");
  });

  it("should show status icons for each task", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("Setup environment");
    expect(output).toContain("Run tests");
    expect(output).toContain("Build project");
    expect(output).toContain("Deploy");
  });

  it("should filter by status option", async () => {
    await workflowListCommand(runId, { status: "done" });

    expect(output).toContain("Setup environment");
    expect(output).toContain("Run tests");
    expect(output).not.toContain("Build project");
    expect(output).not.toContain("Deploy");
  });

  it("should filter by failed status", async () => {
    await workflowListCommand(runId, { status: "failed" });

    expect(output).toContain("Build project");
    expect(output).not.toContain("Setup environment");
    expect(output).not.toContain("Run tests");
    expect(output).not.toContain("Deploy");
  });

  it("should show dependency info", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("depends:");
    expect(output).toContain("task_001");
    expect(output).toContain("task_002");
    expect(output).toContain("task_003");
  });

  it("should show retry info for retried tasks", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("retries:");
    expect(output).toContain("1/3");
    expect(output).toContain("2/2");
  });

  it("should show custom executor info", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("via:");
    expect(output).toContain("opencode");
  });

  it("should show navigation hints", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("Navigation:");
    expect(output).toContain(`flowtask workflow show ${runId}`);
    expect(output).toContain(`flowtask tasks --run ${runId}`);
    expect(output).toContain(`flowtask inspect ${runId}`);
    expect(output).toContain(`flowtask resume ${runId}`);
  });

  it("should show no tasks message when workflow is empty", async () => {
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const emptyRun = await runManager.createRun(project.projectId, "Empty run", "auto");

    try {
      await workflowListCommand(emptyRun.runId);
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No tasks in workflow");
  });

  it("should show no active run message when no run specified", async () => {
    const noRunDir = join(testDir, `wf-list-no-run-${Date.now()}`);
    mkdirSync(noRunDir, { recursive: true });
    process.chdir(noRunDir);
    await initCommand({ name: "NoRunTest" });

    try {
      await workflowListCommand();
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No active run found");
  });

  it("should show run status in output", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("Status:");
  });

  it("should show task count in output", async () => {
    await workflowListCommand(runId);

    expect(output).toContain("(4 shown)");
  });
});
