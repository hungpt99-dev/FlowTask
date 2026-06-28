import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { RunManager } from "../../src/core/run-manager.js";
import { workflowDiffCommand } from "../../src/cli/commands/workflow.command.js";
import { type Task } from "../../src/schemas/task.schema.js";

describe("workflowDiffCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `wf-diff-${Date.now()}`);
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

    await initCommand({ name: "WorkflowDiffTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Workflow diff test", "auto");
    runId = run.runId;

    const now = new Date().toISOString();
    const tasks: Task[] = [
      {
        id: "task_001",
        runId,
        title: "Setup environment",
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
        status: "pending",
        executor: "shell",
        dependsOn: ["task_001"],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 3,
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

  it("should show diff with added tasks from file", async () => {
    const workflowFile = join(projectDir, "new-workflow.yaml");
    writeFileSync(
      workflowFile,
      `version: "1.0"
tasks:
  - id: task_001
    title: Setup environment
    status: done
    executor: shell
    dependsOn: []
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 2
  - id: task_002
    title: Run tests
    status: pending
    executor: shell
    dependsOn:
      - task_001
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 3
  - id: task_003
    title: Deploy
    status: pending
    executor: shell
    dependsOn:
      - task_002
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 2
`,
      "utf-8",
    );

    await workflowDiffCommand(runId, workflowFile);

    expect(output).toContain("Workflow Diff");
    expect(output).toContain("added");
    expect(output).toContain("+");
    expect(output).toContain("task_003");
    expect(output).toContain("Deploy");
  });

  it("should show diff with removed tasks", async () => {
    const workflowFile = join(projectDir, "reduced-workflow.yaml");
    writeFileSync(
      workflowFile,
      `version: "1.0"
tasks:
  - id: task_001
    title: Setup environment
    status: done
    executor: shell
    dependsOn: []
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 2
`,
      "utf-8",
    );

    await workflowDiffCommand(runId, workflowFile);

    expect(output).toContain("removed");
    expect(output).toContain("-");
    expect(output).toContain("Run tests");
  });

  it("should show summary only with --summary-only flag", async () => {
    const workflowFile = join(projectDir, "summary-workflow.yaml");
    writeFileSync(
      workflowFile,
      `version: "1.0"
tasks:
  - id: task_001
    title: Setup environment
    status: done
    executor: shell
    dependsOn: []
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 2
  - id: task_002
    title: Run tests
    status: pending
    executor: shell
    dependsOn:
      - task_001
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 3
  - id: task_003
    title: Deploy
    status: pending
    executor: shell
    dependsOn:
      - task_002
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 2
`,
      "utf-8",
    );

    await workflowDiffCommand(runId, workflowFile, { summaryOnly: true });

    expect(output).toContain("Workflow Diff");
    expect(output).toContain("added");
    expect(output).not.toContain("+");
    expect(output).not.toContain("task_003");
  });

  it("should show task count transition", async () => {
    const workflowFile = join(projectDir, "count-workflow.yaml");
    writeFileSync(
      workflowFile,
      `version: "1.0"
tasks:
  - id: task_001
    title: Setup environment
    status: done
    executor: shell
    dependsOn: []
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 2
  - id: task_002
    title: Run tests
    status: pending
    executor: shell
    dependsOn:
      - task_001
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 3
  - id: task_003
    title: Deploy
    status: pending
    executor: shell
    dependsOn:
      - task_002
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 2
`,
      "utf-8",
    );

    await workflowDiffCommand(runId, workflowFile);

    expect(output).toContain("2 tasks → 3 tasks");
  });

  it("should show error when workflow file does not exist", async () => {
    try {
      await workflowDiffCommand(runId, "/nonexistent/workflow.yaml");
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(1)");
    }
    expect(output).toContain("Error loading workflow file");
  });

  it("should show no active run message when no run specified", async () => {
    const noRunDir = join(testDir, `wf-diff-no-run-${Date.now()}`);
    mkdirSync(noRunDir, { recursive: true });
    process.chdir(noRunDir);
    await initCommand({ name: "NoRunDiffTest" });

    try {
      await workflowDiffCommand();
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
    }
    expect(output).toContain("No active run found");
  });

  it("should show unchanged count when workflow matches", async () => {
    const workflowFile = join(projectDir, "same-workflow.yaml");
    writeFileSync(
      workflowFile,
      `version: "1.0"
tasks:
  - id: task_001
    title: Setup environment
    status: done
    executor: shell
    dependsOn: []
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 2
  - id: task_002
    title: Run tests
    status: pending
    executor: shell
    dependsOn:
      - task_001
    acceptanceCriteria: []
    retryCount: 0
    maxRetries: 3
`,
      "utf-8",
    );

    await workflowDiffCommand(runId, workflowFile);

    expect(output).toContain("unchanged");
  });

  it("should diff by comparing with exported workflow when no file provided", async () => {
    await workflowDiffCommand(runId);

    expect(output).toContain("Workflow Diff");
    expect(output).toContain("unchanged");
  });
});
