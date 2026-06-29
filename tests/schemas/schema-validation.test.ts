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

  it("should validate a task with validation config", () => {
    const result = ValidationConfigSchema.safeParse({
      commands: ["pnpm test"],
      requireGitDiff: true,
    });
    expect(result.success).toBe(true);
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
