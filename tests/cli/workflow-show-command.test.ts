import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { RunManager } from "../../src/core/run-manager.js";
import { workflowShowCommand } from "../../src/cli/commands/workflow.command.js";
import { type Task } from "../../src/schemas/task.schema.js";

describe("workflowShowCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `wf-show-${Date.now()}`);
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

    await initCommand({ name: "WorkflowShowTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      readFileSync(join(projectDir, ".flowtask", "project.json"), "utf-8"),
    );
    const run = await runManager.createRun(project.projectId, "Workflow show test", "auto");
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
        acceptanceCriteria: ["deps installed"],
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
        status: "pending",
        executor: "opencode",
        dependsOn: ["task_002"],
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

  it("should export workflow as YAML by default", async () => {
    await workflowShowCommand(runId);

    expect(output).toContain("runTitle:");
    expect(output).toContain("Workflow show test");
    expect(output).toContain("Setup environment");
    expect(output).toContain("Run tests");
    expect(output).toContain("Build project");
  });

  it("should export workflow as JSON with --json flag", async () => {
    await workflowShowCommand(runId, { json: true });

    expect(output).toContain('"runTitle"');
    expect(output).toContain('"tasks"');
    expect(output).toContain("Setup environment");
    expect(output).toContain("Run tests");
    expect(output).toContain("Build project");
  });

  it("should write workflow to file with --out flag", async () => {
    const outPath = join(projectDir, "workflow-out.yaml");
    await workflowShowCommand(runId, { out: outPath });

    expect(existsSync(outPath)).toBe(true);
    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("Setup environment");
    expect(content).toContain("Build project");
    expect(output).toContain("Workflow written to");
    expect(output).toContain(outPath);
  });

  it("should write JSON to file with --out and --json flags", async () => {
    const outPath = join(projectDir, "workflow-out.json");
    await workflowShowCommand(runId, { out: outPath, json: true });

    expect(existsSync(outPath)).toBe(true);
    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("Setup environment");
    expect(JSON.parse(content)).toHaveProperty("tasks");
  });

  it("should skip completed tasks with --skip-completed", async () => {
    await workflowShowCommand(runId, { skipCompleted: true });

    expect(output).not.toContain("Setup environment");
    expect(output).not.toContain("Run tests");
    expect(output).toContain("Build project");
  });

  it("should show no tasks message when all are skipped via skipCompleted", async () => {
    const now = new Date().toISOString();
    const allDoneTasks: Task[] = [
      {
        id: "task_done_1",
        runId,
        title: "Done task",
        status: "done",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      },
    ];
    await runManager.saveTasks(runId, allDoneTasks);

    try {
      await workflowShowCommand(runId, { skipCompleted: true });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No tasks in workflow");
  });

  it("should show no active run message when no run specified", async () => {
    const noRunDir = join(testDir, `wf-show-no-run-${Date.now()}`);
    mkdirSync(noRunDir, { recursive: true });
    process.chdir(noRunDir);
    await initCommand({ name: "NoRunShowTest" });

    try {
      await workflowShowCommand();
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No active run found");
  });

  it("should show no tasks message when workflow has no tasks", async () => {
    const project = JSON.parse(
      readFileSync(join(projectDir, ".flowtask", "project.json"), "utf-8"),
    );
    const emptyRun = await runManager.createRun(project.projectId, "Empty run", "auto");
    await runManager.saveTasks(emptyRun.runId, []);

    try {
      await workflowShowCommand(emptyRun.runId);
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No tasks in workflow");
  });

  it("should include dependency info in YAML output", async () => {
    await workflowShowCommand(runId);

    expect(output).toContain("dependsOn");
    expect(output).toContain("task_001");
    expect(output).toContain("task_002");
  });

  it("should include acceptance criteria in output", async () => {
    await workflowShowCommand(runId);

    expect(output).toContain("deps installed");
  });

  it("should include executor info in output", async () => {
    await workflowShowCommand(runId);

    expect(output).toContain("opencode");
  });

  it("should include maxRetries in output", async () => {
    await workflowShowCommand(runId);

    expect(output).toContain("maxRetries");
  });

  it("should handle workflow with single task", async () => {
    const project = JSON.parse(
      readFileSync(join(projectDir, ".flowtask", "project.json"), "utf-8"),
    );
    const singleRun = await runManager.createRun(project.projectId, "Single task run", "auto");
    const now = new Date().toISOString();
    await runManager.saveTasks(singleRun.runId, [
      {
        id: "task_single",
        runId: singleRun.runId,
        title: "Single task",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await workflowShowCommand(singleRun.runId);

    expect(output).toContain("Single task");
  });
});
