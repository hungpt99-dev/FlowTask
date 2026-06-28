import { describe, it, expect } from "vitest";
import {
  StepSchema,
  StepStatusSchema,
  StepTypeSchema,
  StepsFileSchema,
} from "../../src/schemas/step.schema.js";

describe("StepSchema", () => {
  const validStep = {
    id: "step_001",
    taskId: "task_001",
    runId: "run_001",
    title: "Install dependency",
    type: "shell",
    command: "pnpm add dep",
    status: "pending",
    requiresApproval: true,
    approvalReason: "Adding new dependency",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("should validate a correct step", () => {
    const result = StepSchema.safeParse(validStep);
    expect(result.success).toBe(true);
  });

  it("should apply defaults for optional fields", () => {
    const minimal = {
      id: "step_002",
      taskId: "task_001",
      runId: "run_001",
      title: "Read file",
      status: "pending",
      order: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = StepSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    expect(result.data!.type).toBe("command");
    expect(result.data!.requiresApproval).toBe(false);
  });

  it("should accept step with expectedResult", () => {
    const result = StepSchema.safeParse({
      ...validStep,
      expectedResult: "Dependency is installed and confirmed via version check",
    });
    expect(result.success).toBe(true);
    expect(result.data!.expectedResult).toBe(
      "Dependency is installed and confirmed via version check",
    );
  });

  it("should reject step with empty id", () => {
    const result = StepSchema.safeParse({ ...validStep, id: "" });
    expect(result.success).toBe(false);
  });

  it("should reject step with invalid status", () => {
    const result = StepSchema.safeParse({ ...validStep, status: "invalid_status" });
    expect(result.success).toBe(false);
  });

  it("should reject step with invalid type", () => {
    const result = StepSchema.safeParse({ ...validStep, type: "invalid_type" });
    expect(result.success).toBe(false);
  });

  it("should accept all valid statuses", () => {
    const statuses = [
      "pending",
      "pending_approval",
      "approved",
      "denied",
      "running",
      "done",
      "failed",
      "cancelled",
      "interrupted",
    ];
    for (const status of statuses) {
      const result = StepSchema.safeParse({ ...validStep, status });
      expect(result.success).toBe(true);
    }
  });

  it("should accept all valid types", () => {
    const types = ["command", "read", "write", "edit", "shell", "approval"];
    for (const type of types) {
      const result = StepSchema.safeParse({ ...validStep, type });
      expect(result.success).toBe(true);
    }
  });

  it("should validate steps file format", () => {
    const stepsFile = {
      runId: "run_001",
      stepsByTask: {
        task_001: [validStep],
        task_002: [
          {
            ...validStep,
            id: "step_002",
            taskId: "task_002",
            title: "Another step",
            order: 0,
          },
        ],
      },
    };
    const result = StepsFileSchema.safeParse(stepsFile);
    expect(result.success).toBe(true);
  });
});

describe("StepStatusSchema", () => {
  it("should have correct enum values", () => {
    const values = StepStatusSchema.options;
    expect(values).toContain("pending");
    expect(values).toContain("pending_approval");
    expect(values).toContain("approved");
    expect(values).toContain("denied");
    expect(values).toContain("running");
    expect(values).toContain("done");
    expect(values).toContain("failed");
  });
});

describe("StepTypeSchema", () => {
  it("should have correct enum values", () => {
    const values = StepTypeSchema.options;
    expect(values).toContain("command");
    expect(values).toContain("read");
    expect(values).toContain("write");
    expect(values).toContain("edit");
    expect(values).toContain("shell");
    expect(values).toContain("approval");
  });
});
