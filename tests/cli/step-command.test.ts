import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import {
  stepEditCommand,
  stepApproveCommand,
  stepDenyCommand,
  stepApproveAllCommand,
} from "../../src/cli/commands/step.command.js";
import { RunManager } from "../../src/core/run-manager.js";

describe("step CLI commands", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let runManager: RunManager;
  let runId: string;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `step-cmd-${Date.now()}`);
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

    await initCommand({ name: "StepCmdTest" });

    runManager = new RunManager(projectDir);
    const project = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(projectDir, ".flowtask", "project.json"),
        "utf-8",
      ),
    );
    const run = await runManager.createRun(project.projectId, "Step test", "auto");
    runId = run.runId;

    await runManager.saveTasks(runId, [
      {
        id: "task_step_001",
        runId,
        title: "Test task",
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

    const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
      projectDir,
    );
    const now = new Date().toISOString();
    await stepManager.saveSteps(runId, "task_step_001", [
      {
        id: "step_edit_001",
        taskId: "task_step_001",
        runId,
        title: "Original step",
        type: "shell",
        command: "echo hello",
        status: "pending",
        requiresApproval: false,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "step_app_001",
        taskId: "task_step_001",
        runId,
        title: "Approve me",
        type: "shell",
        command: "echo risky",
        status: "pending_approval",
        requiresApproval: true,
        approvalReason: "Needs review",
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "step_done_001",
        taskId: "task_step_001",
        runId,
        title: "Done step",
        type: "shell",
        command: "echo done",
        status: "done",
        requiresApproval: false,
        order: 2,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  describe("stepEditCommand", () => {
    it("should edit step title", async () => {
      await stepEditCommand("step_edit_001", { run: runId, title: "Updated step title" });

      expect(output).toContain("Step step_edit_001 updated");
      expect(output).toContain("Updated step title");
    });

    it("should edit step description", async () => {
      await stepEditCommand("step_edit_001", {
        run: runId,
        description: "New description",
      });

      expect(output).toContain("Step step_edit_001 updated");
    });

    it("should edit step command", async () => {
      await stepEditCommand("step_edit_001", {
        run: runId,
        command: "echo updated",
      });

      expect(output).toContain("echo updated");
    });

    it("should set description to empty string", async () => {
      await stepEditCommand("step_edit_001", {
        run: runId,
        description: "",
      });

      expect(output).toContain("Step step_edit_001 updated");

      const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
        projectDir,
      );
      const step = await stepManager.getStep(runId, "task_step_001", "step_edit_001");
      expect(step!.description).toBe("");
    });

    it("should set command to empty string", async () => {
      await stepEditCommand("step_edit_001", {
        run: runId,
        command: "",
      });

      expect(output).toContain("Step step_edit_001 updated");

      const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
        projectDir,
      );
      const step = await stepManager.getStep(runId, "task_step_001", "step_edit_001");
      expect(step!.command).toBe("");
    });

    it("should edit both description and command simultaneously", async () => {
      await stepEditCommand("step_edit_001", {
        run: runId,
        description: "Combined desc",
        command: "echo combined",
      });

      expect(output).toContain("Combined desc");
      expect(output).toContain("echo combined");
    });

    it("should edit step type", async () => {
      await stepEditCommand("step_edit_001", {
        run: runId,
        type: "command",
      });

      expect(output).toContain("command");
    });

    it("should fail when no changes specified", async () => {
      try {
        await stepEditCommand("step_edit_001", { run: runId });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(0)");
      }
    });

    it("should fail editing a done step", async () => {
      try {
        await stepEditCommand("step_done_001", { run: runId, title: "New title" });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(0)");
      }
    });

    it("should fail for non-existent step", async () => {
      try {
        await stepEditCommand("nonexistent", { run: runId, title: "New" });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });

    it("should fail when run does not exist", async () => {
      try {
        await stepEditCommand("step_edit_001", { run: "nonexistent_run" });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });

    it("should resolve run from state when no --run option given", async () => {
      const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
      await manager.saveState(projectDir, {
        projectId: JSON.parse(
          (await import("node:fs")).readFileSync(
            join(projectDir, ".flowtask", "project.json"),
            "utf-8",
          ),
        ).projectId,
        status: "has_running_run",
        activeRunId: runId,
        lastRunId: runId,
        updatedAt: new Date().toISOString(),
      });

      output = "";
      await stepEditCommand("step_edit_001", { title: "State resolved title" });

      expect(output).toContain("State resolved title");
    });

    it("should fail with no run specified when state has no active/last run", async () => {
      const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
      await manager.saveState(projectDir, {
        projectId: JSON.parse(
          (await import("node:fs")).readFileSync(
            join(projectDir, ".flowtask", "project.json"),
            "utf-8",
          ),
        ).projectId,
        status: "idle",
        updatedAt: new Date().toISOString(),
      });

      output = "";
      try {
        await stepEditCommand("step_edit_001", { title: "Should fail" });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
      expect(output).toContain("No run specified");
    });

    it("should persist edits to disk", async () => {
      await stepEditCommand("step_edit_001", { run: runId, title: "Persisted step" });

      const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
        projectDir,
      );
      const step = await stepManager.getStep(runId, "task_step_001", "step_edit_001");
      expect(step!.title).toBe("Persisted step");
    });

    it("should exit when not initialized", async () => {
      const uninitDir = join(testDir, `not-init-${Date.now()}`);
      mkdirSync(uninitDir, { recursive: true });
      process.chdir(uninitDir);
      try {
        await stepEditCommand("step_edit_001", { run: runId, title: "New" });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit");
      }
    });
  });

  describe("stepApproveCommand", () => {
    it("should approve a step pending approval", async () => {
      await stepApproveCommand("step_app_001", { run: runId });

      expect(output).toContain("Step step_app_001 approved");
    });

    it("should fail approving a step not pending approval", async () => {
      try {
        await stepApproveCommand("step_edit_001", { run: runId });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(0)");
      }
    });

    it("should fail when run does not exist", async () => {
      try {
        await stepApproveCommand("step_app_001", { run: "nonexistent_run" });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });

    it("should resolve run from state when no --run option given", async () => {
      const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
      await manager.saveState(projectDir, {
        projectId: JSON.parse(
          (await import("node:fs")).readFileSync(
            join(projectDir, ".flowtask", "project.json"),
            "utf-8",
          ),
        ).projectId,
        status: "has_running_run",
        activeRunId: runId,
        lastRunId: runId,
        updatedAt: new Date().toISOString(),
      });

      output = "";
      await stepApproveCommand("step_app_001", {});

      expect(output).toContain("Step step_app_001 approved");
    });

    it("should persist approval to disk", async () => {
      await stepApproveCommand("step_app_001", { run: runId });

      const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
        projectDir,
      );
      const step = await stepManager.getStep(runId, "task_step_001", "step_app_001");
      expect(step!.status).toBe("approved");
    });

    it("should exit when not initialized", async () => {
      const uninitDir = join(testDir, `not-init-${Date.now()}`);
      mkdirSync(uninitDir, { recursive: true });
      process.chdir(uninitDir);
      try {
        await stepApproveCommand("step_app_001", { run: runId });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit");
      }
    });
  });

  describe("stepDenyCommand", () => {
    it("should deny a step pending approval", async () => {
      await stepDenyCommand("step_app_001", { run: runId });

      expect(output).toContain("Step step_app_001 denied");
    });

    it("should fail denying a step not pending approval", async () => {
      try {
        await stepDenyCommand("step_edit_001", { run: runId });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(0)");
      }
    });

    it("should fail when run does not exist", async () => {
      try {
        await stepDenyCommand("step_app_001", { run: "nonexistent_run" });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });

    it("should resolve run from state when no --run option given", async () => {
      const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
      await manager.saveState(projectDir, {
        projectId: JSON.parse(
          (await import("node:fs")).readFileSync(
            join(projectDir, ".flowtask", "project.json"),
            "utf-8",
          ),
        ).projectId,
        status: "has_running_run",
        activeRunId: runId,
        lastRunId: runId,
        updatedAt: new Date().toISOString(),
      });

      output = "";
      await stepDenyCommand("step_app_001", {});

      expect(output).toContain("Step step_app_001 denied");
    });

    it("should persist denial to disk", async () => {
      await stepDenyCommand("step_app_001", { run: runId });

      const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
        projectDir,
      );
      const step = await stepManager.getStep(runId, "task_step_001", "step_app_001");
      expect(step!.status).toBe("denied");
    });

    it("should exit when not initialized", async () => {
      const uninitDir = join(testDir, `not-init-${Date.now()}`);
      mkdirSync(uninitDir, { recursive: true });
      process.chdir(uninitDir);
      try {
        await stepDenyCommand("step_app_001", { run: runId });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit");
      }
    });
  });

  describe("stepApproveAllCommand", () => {
    it("should approve all pending approval steps in the run", async () => {
      const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
        projectDir,
      );
      const now = new Date().toISOString();

      await stepManager.saveSteps(runId, "task_step_001", [
        {
          id: "step_approve_all_001",
          taskId: "task_step_001",
          runId,
          title: "Approve all test 1",
          type: "shell",
          command: "echo test1",
          status: "pending_approval",
          requiresApproval: true,
          approvalReason: "Needs review",
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "step_approve_all_002",
          taskId: "task_step_001",
          runId,
          title: "Approve all test 2",
          type: "shell",
          command: "echo test2",
          status: "pending_approval",
          requiresApproval: true,
          approvalReason: "Needs review",
          order: 1,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      output = "";
      await stepApproveAllCommand({ run: runId });

      expect(output).toContain("Approved 2 step(s)");

      const steps = await stepManager.loadSteps(runId, "task_step_001");
      const s1 = steps.find((s) => s.id === "step_approve_all_001");
      const s2 = steps.find((s) => s.id === "step_approve_all_002");
      expect(s1!.status).toBe("approved");
      expect(s2!.status).toBe("approved");
    });

    it("should handle no pending steps gracefully", async () => {
      const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
        projectDir,
      );
      await stepManager.saveSteps(runId, "task_step_001", []);

      output = "";
      try {
        await stepApproveAllCommand({ run: runId });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(0)");
      }
      expect(output).toContain("No steps pending approval");
    });

    it("should resolve run from state", async () => {
      const manager = new (await import("../../src/core/project-manager.js")).ProjectManager();
      await manager.saveState(projectDir, {
        projectId: JSON.parse(
          (await import("node:fs")).readFileSync(
            join(projectDir, ".flowtask", "project.json"),
            "utf-8",
          ),
        ).projectId,
        status: "has_running_run",
        activeRunId: runId,
        lastRunId: runId,
        updatedAt: new Date().toISOString(),
      });

      const stepManager = new (await import("../../src/core/step-manager.js")).StepManager(
        projectDir,
      );
      const now = new Date().toISOString();
      await stepManager.saveSteps(runId, "task_step_001", [
        {
          id: "step_state_001",
          taskId: "task_step_001",
          runId,
          title: "State resolved",
          type: "shell",
          command: "echo state",
          status: "pending_approval",
          requiresApproval: true,
          approvalReason: "Test",
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      output = "";
      await stepApproveAllCommand({});
      expect(output).toContain("Approved 1 step(s)");
    });

    it("should exit when not initialized", async () => {
      const uninitDir = join(testDir, `not-init-${Date.now()}`);
      mkdirSync(uninitDir, { recursive: true });
      process.chdir(uninitDir);
      try {
        await stepApproveAllCommand({ run: runId });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit");
      }
    });
  });
});
