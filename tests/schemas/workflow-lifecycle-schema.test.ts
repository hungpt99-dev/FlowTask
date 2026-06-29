import { describe, it, expect } from "vitest";
import {
  WorkflowStatusSchema,
  WorkflowStateSchema,
  WorkflowLifecycleEventSchema,
  isValidWorkflowTransition,
  isWorkflowTerminal,
  isWorkflowActive,
} from "../../src/schemas/workflow-lifecycle.schema.js";

describe("WorkflowStatusSchema", () => {
  it("should include all required states", () => {
    const values = WorkflowStatusSchema.options;
    expect(values).toContain("created");
    expect(values).toContain("scanning");
    expect(values).toContain("planning");
    expect(values).toContain("planned");
    expect(values).toContain("waiting_plan_approval");
    expect(values).toContain("approved");
    expect(values).toContain("ready");
    expect(values).toContain("running");
    expect(values).toContain("waiting_approval");
    expect(values).toContain("waiting_input");
    expect(values).toContain("waiting_dependency");
    expect(values).toContain("validating");
    expect(values).toContain("retrying");
    expect(values).toContain("paused");
    expect(values).toContain("succeeded");
    expect(values).toContain("failed");
    expect(values).toContain("skipped");
    expect(values).toContain("cancelled");
    expect(values).toContain("stuck");
    expect(values).toContain("needs_user_review");
    expect(values).toContain("partially_completed");
    expect(values).toContain("rollback_required");
    expect(values).toContain("rolled_back");
  });

  it("should have 23 states", () => {
    expect(WorkflowStatusSchema.options).toHaveLength(23);
  });
});

describe("WorkflowStateSchema", () => {
  it("should validate a correct workflow state", () => {
    const result = WorkflowStateSchema.safeParse({
      runId: "run_001",
      status: "created",
      retryCount: 0,
      errorCount: 0,
      lifecycle: [
        {
          type: "workflow_created",
          timestamp: new Date().toISOString(),
          workflowStatus: "created",
          message: "Workflow created",
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("should apply defaults", () => {
    const result = WorkflowStateSchema.safeParse({
      runId: "run_001",
      status: "running",
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect(result.data!.retryCount).toBe(0);
    expect(result.data!.errorCount).toBe(0);
    expect(result.data!.lifecycle).toEqual([]);
  });

  it("should accept full workflow state", () => {
    const result = WorkflowStateSchema.safeParse({
      runId: "run_001",
      status: "running",
      previousStatus: "ready",
      currentStepId: "step_001",
      checkpointId: "chk_001",
      retryCount: 2,
      errorCount: 1,
      startedAt: new Date().toISOString(),
      lifecycle: [
        {
          type: "state_transition",
          timestamp: new Date().toISOString(),
          workflowStatus: "running",
          message: "State transition",
        },
      ],
      metadata: { key: "value" },
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect(result.data!.retryCount).toBe(2);
    expect(result.data!.metadata!.key).toBe("value");
  });

  it("should reject invalid status", () => {
    const result = WorkflowStateSchema.safeParse({
      runId: "run_001",
      status: "invalid_status",
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe("WorkflowLifecycleEventSchema", () => {
  it("should validate a correct lifecycle event", () => {
    const result = WorkflowLifecycleEventSchema.safeParse({
      type: "state_transition",
      timestamp: new Date().toISOString(),
      workflowStatus: "running",
      message: "Workflow started",
      details: { previousStatus: "ready" },
    });
    expect(result.success).toBe(true);
  });

  it("should accept event with stepId", () => {
    const result = WorkflowLifecycleEventSchema.safeParse({
      type: "step_started",
      timestamp: new Date().toISOString(),
      workflowStatus: "running",
      stepId: "step_001",
    });
    expect(result.success).toBe(true);
    expect(result.data!.stepId).toBe("step_001");
  });
});

describe("isValidWorkflowTransition", () => {
  it("should allow valid transitions from created", () => {
    expect(isValidWorkflowTransition("created", "scanning")).toBe(true);
    expect(isValidWorkflowTransition("created", "cancelled")).toBe(true);
  });

  it("should allow transition through lifecycle", () => {
    expect(isValidWorkflowTransition("created", "scanning")).toBe(true);
    expect(isValidWorkflowTransition("scanning", "planning")).toBe(true);
    expect(isValidWorkflowTransition("planning", "planned")).toBe(true);
    expect(isValidWorkflowTransition("planned", "ready")).toBe(true);
    expect(isValidWorkflowTransition("ready", "running")).toBe(true);
    expect(isValidWorkflowTransition("running", "succeeded")).toBe(true);
  });

  it("should allow pause and resume", () => {
    expect(isValidWorkflowTransition("running", "paused")).toBe(true);
    expect(isValidWorkflowTransition("paused", "running")).toBe(true);
  });

  it("should allow retry after failure", () => {
    expect(isValidWorkflowTransition("failed", "retrying")).toBe(true);
    expect(isValidWorkflowTransition("retrying", "running")).toBe(true);
  });

  it("should reject invalid transitions", () => {
    expect(isValidWorkflowTransition("created", "succeeded")).toBe(false);
    expect(isValidWorkflowTransition("succeeded", "running")).toBe(false);
    expect(isValidWorkflowTransition("cancelled", "running")).toBe(false);
    expect(isValidWorkflowTransition("skipped", "running")).toBe(false);
    expect(isValidWorkflowTransition("running", "created")).toBe(false);
  });

  it("should allow rollback", () => {
    expect(isValidWorkflowTransition("failed", "rollback_required")).toBe(true);
    expect(isValidWorkflowTransition("rollback_required", "rolled_back")).toBe(true);
    expect(isValidWorkflowTransition("partially_completed", "rollback_required")).toBe(true);
  });
});

describe("isWorkflowTerminal", () => {
  it("should identify terminal states", () => {
    expect(isWorkflowTerminal("succeeded")).toBe(true);
    expect(isWorkflowTerminal("failed")).toBe(true);
    expect(isWorkflowTerminal("skipped")).toBe(true);
    expect(isWorkflowTerminal("cancelled")).toBe(true);
    expect(isWorkflowTerminal("rolled_back")).toBe(true);
  });

  it("should reject non-terminal states", () => {
    expect(isWorkflowTerminal("running")).toBe(false);
    expect(isWorkflowTerminal("paused")).toBe(false);
    expect(isWorkflowTerminal("planning")).toBe(false);
  });
});

describe("isWorkflowActive", () => {
  it("should identify active states", () => {
    expect(isWorkflowActive("running")).toBe(true);
    expect(isWorkflowActive("scanning")).toBe(true);
    expect(isWorkflowActive("planning")).toBe(true);
    expect(isWorkflowActive("waiting_approval")).toBe(true);
    expect(isWorkflowActive("validating")).toBe(true);
    expect(isWorkflowActive("retrying")).toBe(true);
  });

  it("should reject inactive states", () => {
    expect(isWorkflowActive("paused")).toBe(false);
    expect(isWorkflowActive("succeeded")).toBe(false);
    expect(isWorkflowActive("cancelled")).toBe(false);
    expect(isWorkflowActive("created")).toBe(false);
  });
});
