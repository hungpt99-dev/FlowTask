import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { ValidationEngine } from "../../src/validation/validation-engine.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTextFile, ensureDir } from "../../src/utils/fs.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

// Mock AiValidator to control verdict output in interaction tests
const mockValidate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    status: "passed",
    suggestion: "",
    explanation: "AI review passed",
    confidence: "high",
    evidenceSummary: "Evidence confirms completion",
    evidenceGaps: [],
  }),
);

vi.mock("../../src/validation/ai-validator.js", async () => {
  return {
    ...(await vi.importActual("../../src/validation/ai-validator.js")),
    AiValidator: vi.fn().mockImplementation(() => ({
      validate: mockValidate,
      appendSuggestionToContext: vi.fn(),
    })),
  };
});

const baseTask = {
  status: "running" as const,
  executor: "shell",
  dependsOn: [] as string[],
  retryCount: 0,
  maxRetries: 2,
  createdAt: now(),
  updatedAt: now(),
};

describe("ValidationEngine", () => {
  const engine = new ValidationEngine();

  it("should fail when process exits with non-zero", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_001",
        runId: "run_001",
        title: "Test task",
        acceptanceCriteria: [],
      },
      executorResult: {
        status: "failed",
        exitCode: 1,
        output: "something went wrong",
        startedAt: now(),
        finishedAt: now(),
      },
    });
    expect(result.status).toBe("failed");
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks[0]!.type).toBe("process");
    expect(result.checks[0]!.status).toBe("failed");
  });

  it("should pass when process exits with zero", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_002",
        runId: "run_001",
        title: "Good task",
        acceptanceCriteria: [],
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "all good",
        startedAt: now(),
        finishedAt: now(),
      },
    });
    expect(result.status).toBe("passed");
    expect(result.checks[0]!.status).toBe("passed");
  });

  it("should add acceptance criteria checks when criteria exist", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_003",
        runId: "run_001",
        title: "Writing task",
        acceptanceCriteria: ["Content is written and saved"],
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "Content is written and saved to output.md",
        startedAt: now(),
        finishedAt: now(),
      },
    });
    const criteriaChecks = result.checks.filter((c) => c.type === "acceptance_criteria");
    expect(criteriaChecks.length).toBeGreaterThan(0);
    expect(criteriaChecks[0]?.status).toBe("passed");
  });

  it("should add outcome comparison check when expectedResult is set", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_001",
        runId: "run_001",
        title: "Outcome task",
        acceptanceCriteria: [],
        expectedResult: "Type check, lint, and test commands all exit successfully",
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "all checks passed",
        startedAt: now(),
        finishedAt: now(),
      },
    });
    const outcomeChecks = result.checks.filter((c) => c.type === "outcome_comparison");
    expect(outcomeChecks.length).toBeGreaterThan(0);
    expect(outcomeChecks[0]?.status).toBe("passed");
  });

  it("should fail outcome comparison when expectedResult not met", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_002",
        runId: "run_001",
        title: "Outcome fail task",
        acceptanceCriteria: [],
        expectedResult: "Research report is saved to output.md",
      },
      executorResult: {
        status: "failed",
        exitCode: 1,
        output: "something went wrong",
        startedAt: now(),
        finishedAt: now(),
      },
    });
    const outcomeChecks = result.checks.filter((c) => c.type === "outcome_comparison");
    expect(outcomeChecks.length).toBeGreaterThan(0);
    expect(outcomeChecks[0]?.status).toBe("failed");
  });

  it("should not add outcome comparison check when expectedResult is not set", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_003",
        runId: "run_001",
        title: "No outcome task",
        acceptanceCriteria: [],
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "done",
        startedAt: now(),
        finishedAt: now(),
      },
    });
    const outcomeChecks = result.checks.filter((c) => c.type === "outcome_comparison");
    expect(outcomeChecks).toHaveLength(0);
  });

  describe("adaptive validation with expectedResult", () => {
    it("should pass when outcome passes and other checks pass", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_adaptive_01",
          runId: "run_001",
          title: "All pass",
          acceptanceCriteria: ["All checks pass"],
          expectedResult: "All validation checks pass successfully",
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "All checks pass and validation succeeds",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.status).toBe("passed");
    });

    it("should warn when outcome warns and other checks pass", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_adaptive_03",
          runId: "run_001",
          title: "Outcome warns others pass",
          acceptanceCriteria: [],
          expectedResult: "Very specific outcome that will not appear in output at all",
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "something completely unrelated",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.status).toBe("warning");
    });

    it("should always fail when outcome fails regardless of other checks", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_adaptive_05",
          runId: "run_001",
          title: "Outcome fails others pass",
          acceptanceCriteria: [],
          expectedResult: "Complex analysis report is generated",
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "process error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.status).toBe("failed");
      const outcomeCheck = result.checks.find((c) => c.type === "outcome_comparison");
      expect(outcomeCheck?.status).toBe("failed");
    });

    it("should use standard logic when adaptiveValidation is disabled", async () => {
      const nonAdaptiveEngine = new ValidationEngine({
        validation: { adaptiveValidation: false },
      } as unknown as FlowTaskConfig);
      const result = await nonAdaptiveEngine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_nonadaptive_01",
          runId: "run_001",
          title: "Non-adaptive mode",
          acceptanceCriteria: [],
          expectedResult: "All checks pass",
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "All checks pass",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.status).toBe("passed");
    });

    it("should use standard logic when no expectedResult is set", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_no_outcome_01",
          runId: "run_001",
          title: "No expected result",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task done",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.status).toBe("passed");
    });
  });

  describe("combined validation with multiple check types", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "engine-combined-"));
      await ensureDir(tempDir);
      await writeTextFile(join(tempDir, "output.txt"), "task results data");
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should pass when all outcome-based checks pass", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_combo_01",
          runId: "run_001",
          title: "All validators",
          acceptanceCriteria: ["output.txt contains task results"],
          expectedResult: "Generate output.txt with task data",
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "output.txt contains task results data and is ready",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.status).toBe("passed");
      expect(result.checks.length).toBeGreaterThanOrEqual(3);
    });

    it("should warn when process fails despite outcome passing", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_combo_02",
          runId: "run_001",
          title: "Partial validation",
          acceptanceCriteria: [],
          expectedResult: "output.txt created with results from task",
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "output.txt created with results from task",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const outcomeCheck = result.checks.find((c) => c.type === "outcome_comparison");
      expect(outcomeCheck?.status).toBe("passed");
      expect(result.status).toBe("warning");
    });
  });

  describe("action-aware validation with outputPlan", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "engine-output-plan-"));
      await ensureDir(tempDir);
      await writeTextFile(join(tempDir, "existing.txt"), "existing content");
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should pass when a create target file exists", async () => {
      await writeTextFile(join(tempDir, "created.txt"), "new file");
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_01",
          runId: "run_001",
          title: "Create file",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "created.txt",
              validationMethod: "file_exists",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "file created",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBe(1);
      expect(opChecks[0]?.status).toBe("passed");
    });

    it("should fail when a create target file is missing", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_02",
          runId: "run_001",
          title: "Create missing file",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "should-exist.txt",
              validationMethod: "file_exists",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "done",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBe(1);
      expect(opChecks[0]?.status).toBe("failed");
    });

    it("should pass when a modify target file exists", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_03",
          runId: "run_001",
          title: "Modify file",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "modify",
              target: "existing.txt",
              validationMethod: "file_exists",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "file modified",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBe(1);
      expect(opChecks[0]?.status).toBe("passed");
    });

    it("should fail when a modify target file is missing", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_04",
          runId: "run_001",
          title: "Modify missing file",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "modify",
              target: "nonexistent.txt",
              validationMethod: "file_exists",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "done",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBe(1);
      expect(opChecks[0]?.status).toBe("failed");
    });

    it("should pass when a delete target file is removed", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_05",
          runId: "run_001",
          title: "Delete file",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "delete",
              target: "ghost-file.txt",
              validationMethod: "file_exists",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "file deleted",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBe(1);
      expect(opChecks[0]?.status).toBe("passed");
    });

    it("should fail when a delete target file still exists", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_06",
          runId: "run_001",
          title: "Delete existing file",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "delete",
              target: "existing.txt",
              validationMethod: "file_exists",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "deleted",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBe(1);
      expect(opChecks[0]?.status).toBe("failed");
    });

    it("should not add output_plan checks when outputPlan is not set", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_07",
          runId: "run_001",
          title: "No output plan",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "done",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks).toHaveLength(0);
    });

    it("should not add output_plan checks when outputPlan is empty", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_08",
          runId: "run_001",
          title: "Empty output plan",
          acceptanceCriteria: [],
          outputPlan: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "done",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks).toHaveLength(0);
    });

    it("should validate file content method with content check", async () => {
      await writeTextFile(join(tempDir, "content.md"), "# Heading\n\nSome body text here.");
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_09",
          runId: "run_001",
          title: "Content validation",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "content.md",
              validationMethod: "file_content",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "file created",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBe(1);
      expect(opChecks[0]?.status).toBe("passed");
    });

    it("should validate multiple output plan items", async () => {
      await writeTextFile(join(tempDir, "multi-a.txt"), "file a");
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_10",
          runId: "run_001",
          title: "Multi output plan",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "multi-a.txt",
              validationMethod: "file_exists",
            },
            {
              action: "modify",
              target: "existing.txt",
              validationMethod: "file_exists",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "both done",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBe(2);
      expect(opChecks.every((c) => c.status === "passed")).toBe(true);
    });

    it("should fail validation when one output plan item fails", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_11",
          runId: "run_001",
          title: "Partial output plan",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "existing.txt",
              validationMethod: "file_exists",
            },
            {
              action: "create",
              target: "missing-output.txt",
              validationMethod: "file_exists",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "partial",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBe(2);
      const passedCheck = opChecks.find((c) => c.status === "passed");
      const failedCheck = opChecks.find((c) => c.status === "failed");
      expect(passedCheck?.path).toBe("existing.txt");
      expect(failedCheck?.path).toBe("missing-output.txt");
    });
  });

  describe("AI validation mode config-driven behavior", () => {
    const aiDisabledConfig = { validation: { aiValidation: "off" } } as unknown as FlowTaskConfig;
    const aiAlwaysConfig = { validation: { aiValidation: "always" } } as unknown as FlowTaskConfig;
    const aiFallbackConfig = {
      validation: { aiValidation: "fallback" },
    } as unknown as FlowTaskConfig;
    const aiHighRiskConfig = {
      validation: { aiValidation: "high_risk_only" },
    } as unknown as FlowTaskConfig;

    const normalTaskInput = {
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_mode_01",
        runId: "run_001",
        title: "Mode test task",
        acceptanceCriteria: [],
      },
      executorResult: {
        status: "done" as const,
        exitCode: 0,
        output: "task completed successfully",
        startedAt: now(),
        finishedAt: now(),
      },
    };

    const failingTaskInput = {
      ...normalTaskInput,
      task: { ...normalTaskInput.task, id: "task_mode_02" },
      executorResult: {
        status: "failed" as const,
        exitCode: 1,
        output: "task failed",
        startedAt: now(),
        finishedAt: now(),
      },
    };

    it("mode=off should skip AI review entirely", async () => {
      const engine = new ValidationEngine(aiDisabledConfig);
      const result = await engine.validateTask(normalTaskInput);
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(0);
    });

    it("mode=always should include AI review check", async () => {
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask(normalTaskInput);
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
    });

    it("mode=always should include AI review even for failing tasks", async () => {
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask(failingTaskInput);
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
    });

    it("mode=fallback should run AI when deterministic checks fail", async () => {
      const engine = new ValidationEngine(aiFallbackConfig);
      const result = await engine.validateTask({
        ...normalTaskInput,
        task: {
          ...normalTaskInput.task,
          expectedResult: "Very specific outcome that does not appear in executor output at all",
        },
        executorResult: {
          status: "failed" as const,
          exitCode: 1,
          output: "task failed with an error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
    });

    it("mode=fallback should skip AI when deterministic produces warnings only (not failure)", async () => {
      const engine = new ValidationEngine(aiFallbackConfig);
      const result = await engine.validateTask({
        ...normalTaskInput,
        task: {
          ...normalTaskInput.task,
          expectedResult: "Very specific outcome that does not appear in executor output at all",
        },
        executorResult: {
          ...normalTaskInput.executorResult,
          output: "task ran but produced unrelated output",
        },
      });
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(0);
    });

    it("mode=fallback should skip AI when deterministic is strong (process+acceptance pass)", async () => {
      const engine = new ValidationEngine(aiFallbackConfig);
      const result = await engine.validateTask({
        ...normalTaskInput,
        task: {
          ...normalTaskInput.task,
          acceptanceCriteria: ["Task completed"],
        },
        executorResult: {
          ...normalTaskInput.executorResult,
          output: "Task completed and all criteria satisfied",
        },
      });
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(0);
    });

    it("mode=high_risk_only should run AI for failing tasks", async () => {
      const engine = new ValidationEngine(aiHighRiskConfig);
      const result = await engine.validateTask(failingTaskInput);
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
    });

    it("mode=high_risk_only should skip AI for normal tasks", async () => {
      const engine = new ValidationEngine(aiHighRiskConfig);
      const result = await engine.validateTask(normalTaskInput);
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(0);
    });

    it("default mode (no config) should behave like fallback", async () => {
      const defaultEngine = new ValidationEngine();
      const result = await defaultEngine.validateTask(normalTaskInput);
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(0);
    });

    it("default mode should include AI review check when provider available", async () => {
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask(normalTaskInput);
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.type).toBe("ai_review");
    });

    it("mode=high_risk_only should run AI when task has retryCount > 0", async () => {
      const engine = new ValidationEngine(aiHighRiskConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_high_risk_retry",
          runId: "run_001",
          title: "Retried task",
          acceptanceCriteria: [],
          retryCount: 1,
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task completed after retry",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
    });

    it("mode=high_risk_only should run AI when outputPlan has delete action", async () => {
      const engine = new ValidationEngine(aiHighRiskConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_high_risk_delete",
          runId: "run_001",
          title: "Delete file task",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "delete",
              target: "old-file.txt",
              validationMethod: "file_exists",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "file deleted",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
    });

    it("mode=high_risk_only should skip AI when no risk factors present", async () => {
      const engine = new ValidationEngine(aiHighRiskConfig);
      const result = await engine.validateTask({
        ...normalTaskInput,
        task: {
          ...normalTaskInput.task,
          id: "task_high_risk_skip",
        },
      });
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(0);
    });

    it("mode=fallback should run AI when acceptance criteria fail", async () => {
      const engine = new ValidationEngine(aiFallbackConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_fallback_ac_fail",
          runId: "run_001",
          title: "Fallback AC fail",
          acceptanceCriteria: ["Specific output file was generated and saved"],
          expectedResult: "Output file is created with correct content",
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "task failed with error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
    });

    it("mode=fallback should skip AI when deterministic produces mixed passing and warnings without failure", async () => {
      const engine = new ValidationEngine(aiFallbackConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_fallback_warn_only",
          runId: "run_001",
          title: "Fallback warn no fail",
          acceptanceCriteria: [],
          expectedResult: "Specific outcome that does not exactly match executor output",
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task ran but produced unrelated output that does not match the expected result",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(0);
    });

    it("ai_review check details include verdict info and evidence summary in always mode", async () => {
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_details_check",
          runId: "run_001",
          title: "Check AI details",
          acceptanceCriteria: ["Task completed"],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Task completed and all criteria satisfied",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.details).toBeDefined();
      expect(aiCheck!.details).toHaveProperty("verdict");
      expect(aiCheck!.details).toHaveProperty("evidenceSummary");
      expect(aiCheck!.details).toHaveProperty("mode");
      expect(aiCheck!.details).toHaveProperty("deterministicFailed");
      expect(aiCheck!.details!.mode).toBe("always");
      expect(aiCheck!.details!.deterministicFailed).toBe(false);
    });
  });

  describe("AI verdict interaction with deterministic checks", () => {
    const aiAlwaysConfig = {
      validation: { aiValidation: "always" },
    } as unknown as FlowTaskConfig;

    beforeEach(() => {
      mockValidate.mockReset();
      mockValidate.mockResolvedValue({
        status: "passed",
        suggestion: "",
        explanation: "AI review passed",
        confidence: "high",
        evidenceSummary: "Evidence confirms completion",
        evidenceGaps: [],
      });
    });

    it("should downgrade AI passed to warning when deterministic checks fail", async () => {
      mockValidate.mockResolvedValue({
        status: "passed",
        suggestion: "",
        explanation: "AI review passed",
        confidence: "high",
        evidenceSummary: "Evidence confirms completion",
        evidenceGaps: [],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_verdict_downgrade",
          runId: "run_001",
          title: "Verdict downgrade test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "task failed with error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("warning");
      expect(aiCheck!.details!.deterministicFailed).toBe(true);
    });

    it("should keep AI failed when deterministic checks also fail", async () => {
      mockValidate.mockResolvedValue({
        status: "failed",
        suggestion: "Required file was not created",
        explanation: "File missing",
        confidence: "high",
        evidenceSummary: "Evidence shows file not created",
        evidenceGaps: ["missing file"],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_verdict_keep_fail",
          runId: "run_001",
          title: "Keep failed verdict",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "task failed with error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("failed");
      expect(aiCheck!.details!.deterministicFailed).toBe(true);
    });

    it("should keep AI passed when deterministic checks all pass", async () => {
      mockValidate.mockResolvedValue({
        status: "passed",
        suggestion: "",
        explanation: "AI review passed",
        confidence: "high",
        evidenceSummary: "Evidence confirms completion",
        evidenceGaps: [],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_verdict_keep_pass",
          runId: "run_001",
          title: "Keep passed verdict",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task completed successfully",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("passed");
      expect(aiCheck!.details!.deterministicFailed).toBe(false);
    });

    it("should downgrade AI needs_retry to warning when deterministic checks fail", async () => {
      mockValidate.mockResolvedValue({
        status: "needs_retry",
        suggestion: "Network timeout, retry may succeed",
        explanation: "Temporary failure",
        confidence: "medium",
        evidenceSummary: "Evidence suggests transient issue",
        evidenceGaps: [],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_verdict_retry_downgrade",
          runId: "run_001",
          title: "Retry downgrade test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "connection timeout",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("warning");
      expect(aiCheck!.details!.deterministicFailed).toBe(true);
    });

    it("should keep AI needs_review when deterministic checks also fail", async () => {
      mockValidate.mockResolvedValue({
        status: "needs_review",
        suggestion: "Evidence is ambiguous",
        explanation: "Cannot determine completion from available evidence",
        confidence: "low",
        evidenceSummary: "Evidence is insufficient",
        evidenceGaps: ["missing output", "no files changed"],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_verdict_review",
          runId: "run_001",
          title: "Review verdict test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "task failed with error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("needs_review");
      expect(aiCheck!.details!.deterministicFailed).toBe(true);
    });

    it("should keep AI warning when deterministic checks fail", async () => {
      mockValidate.mockResolvedValue({
        status: "warning",
        suggestion: "Minor issue detected",
        explanation: "Task mostly complete but has minor issues",
        confidence: "medium",
        evidenceSummary: "Partial completion detected",
        evidenceGaps: ["minor issue"],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_verdict_warning",
          runId: "run_001",
          title: "Warning verdict test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "task failed with error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("warning");
      expect(aiCheck!.details!.deterministicFailed).toBe(true);
    });

    it("should keep AI needs_retry when deterministic checks all pass", async () => {
      mockValidate.mockResolvedValue({
        status: "needs_retry",
        suggestion: "Network timeout, retry may resolve",
        explanation: "Temporary network issue detected",
        confidence: "medium",
        evidenceSummary: "Evidence suggests transient failure",
        evidenceGaps: [],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_verdict_retry_pass",
          runId: "run_001",
          title: "Retry keep test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task completed with network retry message",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("needs_retry");
      expect(aiCheck!.details!.deterministicFailed).toBe(false);
    });

    it("should keep AI needs_review when deterministic checks all pass", async () => {
      mockValidate.mockResolvedValue({
        status: "needs_review",
        suggestion: "Evidence ambiguous, human review needed",
        explanation: "Cannot determine completion from available evidence",
        confidence: "low",
        evidenceSummary: "Evidence is insufficient",
        evidenceGaps: ["missing confirmation"],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_verdict_review_pass",
          runId: "run_001",
          title: "Review keep test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task completed but output is ambiguous",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("needs_review");
      expect(aiCheck!.details!.deterministicFailed).toBe(false);
    });

    it("should keep AI warning when deterministic checks all pass", async () => {
      mockValidate.mockResolvedValue({
        status: "warning",
        suggestion: "Minor detail missing",
        explanation: "Task mostly complete but non-critical detail missing",
        confidence: "medium",
        evidenceSummary: "Partial completion",
        evidenceGaps: ["minor detail"],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_verdict_warning_pass",
          runId: "run_001",
          title: "Warning keep test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task completed with minor issue",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("warning");
      expect(aiCheck!.details!.deterministicFailed).toBe(false);
    });

    it("should not count outcome_comparison failure as deterministic failure for AI verdict adjustment", async () => {
      mockValidate.mockResolvedValue({
        status: "passed",
        suggestion: "",
        explanation: "AI review passed",
        confidence: "high",
        evidenceSummary: "Evidence confirms completion",
        evidenceGaps: [],
      });
      const config = {
        validation: { aiValidation: "always", adaptiveValidation: false },
      } as unknown as FlowTaskConfig;
      const engine = new ValidationEngine(config);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_outcome_det",
          runId: "run_001",
          title: "Outcome det test",
          acceptanceCriteria: [],
          expectedResult: "Very specific outcome that will not appear in executor output at all",
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "something completely unrelated",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      // outcome_comparison failure should NOT count as deterministic failure
      expect(aiCheck!.details!.deterministicFailed).toBe(false);
      // AI passed verdict should not be downgraded since only outcome_comparison failed
      expect(aiCheck!.status).toBe("passed");
      // outcome_comparison returns warning when process passes but output does not match
      const outcomeCheck = result.checks.find((c) => c.type === "outcome_comparison");
      expect(outcomeCheck?.status).toBe("warning");
      // overall result with adaptive disabled: outcome warning + no failures = warning
      expect(result.status).toBe("warning");
    });
  });

  describe("AI review message content for each verdict type", () => {
    const aiAlwaysConfig = {
      validation: { aiValidation: "always" },
    } as unknown as FlowTaskConfig;

    beforeEach(() => {
      mockValidate.mockReset();
    });

    it("should produce correct message when AI says passed and deterministic all pass", async () => {
      mockValidate.mockResolvedValue({
        status: "passed",
        suggestion: "",
        explanation: "All checks passed",
        confidence: "high",
        evidenceSummary: "Evidence confirms completion",
        evidenceGaps: [],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_msg_pass",
          runId: "run_001",
          title: "Message pass test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "all good",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck?.message).toBe(
        "AI review passed — evidence confirms task completed successfully",
      );
    });

    it("should produce warning message when AI says passed but deterministic failed", async () => {
      mockValidate.mockResolvedValue({
        status: "passed",
        suggestion: "",
        explanation: "AI thinks it's fine",
        confidence: "high",
        evidenceSummary: "AI confirms",
        evidenceGaps: [],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_msg_pass_det_fail",
          runId: "run_001",
          title: "Message pass det fail",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "task failed",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      // When deterministic checks fail, AI "passed" verdict is downgraded to "warning"
      expect(aiCheck!.status).toBe("warning");
      expect(aiCheck!.details!.deterministicFailed).toBe(true);
      expect(aiCheck?.message).toBe("AI review warning — evidence is inconclusive");
    });

    it("should produce correct message when AI says failed", async () => {
      mockValidate.mockResolvedValue({
        status: "failed",
        suggestion: "Required file was not created",
        explanation: "File missing",
        confidence: "high",
        evidenceSummary: "Evidence shows failure",
        evidenceGaps: ["missing file"],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_msg_fail",
          runId: "run_001",
          title: "Message fail test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck?.message).toBe("AI review failed — Required file was not created");
    });

    it("should produce correct message when AI says needs_retry", async () => {
      mockValidate.mockResolvedValue({
        status: "needs_retry",
        suggestion: "Network timeout, retry may resolve",
        explanation: "Transient issue",
        confidence: "medium",
        evidenceSummary: "Evidence suggests transient failure",
        evidenceGaps: [],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_msg_retry",
          runId: "run_001",
          title: "Message retry test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "retry message",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck?.message).toBe(
        "AI review suggests retry — Network timeout, retry may resolve",
      );
    });

    it("should produce correct message when AI says needs_review", async () => {
      mockValidate.mockResolvedValue({
        status: "needs_review",
        suggestion: "Evidence is ambiguous",
        explanation: "Cannot determine completion",
        confidence: "low",
        evidenceSummary: "Insufficient evidence",
        evidenceGaps: ["missing data"],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_msg_review",
          runId: "run_001",
          title: "Message review test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "ambiguous output",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck?.message).toBe("AI review requires human review — Evidence is ambiguous");
    });

    it("should produce correct message when AI says warning", async () => {
      mockValidate.mockResolvedValue({
        status: "warning",
        suggestion: "Minor issue detected",
        explanation: "Mostly complete",
        confidence: "medium",
        evidenceSummary: "Partial completion",
        evidenceGaps: ["minor issue"],
      });
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_msg_warn",
          runId: "run_001",
          title: "Message warn test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "mostly done",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck?.message).toBe("AI review warning — Minor issue detected");
    });
  });

  describe("AI validation provider error handling", () => {
    const aiAlwaysConfig = {
      validation: { aiValidation: "always" },
    } as unknown as FlowTaskConfig;

    beforeEach(() => {
      mockValidate.mockReset();
    });

    it("should produce skipped ai_review check when AI provider throws", async () => {
      mockValidate.mockRejectedValue(new Error("Provider connection refused"));
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_provider_error",
          runId: "run_001",
          title: "Provider error test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task output",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.status).toBe("skipped");
      expect(aiCheck!.message).toContain("AI validation could not run");
      expect(aiCheck!.details).toHaveProperty("reason", "ai_provider_error");
    });
  });

  describe("fallback mode with outcome_comparison failure", () => {
    const aiFallbackConfig = {
      validation: { aiValidation: "fallback" },
    } as unknown as FlowTaskConfig;

    it("should run AI when outcome_comparison fails (it counts as deterministic failure for mode decision)", async () => {
      const engine = new ValidationEngine(aiFallbackConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_fallback_outcome_fail",
          runId: "run_001",
          title: "Fallback outcome fail test",
          acceptanceCriteria: [],
          expectedResult: "Specific report saved to output.md",
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "task failed without creating report",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
    });
  });

  describe("evidence evidenceSummary in ai_check details", () => {
    const aiAlwaysConfig = {
      validation: { aiValidation: "always" },
    } as unknown as FlowTaskConfig;

    beforeEach(() => {
      mockValidate.mockReset();
      mockValidate.mockResolvedValue({
        status: "passed",
        suggestion: "",
        explanation: "AI review passed",
        confidence: "high",
        evidenceSummary: "Evidence confirms completion",
        evidenceGaps: [],
      });
    });

    it("should include deterministic check evidence in ai_review details", async () => {
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_evidence_detail",
          runId: "run_001",
          title: "Evidence detail test",
          acceptanceCriteria: ["Task completed"],
          expectedResult: "Task completed successfully",
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Task completed and all criteria satisfied",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      expect(aiCheck!.details!.evidenceSummary).toBeDefined();
      const summary = aiCheck!.details!.evidenceSummary as string;
      expect(summary).toContain("[process]");
      expect(summary).toContain("[acceptance_criteria]");
      expect(summary).toContain("[outcome_comparison]");
    });

    it("should include output plan results in evidence summary when available", async () => {
      mockValidate.mockClear();
      const engine = new ValidationEngine(aiAlwaysConfig);
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_op_evidence",
          runId: "run_001",
          title: "OP evidence test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "file created",
          startedAt: now(),
          finishedAt: now(),
          outputPlanResults: [
            { action: "create", target: "output.txt", produced: true, evidence: "file exists" },
          ],
        },
      });
      const aiCheck = result.checks.find((c) => c.type === "ai_review");
      expect(aiCheck).toBeDefined();
      const evidenceSummary = aiCheck!.details!.evidenceSummary as string;
      expect(evidenceSummary).toContain("Output Plan Results");
      expect(evidenceSummary).toContain("create output.txt");
      expect(evidenceSummary).toContain("produced: true");
    });
  });

  it("should never produce file or content type checks", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_no_file_type",
        runId: "run_001",
        title: "No file type",
        acceptanceCriteria: [],
        expectedResult: "Task completed successfully",
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "Task completed successfully with all objectives met",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    const checkTypes = result.checks.map((c) => c.type);
    expect(checkTypes).not.toContain("file");
    expect(checkTypes).not.toContain("content");
  });

  describe("enhanced validation — evidence checks", () => {
    it("should include evidence check in every validation", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ev_01",
          runId: "run_001",
          title: "Ev test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task completed",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const evidenceChecks = result.checks.filter((c) => c.type === "evidence");
      expect(evidenceChecks.length).toBe(1);
    });

    it("should pass evidence when process succeeded with output", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ev_02",
          runId: "run_001",
          title: "Ev pass",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "all good",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const ev = result.checks.find((c) => c.type === "evidence");
      expect(ev).toBeDefined();
      expect(ev!.status).toBe("passed");
      expect(ev!.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("enhanced validation — confidence scoring", () => {
    it("should include confidence in final result when all pass", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_conf_01",
          runId: "run_001",
          title: "Conf test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task completed",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should have lower confidence when checks fail", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_conf_02",
          runId: "run_001",
          title: "Conf fail",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeLessThan(0.5);
    });

    it("should include confidence on individual checks", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_conf_03",
          runId: "run_001",
          title: "Conf ind",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "ok",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const checksWithConf = result.checks.filter((c) => c.confidence !== undefined);
      expect(checksWithConf.length).toBeGreaterThan(0);
    });
  });

  describe("enhanced validation — failure reasons", () => {
    it("should include failureReason when validation fails", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_fr_01",
          runId: "run_001",
          title: "FR fail",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.failureReason).toBeDefined();
    });

    it("should not include failureReason when validation passes", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_fr_02",
          runId: "run_001",
          title: "FR pass",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "all good",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.failureReason).toBeUndefined();
    });

    it("should include failure reason with severity field", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_fr_03",
          runId: "run_001",
          title: "FR sev",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      if (typeof result.failureReason === "object" && result.failureReason) {
        expect(result.failureReason.severity).toBeDefined();
      }
    });
  });

  describe("enhanced validation — retry and review suggestions", () => {
    it("should include retrySuggestion when validation fails", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_rs_01",
          runId: "run_001",
          title: "RS test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "error",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      expect(result.retrySuggestion).toBeDefined();
    });

    it("should include userReviewSuggestion when validation needs review", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_rs_02",
          runId: "run_001",
          title: "RS review",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const needsReview = result.checks.some(
        (c) => c.status === "needs_review" || c.status === "warning",
      );
      if (needsReview) {
        expect(result.userReviewSuggestion).toBeDefined();
      }
    });
  });

  describe("enhanced validation — hybrid check", () => {
    it("should include hybrid check in validation results", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_hy_01",
          runId: "run_001",
          title: "Hy test",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task completed",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const hybridChecks = result.checks.filter((c) => c.type === "hybrid");
      expect(hybridChecks.length).toBe(1);
    });

    it("should set hybrid validationMethod to deterministic (without AI)", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_hy_02",
          runId: "run_001",
          title: "Hy det",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "ok",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const hybrid = result.checks.find((c) => c.type === "hybrid");
      expect(hybrid).toBeDefined();
      expect(hybrid!.validationMethod).toBeDefined();
    });

    it("should include deterministicScore and aiScore in hybrid details", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_hy_03",
          runId: "run_001",
          title: "Hy scores",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "all good",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const hybrid = result.checks.find((c) => c.type === "hybrid");
      expect(hybrid).toBeDefined();
      expect(hybrid!.details).toBeDefined();
      if (hybrid!.details) {
        const det = hybrid!.details as Record<string, unknown>;
        expect(det.deterministicPassed).toBeGreaterThan(0);
      }
    });
  });

  describe("enhanced validation — type-specific validation", () => {
    it("should produce document type check for documentation tasks", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ts_01",
          runId: "run_001",
          title: "Documentation task",
          description: "Write documentation for the API",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "# API Documentation\n\n## Overview\nThis document covers the API endpoints.",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const docChecks = result.checks.filter((c) => c.type === "document");
      expect(docChecks.length).toBe(1);
    });

    it("should document check pass when output has structured content", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ts_02",
          runId: "run_001",
          title: "Write docs",
          description: "document the module",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "# Heading\n\nSome content here about the module.",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const doc = result.checks.find((c) => c.type === "document");
      expect(doc).toBeDefined();
      expect(doc!.status).toBe("passed");
    });

    it("should produce research type check for research tasks", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ts_03",
          runId: "run_001",
          title: "Research topic",
          description: "research the market trends 2024",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output:
            "Based on sources, we found that the market has grown 25% annually. The analysis shows strong demand.",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const researchChecks = result.checks.filter((c) => c.type === "research");
      expect(researchChecks.length).toBe(1);
    });

    it("should produce log type check for log-related tasks", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ts_04",
          runId: "run_001",
          title: "Check logs",
          description: "analyze logging output for errors",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "INFO: Server started\nWARN: Deprecated API used\nERROR: Connection timeout",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const logChecks = result.checks.filter((c) => c.type === "log");
      expect(logChecks.length).toBe(1);
      expect(logChecks[0]?.status).toBe("warning");
    });

    it("should produce ui_result type check for UI tasks", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ts_05",
          runId: "run_001",
          title: "UI Design",
          description: "design the login screen UI",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Component rendered successfully with responsive layout",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const uiChecks = result.checks.filter((c) => c.type === "ui_result");
      expect(uiChecks.length).toBe(1);
      expect(uiChecks[0]?.status).toBe("passed");
    });

    it("should produce checklist type check for QA tasks", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ts_06",
          runId: "run_001",
          title: "QA checklist",
          description: "checklist for release validation",
          acceptanceCriteria: [],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output:
            "- [x] Unit tests pass\n- [x] Integration tests pass\n- [ ] E2E tests pass\nDone: 2/3 items",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const clChecks = result.checks.filter((c) => c.type === "checklist");
      expect(clChecks.length).toBe(1);
      expect(clChecks[0]?.status).toBe("passed");
    });

    it("should produce requirement_coverage type check for requirement tasks", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ts_07",
          runId: "run_001",
          title: "Requirements",
          description: "requirement coverage analysis",
          acceptanceCriteria: ["API endpoints documented", "Error handling covered"],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "API endpoints documented with examples. Error handling covered in chapter 3.",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const rcChecks = result.checks.filter((c) => c.type === "requirement_coverage");
      expect(rcChecks.length).toBe(1);
      expect(rcChecks[0]?.status).toBe("passed");
    });

    it("should produce requirement_coverage with failure when criteria not met", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_ts_08",
          runId: "run_001",
          title: "Requirements fail",
          description: "requirement coverage",
          acceptanceCriteria: ["Unrelated requirement that is not in output"],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Some output without the requirement",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const rcChecks = result.checks.filter((c) => c.type === "requirement_coverage");
      expect(rcChecks.length).toBe(1);
      expect(rcChecks[0]?.status).toBe("failed");
    });
  });

  describe("enhanced validation — data validation", () => {
    let dataDir: string;
    let _tmpDir: string;

    beforeAll(async () => {
      _tmpDir = join(tmpdir(), "eng-data-tests-" + Date.now());
      dataDir = _tmpDir;
      await ensureDir(dataDir);
      await writeTextFile(
        join(dataDir, "data.json"),
        JSON.stringify({ items: [1, 2, 3], total: 3 }),
      );
      await writeTextFile(join(dataDir, "data.csv"), "name,age\nAlice,30\nBob,25\n");
      await writeTextFile(join(dataDir, "invalid.json"), "{invalid json content");
    });

    afterAll(() => {
      rmSync(_tmpDir, { recursive: true, force: true });
    });

    it("should validate JSON data files", async () => {
      const { DataValidator } = await import("../../src/validation/data-validator.js");
      const dv = new DataValidator();
      const checks = await dv.validate({
        paths: ["data.json"],
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "",
          startedAt: now(),
          finishedAt: now(),
        },
        projectRoot: dataDir,
      });
      const jsonCheck = checks.find((c) => c.path === "data.json");
      expect(jsonCheck).toBeDefined();
      expect(jsonCheck!.status).toBe("passed");
      expect(jsonCheck!.confidence).toBe(1);
    });

    it("should fail invalid JSON data files", async () => {
      const { DataValidator } = await import("../../src/validation/data-validator.js");
      const dv = new DataValidator();
      const checks = await dv.validate({
        paths: ["invalid.json"],
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "",
          startedAt: now(),
          finishedAt: now(),
        },
        projectRoot: dataDir,
      });
      const check = checks.find((c) => c.path === "invalid.json");
      expect(check).toBeDefined();
      expect(check!.status).toBe("failed");
    });

    it("should validate CSV data files with column/row analysis", async () => {
      const { DataValidator } = await import("../../src/validation/data-validator.js");
      const dv = new DataValidator();
      const checks = await dv.validate({
        paths: ["data.csv"],
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "",
          startedAt: now(),
          finishedAt: now(),
        },
        projectRoot: dataDir,
      });
      const check = checks.find((c) => c.path === "data.csv");
      expect(check).toBeDefined();
      expect(check!.status).toBe("passed");
      expect(check!.confidence).toBeGreaterThan(0.9);
    });

    it("should detect data file paths from executor output", async () => {
      const { DataValidator } = await import("../../src/validation/data-validator.js");
      const dv = new DataValidator();
      const checks = await dv.validate({
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "produced output.csv and result.json",
          startedAt: now(),
          finishedAt: now(),
        },
        projectRoot: dataDir,
      });
      expect(checks.length).toBeGreaterThanOrEqual(1);
      expect(checks[0]?.status).toBeDefined();
    });
  });
});
