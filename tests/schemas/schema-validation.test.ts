import { describe, it, expect } from "vitest";
import { ProjectSchema } from "../../src/schemas/project.schema.js";
import { RunSchema } from "../../src/schemas/run.schema.js";
import { TaskSchema, ValidationConfigSchema } from "../../src/schemas/task.schema.js";
import { FlowTaskConfigSchema } from "../../src/schemas/config.schema.js";
import { FlowTaskEventSchema } from "../../src/schemas/event.schema.js";
import { ValidationResultSchema } from "../../src/schemas/validation.schema.js";
import {
  AiPlannerTaskSchema,
  PlannerTaskValidationSchema,
} from "../../src/schemas/planner.schema.js";
import {
  WorkflowTaskSchema,
  WorkflowValidationConfigSchema,
} from "../../src/schemas/workflow.schema.js";

describe("Schema validation", () => {
  it("should validate a correct project", () => {
    const result = ProjectSchema.safeParse({
      projectId: "test-project",
      name: "Test",
      rootPath: "/tmp/test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("should reject project with empty ID", () => {
    const result = ProjectSchema.safeParse({
      projectId: "",
      name: "Test",
      rootPath: "/tmp/test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("should validate a correct run", () => {
    const result = RunSchema.safeParse({
      runId: "run_001",
      projectId: "test",
      title: "Test run",
      status: "running",
      mode: "auto",
      taskCount: 5,
      completedTaskCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("should validate a correct task", () => {
    const result = TaskSchema.safeParse({
      id: "task_001",
      runId: "run_001",
      title: "Do something",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: [],
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("should validate a task with skipValidation set to true", () => {
    const result = TaskSchema.safeParse({
      id: "task_001",
      runId: "run_001",
      title: "Skip validation task",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: [],
      retryCount: 0,
      maxRetries: 2,
      skipValidation: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect(result.data!.skipValidation).toBe(true);
  });

  it("should accept skipValidation as undefined by default", () => {
    const result = TaskSchema.safeParse({
      id: "task_002",
      runId: "run_001",
      title: "Normal task",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: [],
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect(result.data!.skipValidation).toBeUndefined();
  });

  it("should validate a task with validation config", () => {
    const result = ValidationConfigSchema.safeParse({
      commands: ["pnpm test"],
      requireGitDiff: true,
    });
    expect(result.success).toBe(true);
  });

  it("should accept skipValidation in FlowTaskConfigSchema validation config", () => {
    const result = FlowTaskConfigSchema.safeParse({
      validation: { skipValidation: true },
    });
    expect(result.success).toBe(true);
    expect(result.data!.validation.skipValidation).toBe(true);
  });

  it("should have skipValidation optional in FlowTaskConfigSchema", () => {
    const result = FlowTaskConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data!.validation.skipValidation).toBeUndefined();
  });

  it("should validate a correct event", () => {
    const result = FlowTaskEventSchema.safeParse({
      time: new Date().toISOString(),
      type: "run_created",
      runId: "run_001",
      message: "Run created",
    });
    expect(result.success).toBe(true);
  });

  it("should not include requiredFiles when parsing a task", () => {
    const result = TaskSchema.safeParse({
      id: "task_001",
      runId: "run_001",
      title: "Bad task",
      status: "pending",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: [],
      retryCount: 0,
      maxRetries: 2,
      validation: { requiredFiles: ["src/output.txt"] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect((result.data!.validation as Record<string, unknown>).requiredFiles).toBeUndefined();
  });

  it("should not include requiredContent when parsing validation config", () => {
    const result = ValidationConfigSchema.safeParse({
      requiredContent: ["src/output.txt"],
    });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).requiredContent).toBeUndefined();
  });

  it("should accept validation config with only outcome-based fields", () => {
    const result = ValidationConfigSchema.safeParse({
      commands: ["pnpm test"],
      requiredArtifacts: ["report.md"],
      requireGitDiff: true,
    });
    expect(result.success).toBe(true);
  });

  it("should strip requiredFiles from WorkflowTaskSchema", () => {
    const result = WorkflowTaskSchema.safeParse({
      id: "task_001",
      title: "Test task",
      validation: { requiredFiles: ["src/output.txt"] },
    });
    expect(result.success).toBe(true);
    expect((result.data!.validation as Record<string, unknown>).requiredFiles).toBeUndefined();
  });

  it("should strip requiredContent from WorkflowValidationConfigSchema", () => {
    const result = WorkflowValidationConfigSchema.safeParse({
      requiredContent: ["src/output.txt"],
    });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).requiredContent).toBeUndefined();
  });

  it("should validate AiPlannerTaskSchema with all structured step metadata fields", () => {
    const result = AiPlannerTaskSchema.safeParse({
      title: "Implement feature",
      description: "Detailed implementation plan",
      executor: "shell",
      acceptanceCriteria: ["Feature works"],
      taskType: "coding",
      actionType: "create",
      inputContext: "Previous step context",
      targetFiles: ["src/main.ts"],
      targetArtifacts: ["report.md"],
      evidence: ["File exists", "Tests pass"],
      verificationCommand: "pnpm test",
      approvalRequired: true,
      retryPolicy: { maxRetries: 3, retryDelayMs: 2000, retryBackoff: "exponential" },
      timeout: { durationMs: 120000, action: "retry" },
      finalOutputContribution: "Core module for the feature",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taskType).toBe("coding");
      expect(result.data.actionType).toBe("create");
      expect(result.data.targetFiles).toContain("src/main.ts");
      expect(result.data.approvalRequired).toBe(true);
      expect(result.data.evidence).toHaveLength(2);
      expect(result.data.retryPolicy?.maxRetries).toBe(3);
      expect(result.data.timeout?.durationMs).toBe(120000);
      expect(result.data.finalOutputContribution).toBe("Core module for the feature");
    }
  });

  it("should use defaults for optional structured step metadata fields", () => {
    const result = AiPlannerTaskSchema.safeParse({
      title: "Minimal task",
      description: "Minimal description",
      executor: "shell",
      acceptanceCriteria: ["Done"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taskType).toBe("general");
      expect(result.data.actionType).toBe("execute");
      expect(result.data.targetFiles).toEqual([]);
      expect(result.data.approvalRequired).toBe(false);
    }
  });

  it("should strip requiredFiles from AiPlannerTaskSchema", () => {
    const result = AiPlannerTaskSchema.safeParse({
      title: "Test task",
      description: "Test description",
      executor: "shell",
      acceptanceCriteria: ["Done"],
      validation: { requiredFiles: ["src/output.txt"] },
    });
    expect(result.success).toBe(true);
    expect((result.data!.validation as Record<string, unknown>).requiredFiles).toBeUndefined();
  });

  it("should strip requiredContent from PlannerTaskValidationSchema", () => {
    const result = PlannerTaskValidationSchema.safeParse({
      requiredContent: ["src/output.txt"],
    });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).requiredContent).toBeUndefined();
  });

  it("should validate a validation result", () => {
    const result = ValidationResultSchema.safeParse({
      taskId: "task_001",
      status: "passed",
      checks: [
        {
          type: "process",
          status: "passed",
          exitCode: 0,
          message: "All good",
        },
      ],
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("should apply defaults to FlowTaskConfig", () => {
    const result = FlowTaskConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data!.version).toBe("1.0");
    expect(result.data!.defaultExecutor).toBe("opencode");
    expect(result.data!.rules.enabled).toBe(true);
  });
});
