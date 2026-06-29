/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { cancelCommand } from "../../src/cli/commands/cancel.command.js";
import { RunManager } from "../../src/core/run-manager.js";
import { StepManager } from "../../src/core/step-manager.js";
import picocolors from "picocolors";

describe("CLI Commands", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `commands-${Date.now()}`);
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
    console.error = (...args: string[]) => {
      output += "[ERROR] " + args.join(" ") + "\n";
    };

    await initCommand({ name: "CommandsTest" });
    // Reset output after init messages so command output is clean
    output = "";

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Test run for commands", "auto");
    runId = run.runId;

    await runManager.saveTasks(runId, [
      {
        id: "task_done_001",
        runId,
        title: "Completed task",
        status: "done" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["Should produce output"],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task_failed_001",
        runId,
        title: "Failed task",
        status: "failed" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 1,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "task_pending_001",
        runId,
        title: "Pending task",
        status: "pending" as const,
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // Add steps
    const stepManager = new StepManager(projectDir);
    for (const task of await runManager.loadTasks(runId)) {
      await stepManager.saveSteps(runId, task.id, [
        {
          id: `step_${task.id}_1`,
          taskId: task.id,
          runId,
          title: `Step 1 for ${task.title}`,
          type: "command",
          status:
            task.status === "done" ? "succeeded" : task.status === "failed" ? "failed" : "pending",
          requiresApproval: false,
          order: 0,
          dependsOn: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
    }

    await runManager.updateRunStatus(runId, "running");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  // ── diff command tests ──

  describe("diff command", () => {
    it("should show workflow diff for a single run", async () => {
      const { diffCommand } = await import("../../src/cli/commands/diff.command.js");
      await diffCommand(runId, undefined, { workflow: true });
      expect(output).toContain("Workflow Diff");
      expect(output).toContain(runId);
    });

    it("should output workflow diff as JSON with --json", async () => {
      const { diffCommand } = await import("../../src/cli/commands/diff.command.js");
      await diffCommand(runId, undefined, { workflow: true, json: true });
      const parsed = JSON.parse(output.trim());
      expect(parsed).toHaveProperty("runId");
      expect(parsed).toHaveProperty("summary");
      expect(parsed).toHaveProperty("items");
      expect(parsed.runId).toBe(runId);
    });

    it("should compare two runs when two run IDs are provided", async () => {
      const project = JSON.parse(
        (await import("node:fs")).readFileSync(
          join(projectDir, ".flowtask", "project.json"),
          "utf-8",
        ),
      );
      const run2 = await runManager.createRun(project.projectId, "Second run for diff", "auto");
      await runManager.updateRunStatus(run2.runId, "completed");

      const { diffCommand } = await import("../../src/cli/commands/diff.command.js");
      await diffCommand(runId, run2.runId, {});
      expect(output).toContain("Run Comparison");
    });

    it("should error for non-existent run", async () => {
      const { diffCommand } = await import("../../src/cli/commands/diff.command.js");
      try {
        await diffCommand("nonexistent_run", undefined, { workflow: true });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });
  });

  // ── show command tests ──

  describe("show command", () => {
    it("should show run details including artifacts section", async () => {
      const { showCommand } = await import("../../src/cli/commands/show.command.js");
      await showCommand(runId, {});
      expect(output).toContain("Run ID:");
      expect(output).toContain("Status:");
      expect(output).toContain("Tasks");
      expect(output).toContain(runId);
    });

    it("should output run as JSON with --json", async () => {
      const { showCommand } = await import("../../src/cli/commands/show.command.js");
      await showCommand(runId, { json: true });
      const parsed = JSON.parse(output.trim());
      expect(parsed).toHaveProperty("runId");
      expect(parsed.runId).toBe(runId);
    });

    it("should show file changes when present", async () => {
      await runManager.loadRun(runId).then((run) => {
        if (run) {
          run.fileChanges = [{ path: "src/test.ts", type: "created", diffStat: "+10/-0" }];
          return runManager.saveRun(run);
        }
      });

      const { showCommand } = await import("../../src/cli/commands/show.command.js");
      await showCommand(runId, {});
      expect(output).toContain("File Changes");
      expect(output).toContain("src/test.ts");
    });

    it("should show error for non-existent run", async () => {
      const { showCommand } = await import("../../src/cli/commands/show.command.js");
      try {
        await showCommand("nonexistent", {});
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });
  });

  // ── skip command tests ──

  describe("skip command", () => {
    it("should skip a pending step when task ID is provided", async () => {
      const stepManager = new StepManager(projectDir);
      const tasks = await runManager.loadTasks(runId);
      // Use the pending task
      const pendingTask = tasks.find((t) => t.id === "task_pending_001")!;
      const stepId = `step_${pendingTask.id}_1`;

      const stepBefore = await stepManager.getStep(runId, pendingTask.id, stepId);
      expect(stepBefore).toBeDefined();

      const { skipCommand } = await import("../../src/cli/commands/skip.command.js");
      try {
        await skipCommand(stepId, { run: runId, task: pendingTask.id, reason: "test skip" });
      } catch {
        // process.exit may throw
      }

      const stepAfter = await stepManager.getStep(runId, pendingTask.id, stepId);
      expect(stepAfter!.status).toBe("skipped");
    });

    it("should error when step is not found", async () => {
      const { skipCommand } = await import("../../src/cli/commands/skip.command.js");
      try {
        await skipCommand("nonexistent_step", { run: runId });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });
  });

  // ── logs command tests ──

  describe("logs command", () => {
    it("should list log files when no task filter given", async () => {
      const { logsCommand } = await import("../../src/cli/commands/logs.command.js");
      try {
        await logsCommand({ run: runId, tail: "10" });
      } catch {
        // process.exit may throw when no log files
      }
      const hasRuntimeLogs = output.includes("runtime log");
      const hasLogFiles = output.includes("log files");
      expect(hasRuntimeLogs || hasLogFiles).toBe(true);
    });
  });

  // ── cancel command tests ──

  describe("cancel command", () => {
    it("should cancel a run and mark non-done tasks as cancelled", async () => {
      await cancelCommand(runId);
      expect(output).toContain("Run cancelled");
      expect(output).toContain("Test run for commands");

      const tasks = await runManager.loadTasks(runId);
      const doneTask = tasks.find((t) => t.id === "task_done_001");
      expect(doneTask!.status).toBe("done"); // done tasks stay done
      const failedTask = tasks.find((t) => t.id === "task_failed_001");
      expect(failedTask!.status).toBe("failed"); // failed tasks stay failed (cancel only affects running/pending/interrupted)
      const pendingTask = tasks.find((t) => t.id === "task_pending_001");
      expect(pendingTask!.status).toBe("cancelled");
    });

    it("should show error for non-existent run", async () => {
      try {
        await cancelCommand("nonexistent");
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });

    it("should show message for already completed run", async () => {
      await runManager.updateRunStatus(runId, "completed");
      try {
        await cancelCommand(runId);
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(0)");
      }
      expect(output).toContain("already completed");
    });
  });

  // ── status command tests ──

  describe("status command", () => {
    it("should show project and run status", async () => {
      const { statusCommand } = await import("../../src/cli/commands/status.command.js");
      await statusCommand();
      expect(output).toContain("FlowTask Project");
      expect(output).toContain("CommandsTest");
    });

    it("should show specific run by ID", async () => {
      const { statusCommand } = await import("../../src/cli/commands/status.command.js");
      await statusCommand(runId);
      expect(output).toContain("Test run for commands");
      expect(output).toContain(runId);
    });
  });

  // ── retry command tests ──

  describe("retry command", () => {
    it("should list failed tasks with --failed-only --dry-run", async () => {
      const { retryCommand } = await import("../../src/cli/commands/retry.command.js");
      try {
        await retryCommand(runId, { run: runId, failedOnly: true, dryRun: true });
      } catch {
        // process.exit may throw
      }
      expect(output).toContain("dry-run");
      expect(output).toContain("Failed task");
    });
  });

  // ── graph command tests ──

  describe("graph command", () => {
    it("should show workflow graph for a run", async () => {
      const { graphCommand } = await import("../../src/cli/commands/graph.command.js");
      await graphCommand(runId, {});
      expect(output).toContain("Workflow Graph");
      expect(output).toContain("Completed task");
      expect(output).toContain("Failed task");
    });

    it("should output graph as JSON with --json", async () => {
      const { graphCommand } = await import("../../src/cli/commands/graph.command.js");
      await graphCommand(runId, { json: true });
      const parsed = JSON.parse(output.trim());
      expect(parsed).toHaveProperty("run");
      expect(parsed).toHaveProperty("tasks");
      expect(parsed).toHaveProperty("steps");
    });
  });

  // ── history command tests ──

  describe("history command", () => {
    it("should list run history", async () => {
      const { historyCommand } = await import("../../src/cli/commands/history.command.js");
      await historyCommand({});
      expect(output).toContain("Run History");
      expect(output).toContain("Test run for commands");
    });

    it("should filter by status", async () => {
      const { historyCommand } = await import("../../src/cli/commands/history.command.js");
      await historyCommand({ status: "running" });
      expect(output).toContain("Run History");
    });
  });

  // ── pause command tests ──

  describe("pause command", () => {
    it("should pause a running run", async () => {
      const { EventStore } = await import("../../src/core/event-store.js");
      const { WorkflowManager } = await import("../../src/core/workflow-manager.js");
      const eventStore = new EventStore(projectDir);
      const wfManager = new WorkflowManager(projectDir, runManager, eventStore);
      // Initialize workflow and transition to running
      await wfManager.initWorkflowState(runId);
      await wfManager.transitionWorkflowState(runId, "scanning", "test");
      await wfManager.transitionWorkflowState(runId, "planning", "test");
      await wfManager.transitionWorkflowState(runId, "planned", "test");
      await wfManager.transitionWorkflowState(runId, "ready", "test");
      await wfManager.transitionWorkflowState(runId, "running", "test");

      const { pauseCommand } = await import("../../src/cli/commands/pause.command.js");
      await pauseCommand(runId, { reason: "testing pause" });
      expect(output).toContain("Run paused");
      expect(output).toContain(runId);
    });
  });

  // ── validate command tests ──

  describe("validate command", () => {
    it("should validate all tasks in a run", async () => {
      const { validateCommand } = await import("../../src/cli/commands/validate.command.js");
      await validateCommand(runId, {});
      expect(output).toContain("Validating run");
      expect(output).toContain(runId);
    });

    it("should validate a specific task", async () => {
      const { validateCommand } = await import("../../src/cli/commands/validate.command.js");
      await validateCommand(runId, { task: "task_done_001" });
      expect(output).toContain("Completed task");
    });
  });

  // ── artifacts command tests ──

  describe("artifacts command", () => {
    it("should list artifacts for a run (may be empty)", async () => {
      const { artifactsCommand } = await import("../../src/cli/commands/artifacts.command.js");
      await artifactsCommand(runId, {});
      expect(output).toContain("artifacts");
    });

    it("should output artifacts as JSON with --json", async () => {
      const { artifactsCommand } = await import("../../src/cli/commands/artifacts.command.js");
      await artifactsCommand(runId, { json: true });
      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
    });
  });
});

describe("CLI Commands - Initialization Check", () => {
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
    output = "";
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
  });

  it("should handle non-initialized project gracefully", async () => {
    const uninitDir = join(testDir, `not-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);

    const commands = ["cancel", "status", "logs", "pause", "skip", "validate"];

    for (const cmdName of commands) {
      output = "";
      try {
        const modPath = `../../src/cli/commands/${cmdName}.command.js`;
        const mod = await import(modPath);
        const fnName = `${cmdName}Command`;

        if (cmdName === "cancel") {
          await mod[fnName]("some_run");
        } else if (cmdName === "status") {
          await mod[fnName]();
        } else if (cmdName === "logs") {
          await mod[fnName]({ run: "some_run" });
        } else if (cmdName === "pause") {
          await mod[fnName]("some_run", {});
        } else if (cmdName === "skip") {
          await mod[fnName]("step_id", { run: "some_run", task: "task_id" });
        } else if (cmdName === "validate") {
          await mod[fnName]("some_run", {});
        }

        expect(output).toContain("not initialized");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit");
      }
    }
  });
});
