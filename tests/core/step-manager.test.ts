import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { StepManager } from "../../src/core/step-manager.js";
import type { Step } from "../../src/schemas/step.schema.js";

function makeTestDir(): string {
  const dir = path.join(os.tmpdir(), `flowtask-sm-test-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTimestamp(): string {
  return new Date().toISOString();
}

function makeStep(id: string, taskId: string, runId: string, overrides?: Partial<Step>): Step {
  const now = makeTimestamp();
  return {
    id,
    taskId,
    runId,
    title: `Step ${id}`,
    type: "command",
    status: "pending",
    requiresApproval: false,
    dependsOn: [],
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("StepManager", () => {
  let rootPath: string;
  let stepManager: StepManager;
  const runId = "test-run-001";
  const taskId = "test-task-001";

  beforeEach(() => {
    rootPath = makeTestDir();
    stepManager = new StepManager(rootPath);
    fs.mkdirSync(path.join(rootPath, ".flowtask", "runs", runId), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  describe("saveSteps / loadSteps", () => {
    it("should save and load steps for a task", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0, title: "First step" }),
        makeStep("s2", taskId, runId, { order: 1, title: "Second step" }),
      ];

      await stepManager.saveSteps(runId, taskId, steps);
      const loaded = await stepManager.loadSteps(runId, taskId);
      expect(loaded).toHaveLength(2);
      expect(loaded[0]!.id).toBe("s1");
      expect(loaded[0]!.title).toBe("First step");
      expect(loaded[1]!.id).toBe("s2");
    });

    it("should return empty array for non-existent task", async () => {
      const steps = await stepManager.loadSteps(runId, "nonexistent-task");
      expect(steps).toEqual([]);
    });

    it("should overwrite steps when saving again", async () => {
      const steps1: Step[] = [makeStep("s1", taskId, runId, { order: 0 })];
      await stepManager.saveSteps(runId, taskId, steps1);

      const steps2: Step[] = [
        makeStep("s1", taskId, runId, { order: 0 }),
        makeStep("s2", taskId, runId, { order: 1 }),
      ];
      await stepManager.saveSteps(runId, taskId, steps2);

      const loaded = await stepManager.loadSteps(runId, taskId);
      expect(loaded).toHaveLength(2);
    });

    it("should persist steps to disk", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0 })];
      await stepManager.saveSteps(runId, taskId, steps);

      const reloaded = new StepManager(rootPath);
      const loaded = await reloaded.loadSteps(runId, taskId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.id).toBe("s1");
    });
  });

  describe("getStep", () => {
    it("should get a specific step by id", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0 }),
        makeStep("s2", taskId, runId, { order: 1 }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const step = await stepManager.getStep(runId, taskId, "s1");
      expect(step).toBeDefined();
      expect(step!.id).toBe("s1");
    });

    it("should return undefined for non-existent step", async () => {
      const step = await stepManager.getStep(runId, taskId, "nonexistent");
      expect(step).toBeUndefined();
    });
  });

  describe("updateStep", () => {
    it("should update step properties", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, title: "Original" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const updated = await stepManager.updateStep(runId, taskId, "s1", {
        title: "Updated",
        command: "echo updated",
      });

      expect(updated.title).toBe("Updated");
      expect(updated.command).toBe("echo updated");
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(steps[0]!.updatedAt).getTime(),
      );
    });

    it("should throw for non-existent step", async () => {
      await expect(
        stepManager.updateStep(runId, taskId, "nonexistent", { title: "Nope" }),
      ).rejects.toThrow("Step not found");
    });

    it("should reject invalid status transitions", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "created" })];
      await stepManager.saveSteps(runId, taskId, steps);

      await expect(
        stepManager.updateStep(runId, taskId, "s1", { status: "succeeded" }),
      ).rejects.toThrow("Invalid state transition");
    });

    it("should reject invalid updates via schema validation", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0 })];
      await stepManager.saveSteps(runId, taskId, steps);

      await expect(
        stepManager.updateStep(runId, taskId, "s1", { status: "invalid_status" as never }),
      ).rejects.toThrow();
    });

    it("should set startedAt when transitioning to running", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "created" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const updated = await stepManager.updateStep(runId, taskId, "s1", { status: "pending" });
      expect(updated.status).toBe("pending");
      expect(updated.startedAt).toBeUndefined();

      const running = await stepManager.updateStep(runId, taskId, "s1", { status: "running" });
      expect(running.startedAt).toBeDefined();
    });

    it("should set finishedAt when transitioning to terminal state", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "created" })];
      await stepManager.saveSteps(runId, taskId, steps);

      await stepManager.updateStep(runId, taskId, "s1", { status: "pending" });
      await stepManager.updateStep(runId, taskId, "s1", { status: "running" });
      const finished = await stepManager.updateStep(runId, taskId, "s1", { status: "succeeded" });
      expect(finished.finishedAt).toBeDefined();
    });
  });

  describe("updateStepStatus", () => {
    it("should update step status", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "created" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const updated = await stepManager.updateStepStatus(runId, taskId, "s1", "pending");
      expect(updated.status).toBe("pending");
    });

    it("should enforce state machine transitions", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "succeeded" })];
      await stepManager.saveSteps(runId, taskId, steps);

      await expect(stepManager.updateStepStatus(runId, taskId, "s1", "running")).rejects.toThrow(
        "Invalid state transition",
      );
    });

    it("should transition through multiple valid statuses", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "created" })];
      await stepManager.saveSteps(runId, taskId, steps);

      await stepManager.updateStepStatus(runId, taskId, "s1", "pending");
      await stepManager.updateStepStatus(runId, taskId, "s1", "running");
      await stepManager.updateStepStatus(runId, taskId, "s1", "succeeded");

      const step = await stepManager.getStep(runId, taskId, "s1");
      expect(step!.status).toBe("succeeded");
    });

    it("should allow retry transition from failed", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "running" })];
      await stepManager.saveSteps(runId, taskId, steps);

      await stepManager.updateStepStatus(runId, taskId, "s1", "failed");
      await stepManager.updateStepStatus(runId, taskId, "s1", "retrying");
      await stepManager.updateStepStatus(runId, taskId, "s1", "running");

      const step = await stepManager.getStep(runId, taskId, "s1");
      expect(step!.status).toBe("running");
    });
  });

  describe("approveStep / denyStep", () => {
    it("should approve a pending_approval step", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
          approvalReason: "Needs review",
        }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const approved = await stepManager.approveStep(runId, taskId, "s1");
      expect(approved.status).toBe("approved");
    });

    it("should approve a waiting_approval step by transitioning to running", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "waiting_approval",
          requiresApproval: true,
        }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const approved = await stepManager.approveStep(runId, taskId, "s1");
      expect(approved.status).toBe("running");
    });

    it("should deny a pending_approval step", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
        }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const denied = await stepManager.denyStep(runId, taskId, "s1");
      expect(denied.status).toBe("denied");
    });

    it("should cancel a waiting_approval step when denied", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "waiting_approval",
          requiresApproval: true,
        }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const denied = await stepManager.denyStep(runId, taskId, "s1");
      expect(denied.status).toBe("cancelled");
    });
  });

  describe("approveAllPending", () => {
    it("should approve all pending_approval steps for a task", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
        }),
        makeStep("s2", taskId, runId, {
          dependsOn: [],
          order: 1,
          status: "pending_approval",
          requiresApproval: true,
        }),
        makeStep("s3", taskId, runId, { order: 2, status: "pending", requiresApproval: false }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const approved = await stepManager.approveAllPending(runId, taskId);
      expect(approved).toHaveLength(2);
      expect(approved.every((s) => s.status === "approved")).toBe(true);

      const allSteps = await stepManager.loadSteps(runId, taskId);
      const s3 = allSteps.find((s) => s.id === "s3");
      expect(s3!.status).toBe("pending");
    });

    it("should return empty array when no pending_approval steps", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "succeeded" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const approved = await stepManager.approveAllPending(runId, taskId);
      expect(approved).toEqual([]);
    });
  });

  describe("approveAllPendingForRun", () => {
    it("should approve all pending_approval steps across all tasks in a run", async () => {
      const taskId2 = "test-task-002";

      const steps1: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
        }),
      ];
      const steps2: Step[] = [
        makeStep("s2", taskId2, runId, {
          dependsOn: [],
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
        }),
        makeStep("s3", taskId2, runId, { order: 1, status: "succeeded" }),
      ];

      await stepManager.saveSteps(runId, taskId, steps1);
      await stepManager.saveSteps(runId, taskId2, steps2);

      const approved = await stepManager.approveAllPendingForRun(runId);
      expect(approved).toHaveLength(2);

      const loaded1 = await stepManager.loadSteps(runId, taskId);
      expect(loaded1[0]!.status).toBe("approved");

      const loaded2 = await stepManager.loadSteps(runId, taskId2);
      expect(loaded2[0]!.status).toBe("approved");
      expect(loaded2[1]!.status).toBe("succeeded");
    });
  });

  describe("pause / resume / cancel / skip", () => {
    it("should pause a running step", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "running" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const paused = await stepManager.pauseStep(runId, taskId, "s1");
      expect(paused.status).toBe("paused");
    });

    it("should resume a paused step", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "paused" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const resumed = await stepManager.resumeStep(runId, taskId, "s1");
      expect(resumed.status).toBe("running");
    });

    it("should cancel a pending step", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "pending" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const cancelled = await stepManager.cancelStep(runId, taskId, "s1");
      expect(cancelled.status).toBe("cancelled");
    });

    it("should skip a pending step", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "pending" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const skipped = await stepManager.skipStep(runId, taskId, "s1");
      expect(skipped.status).toBe("skipped");
    });

    it("should enforce valid transitions for pause", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "succeeded" })];
      await stepManager.saveSteps(runId, taskId, steps);

      await expect(stepManager.pauseStep(runId, taskId, "s1")).rejects.toThrow(
        "Invalid state transition",
      );
    });
  });

  describe("retryStep", () => {
    it("should retry a failed step", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "failed",
          retryPolicy: { maxRetries: 3, retryDelayMs: 1000, retryBackoff: "linear" },
        }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const retried = await stepManager.retryStep(runId, taskId, "s1");
      expect(retried.status).toBe("pending");
    });

    it("should throw when max retries exhausted", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "failed",
          retryPolicy: { maxRetries: 1, retryDelayMs: 1000, retryBackoff: "fixed" },
          errors: [
            {
              message: "Failed attempt 1",
              timestamp: makeTimestamp(),
              retryCount: 0,
            },
          ],
        }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      await expect(stepManager.retryStep(runId, taskId, "s1")).rejects.toThrow(
        "exhausted max retries",
      );
    });
  });

  describe("step dependencies", () => {
    it("should report dependency status", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0, status: "succeeded" }),
        makeStep("s2", taskId, runId, { order: 1, status: "pending", dependsOn: ["s1"] }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const depStatus = await stepManager.getDependencyStatus(runId, taskId, "s2");
      expect(depStatus.satisfied).toBe(true);
      expect(depStatus.blocked).toBe(false);
      expect(depStatus.satisfiedStepIds).toContain("s1");
    });

    it("should report blocked when dependency not met", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0, status: "pending" }),
        makeStep("s2", taskId, runId, { order: 1, status: "pending", dependsOn: ["s1"] }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const depStatus = await stepManager.getDependencyStatus(runId, taskId, "s2");
      expect(depStatus.satisfied).toBe(false);
      expect(depStatus.blocked).toBe(true);
      expect(depStatus.pendingStepIds).toContain("s1");
    });

    it("should check canExecute", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0, status: "succeeded" }),
        makeStep("s2", taskId, runId, { order: 1, status: "pending", dependsOn: ["s1"] }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      expect(await stepManager.canExecute(runId, taskId, "s2")).toBe(true);
    });

    it("should report blocked when canExecute false", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0, status: "running" }),
        makeStep("s2", taskId, runId, { order: 1, status: "pending", dependsOn: ["s1"] }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      expect(await stepManager.canExecute(runId, taskId, "s2")).toBe(false);
    });

    it("should return all ready steps", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0, status: "succeeded" }),
        makeStep("s2", taskId, runId, { order: 1, status: "pending", dependsOn: ["s1"] }),
        makeStep("s3", taskId, runId, { order: 2, status: "pending", dependsOn: ["s1"] }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const ready = await stepManager.getReadySteps(runId, taskId);
      expect(ready).toHaveLength(2);
      expect(ready.map((s) => s.id)).toContain("s2");
      expect(ready.map((s) => s.id)).toContain("s3");
    });
  });

  describe("input / output handling", () => {
    it("should mark step as waiting for input", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "running" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const waiting = await stepManager.markStepInputRequired(runId, taskId, "s1");
      expect(waiting.status).toBe("waiting_input");
    });

    it("should provide input and resume step", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "waiting_input" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const resumed = await stepManager.provideStepInput(runId, taskId, "s1", {
        answer: "yes",
      });
      expect(resumed.status).toBe("running");
      expect(resumed.input!.answer).toBe("yes");
    });
  });

  describe("stuck and recovery", () => {
    it("should mark step as stuck", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "running" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const stuck = await stepManager.markStepStuck(runId, taskId, "s1");
      expect(stuck.status).toBe("stuck");
    });

    it("should recover a stuck step", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "stuck" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const recovered = await stepManager.recoverStep(runId, taskId, "s1");
      expect(recovered.status).toBe("running");
    });
  });

  describe("addStep / removeStep", () => {
    it("should add a new step", async () => {
      const step = await stepManager.addStep(runId, taskId, {
        title: "New step",
        command: "echo hello",
      });

      expect(step.id).toBeDefined();
      expect(step.title).toBe("New step");
      expect(step.status).toBe("created");
      expect(step.dependsOn).toEqual([]);
    });

    it("should add a step with dependencies", async () => {
      const step = await stepManager.addStep(runId, taskId, {
        title: "Dep step",
        dependsOn: ["step_prev"],
      });

      expect(step.dependsOn).toEqual(["step_prev"]);
    });

    it("should remove a step", async () => {
      const step = await stepManager.addStep(runId, taskId, { title: "To remove" });
      await stepManager.removeStep(runId, taskId, step.id);

      const loaded = await stepManager.loadSteps(runId, taskId);
      expect(loaded.find((s) => s.id === step.id)).toBeUndefined();
    });

    it("should throw when removing a step that has dependents", async () => {
      const step1 = await stepManager.addStep(runId, taskId, { title: "Parent" });
      await stepManager.addStep(runId, taskId, {
        title: "Child",
        dependsOn: [step1.id],
      });

      await expect(stepManager.removeStep(runId, taskId, step1.id)).rejects.toThrow(
        "step(s) depend on it",
      );
    });
  });

  describe("markStepFailed / markStepSucceeded", () => {
    it("should mark step as failed with error info", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "running" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const failed = await stepManager.markStepFailed(runId, taskId, "s1", {
        message: "Command exited with code 1",
        evidence: "exit code 1",
        suggestedFix: "Check the command syntax",
      });

      expect(failed.status).toBe("failed");
      expect(failed.errors).toHaveLength(1);
      expect(failed.errors![0]!.message).toBe("Command exited with code 1");
    });

    it("should mark step as succeeded with output", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "validating" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const succeeded = await stepManager.markStepSucceeded(runId, taskId, "s1", {
        filesCreated: ["output.txt"],
      });

      expect(succeeded.status).toBe("succeeded");
      expect(succeeded.output!.filesCreated).toEqual(["output.txt"]);
    });
  });

  describe("needs user review", () => {
    it("should mark step as needs user review", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "validating" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const needsReview = await stepManager.setStepAsNeedsReview(runId, taskId, "s1");
      expect(needsReview.status).toBe("needs_user_review");
    });
  });

  describe("step counting and filtering", () => {
    it("should count steps by status", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0, status: "succeeded" }),
        makeStep("s2", taskId, runId, { order: 1, status: "running" }),
        makeStep("s3", taskId, runId, { order: 2, status: "pending" }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const counts = await stepManager.countStepsByStatus(runId, taskId);
      expect(counts.succeeded).toBe(1);
      expect(counts.running).toBe(1);
      expect(counts.pending).toBe(1);
    });

    it("should get steps by status", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0, status: "failed" }),
        makeStep("s2", taskId, runId, { order: 1, status: "failed" }),
        makeStep("s3", taskId, runId, { order: 2, status: "succeeded" }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const failed = await stepManager.getStepsByStatus(runId, taskId, "failed");
      expect(failed).toHaveLength(2);
    });
  });

  describe("duplicate steps", () => {
    it("should duplicate steps to another task", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, { order: 0, command: "echo 1" }),
        makeStep("s2", taskId, runId, { order: 1, command: "echo 2" }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const targetTask = "target-task";
      const duplicated = await stepManager.duplicateSteps(runId, taskId, targetTask);

      expect(duplicated).toHaveLength(2);
      expect(duplicated[0]!.id).not.toBe("s1");
      expect(duplicated[0]!.taskId).toBe(targetTask);
      expect(duplicated[0]!.status).toBe("created");
    });
  });

  describe("reset step", () => {
    it("should reset a failed step back to pending", async () => {
      const step = makeStep("s1", taskId, runId, {
        dependsOn: [],
        order: 0,
        status: "failed",
        exitCode: 1,
        errors: [{ message: "Error", timestamp: makeTimestamp(), retryCount: 0 }],
        startedAt: makeTimestamp(),
        finishedAt: makeTimestamp(),
      });
      await stepManager.saveSteps(runId, taskId, [step]);

      const reset = await stepManager.resetStep(runId, taskId, "s1");
      expect(reset.status).toBe("pending");
      expect(reset.exitCode).toBeUndefined();
      expect(reset.errors).toEqual([]);
    });
  });

  describe("loadAllSteps", () => {
    it("should load all steps for a run grouped by task", async () => {
      const taskId2 = "test-task-002";

      await stepManager.saveSteps(runId, taskId, [makeStep("s1", taskId, runId, { order: 0 })]);
      await stepManager.saveSteps(runId, taskId2, [makeStep("s2", taskId2, runId, { order: 0 })]);

      const allSteps = await stepManager.loadAllSteps(runId);
      expect(Object.keys(allSteps)).toHaveLength(2);
      expect(allSteps[taskId]).toHaveLength(1);
      expect(allSteps[taskId2]).toHaveLength(1);
    });

    it("should return empty object when no steps exist", async () => {
      const allSteps = await stepManager.loadAllSteps("nonexistent-run");
      expect(allSteps).toEqual({});
    });
  });

  describe("edge cases", () => {
    it("should handle steps with approvalReason", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
          approvalReason: "This command modifies production data",
        }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const loaded = await stepManager.loadSteps(runId, taskId);
      expect(loaded[0]!.approvalReason).toBe("This command modifies production data");
    });

    it("should handle steps with exit code and output", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          dependsOn: [],
          order: 0,
          status: "succeeded",
          exitCode: 0,
          command: "echo hello",
        }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const loaded = await stepManager.loadSteps(runId, taskId);
      expect(loaded[0]!.exitCode).toBe(0);
      expect(loaded[0]!.command).toBe("echo hello");
    });

    it("should handle multiple tasks with overlapping step IDs", async () => {
      const taskId2 = "test-task-002";

      await stepManager.saveSteps(runId, taskId, [makeStep("s1", taskId, runId, { order: 0 })]);
      await stepManager.saveSteps(runId, taskId2, [makeStep("s1", taskId2, runId, { order: 0 })]);

      const steps1 = await stepManager.loadSteps(runId, taskId);
      const steps2 = await stepManager.loadSteps(runId, taskId2);
      expect(steps1[0]!.taskId).toBe(taskId);
      expect(steps2[0]!.taskId).toBe(taskId2);
    });
  });
});
