import { describe, it, expect } from "vitest";
import {
  StepSchema,
  StepStatusSchema,
  StepTypeSchema,
  StepsFileSchema,
  RetryPolicySchema,
  TimeoutPolicySchema,
  StepErrorSchema,
  isValidStepTransition,
  isStepTerminal,
  isStepActive,
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
    dependsOn: [],
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
      dependsOn: [],
      order: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = StepSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    expect(result.data!.type).toBe("command");
    expect(result.data!.requiresApproval).toBe(false);
    expect(result.data!.dependsOn).toEqual([]);
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

  it("should accept step with retry policy", () => {
    const result = StepSchema.safeParse({
      ...validStep,
      retryPolicy: { maxRetries: 3, retryDelayMs: 2000, retryBackoff: "exponential" },
    });
    expect(result.success).toBe(true);
    expect(result.data!.retryPolicy!.maxRetries).toBe(3);
    expect(result.data!.retryPolicy!.retryBackoff).toBe("exponential");
  });

  it("should accept step with timeout policy", () => {
    const result = StepSchema.safeParse({
      ...validStep,
      timeout: { durationMs: 30000, action: "fail" },
    });
    expect(result.success).toBe(true);
    expect(result.data!.timeout!.durationMs).toBe(30000);
  });

  it("should accept step with dependsOn", () => {
    const result = StepSchema.safeParse({
      ...validStep,
      dependsOn: ["step_prev"],
    });
    expect(result.success).toBe(true);
    expect(result.data!.dependsOn).toEqual(["step_prev"]);
  });

  it("should accept step with errors", () => {
    const result = StepSchema.safeParse({
      ...validStep,
      errors: [
        {
          message: "Command failed",
          timestamp: new Date().toISOString(),
          retryCount: 0,
          evidence: "exit code 1",
          suggestedFix: "Check permissions",
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.errors).toHaveLength(1);
    expect(result.data!.errors![0]!.message).toBe("Command failed");
  });

  it("should accept step with condition", () => {
    const result = StepSchema.safeParse({
      ...validStep,
      condition: "previousStep.status === 'succeeded'",
    });
    expect(result.success).toBe(true);
    expect(result.data!.condition).toBe("previousStep.status === 'succeeded'");
  });

  it("should accept step with input/output", () => {
    const result = StepSchema.safeParse({
      ...validStep,
      input: { file: "test.txt", mode: "read" },
      expectedOutput: { filesCreated: ["test.txt"] },
    });
    expect(result.success).toBe(true);
    expect(result.data!.input!.file).toBe("test.txt");
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

  it("should accept all valid statuses including new states", () => {
    const statuses = [
      "created",
      "pending",
      "running",
      "waiting_approval",
      "waiting_input",
      "waiting_dependency",
      "validating",
      "retrying",
      "paused",
      "succeeded",
      "failed",
      "skipped",
      "cancelled",
      "stuck",
      "needs_user_review",
      "pending_approval",
      "approved",
      "denied",
      "done",
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
            dependsOn: [],
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
  it("should include new states", () => {
    const values = StepStatusSchema.options;
    expect(values).toContain("created");
    expect(values).toContain("waiting_input");
    expect(values).toContain("waiting_dependency");
    expect(values).toContain("validating");
    expect(values).toContain("retrying");
    expect(values).toContain("paused");
    expect(values).toContain("succeeded");
    expect(values).toContain("stuck");
    expect(values).toContain("needs_user_review");
    expect(values).toContain("pending");
    expect(values).toContain("pending_approval");
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

describe("RetryPolicySchema", () => {
  it("should apply defaults", () => {
    const result = RetryPolicySchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data!.maxRetries).toBe(2);
    expect(result.data!.retryDelayMs).toBe(1000);
    expect(result.data!.retryBackoff).toBe("linear");
  });

  it("should accept full config", () => {
    const result = RetryPolicySchema.safeParse({
      maxRetries: 5,
      retryDelayMs: 5000,
      retryBackoff: "exponential",
    });
    expect(result.success).toBe(true);
    expect(result.data!.maxRetries).toBe(5);
  });
});

describe("TimeoutPolicySchema", () => {
  it("should apply default action", () => {
    const result = TimeoutPolicySchema.safeParse({ durationMs: 10000 });
    expect(result.success).toBe(true);
    expect(result.data!.action).toBe("fail");
  });
});

describe("StepErrorSchema", () => {
  it("should validate a correct step error", () => {
    const result = StepErrorSchema.safeParse({
      message: "Command failed with exit code 1",
      timestamp: new Date().toISOString(),
      retryCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("should accept optional fields", () => {
    const result = StepErrorSchema.safeParse({
      message: "Failed",
      timestamp: new Date().toISOString(),
      retryCount: 2,
      evidence: "exit code 1",
      suggestedFix: "Check input",
    });
    expect(result.success).toBe(true);
    expect(result.data!.evidence).toBe("exit code 1");
  });
});

describe("isValidStepTransition", () => {
  it("should allow valid transitions", () => {
    expect(isValidStepTransition("created", "pending")).toBe(true);
    expect(isValidStepTransition("pending", "running")).toBe(true);
    expect(isValidStepTransition("running", "succeeded")).toBe(true);
    expect(isValidStepTransition("running", "failed")).toBe(true);
    expect(isValidStepTransition("running", "paused")).toBe(true);
    expect(isValidStepTransition("paused", "running")).toBe(true);
    expect(isValidStepTransition("running", "cancelled")).toBe(true);
    expect(isValidStepTransition("failed", "pending")).toBe(true);
    expect(isValidStepTransition("failed", "retrying")).toBe(true);
  });

  it("should reject invalid transitions", () => {
    expect(isValidStepTransition("created", "succeeded")).toBe(false);
    expect(isValidStepTransition("succeeded", "running")).toBe(false);
    expect(isValidStepTransition("cancelled", "running")).toBe(false);
    expect(isValidStepTransition("skipped", "running")).toBe(false);
  });
});

describe("isStepTerminal", () => {
  it("should identify terminal states", () => {
    expect(isStepTerminal("succeeded")).toBe(true);
    expect(isStepTerminal("done")).toBe(true);
    expect(isStepTerminal("failed")).toBe(true);
    expect(isStepTerminal("skipped")).toBe(true);
    expect(isStepTerminal("cancelled")).toBe(true);
  });

  it("should reject non-terminal states", () => {
    expect(isStepTerminal("running")).toBe(false);
    expect(isStepTerminal("pending")).toBe(false);
    expect(isStepTerminal("paused")).toBe(false);
  });
});

describe("isStepActive", () => {
  it("should identify active states", () => {
    expect(isStepActive("running")).toBe(true);
    expect(isStepActive("waiting_approval")).toBe(true);
    expect(isStepActive("validating")).toBe(true);
    expect(isStepActive("needs_user_review")).toBe(true);
  });

  it("should reject inactive states", () => {
    expect(isStepActive("pending")).toBe(false);
    expect(isStepActive("succeeded")).toBe(false);
    expect(isStepActive("paused")).toBe(false);
  });
});
