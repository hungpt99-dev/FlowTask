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

    it("should reject invalid updates via schema validation", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0 })];
      await stepManager.saveSteps(runId, taskId, steps);

      await expect(
        stepManager.updateStep(runId, taskId, "s1", { status: "invalid_status" as never }),
      ).rejects.toThrow();
    });
  });

  describe("updateStepStatus", () => {
    it("should update step status", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "pending" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const updated = await stepManager.updateStepStatus(runId, taskId, "s1", "running");
      expect(updated.status).toBe("running");
    });

    it("should transition through multiple statuses", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "pending" })];
      await stepManager.saveSteps(runId, taskId, steps);

      await stepManager.updateStepStatus(runId, taskId, "s1", "running");
      await stepManager.updateStepStatus(runId, taskId, "s1", "done");

      const step = await stepManager.getStep(runId, taskId, "s1");
      expect(step!.status).toBe("done");
    });
  });

  describe("approveStep / denyStep", () => {
    it("should approve a step", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
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

    it("should deny a step", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
        }),
      ];
      await stepManager.saveSteps(runId, taskId, steps);

      const denied = await stepManager.denyStep(runId, taskId, "s1");
      expect(denied.status).toBe("denied");
    });
  });

  describe("approveAllPending", () => {
    it("should approve all pending_approval steps for a task", async () => {
      const steps: Step[] = [
        makeStep("s1", taskId, runId, {
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
        }),
        makeStep("s2", taskId, runId, {
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
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "done" })];
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
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
        }),
      ];
      const steps2: Step[] = [
        makeStep("s2", taskId2, runId, {
          order: 0,
          status: "pending_approval",
          requiresApproval: true,
        }),
        makeStep("s3", taskId2, runId, { order: 1, status: "done" }),
      ];

      await stepManager.saveSteps(runId, taskId, steps1);
      await stepManager.saveSteps(runId, taskId2, steps2);

      const approved = await stepManager.approveAllPendingForRun(runId);
      expect(approved).toHaveLength(2);

      const loaded1 = await stepManager.loadSteps(runId, taskId);
      expect(loaded1[0]!.status).toBe("approved");

      const loaded2 = await stepManager.loadSteps(runId, taskId2);
      expect(loaded2[0]!.status).toBe("approved");
      expect(loaded2[1]!.status).toBe("done");
    });

    it("should return empty array when no pending_approval steps in run", async () => {
      const steps: Step[] = [makeStep("s1", taskId, runId, { order: 0, status: "done" })];
      await stepManager.saveSteps(runId, taskId, steps);

      const approved = await stepManager.approveAllPendingForRun(runId);
      expect(approved).toEqual([]);
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
          order: 0,
          status: "done",
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
      await stepManager.saveSteps(runId, taskId2, [
        makeStep("s1", taskId2, runId, { order: 0 }), // same ID, different task
      ]);

      const steps1 = await stepManager.loadSteps(runId, taskId);
      const steps2 = await stepManager.loadSteps(runId, taskId2);
      expect(steps1[0]!.taskId).toBe(taskId);
      expect(steps2[0]!.taskId).toBe(taskId2);
    });
  });
});
