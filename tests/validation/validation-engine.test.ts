import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ValidationEngine } from "../../src/validation/validation-engine.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTextFile, ensureDir } from "../../src/utils/fs.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

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

    it("should warn when outcome passes but other checks fail", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_adaptive_02",
          runId: "run_001",
          title: "Outcome passes but files missing",
          acceptanceCriteria: [],
          expectedResult: "task completed successfully",
          validation: { requiredFiles: ["nonexistent-file.txt"] },
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task completed successfully",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const outcomeCheck = result.checks.find((c) => c.type === "outcome_comparison");
      expect(outcomeCheck?.status).toBe("passed");
      const failedCheck = result.checks.find((c) => c.type === "file");
      expect(failedCheck?.status).toBe("failed");
      expect(result.status).toBe("warning");
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

    it("should fail when outcome warns and other checks fail", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_adaptive_04",
          runId: "run_001",
          title: "Outcome warns others fail",
          acceptanceCriteria: [],
          expectedResult: "Very specific phrase that is not in output at all for this task",
          validation: { requiredFiles: ["nonexistent-file.txt"] },
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "something completely unrelated",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const outcomeCheck = result.checks.find((c) => c.type === "outcome_comparison");
      expect(outcomeCheck?.status).toBe("warning");
      const failedCheck = result.checks.find((c) => c.type === "file");
      expect(failedCheck?.status).toBe("failed");
      expect(result.status).toBe("failed");
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

    it("should pass when all validators pass", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_combo_01",
          runId: "run_001",
          title: "All validators",
          acceptanceCriteria: ["output.txt contains task results"],
          expectedResult: "Generate output.txt with task data",
          validation: {
            requiredFiles: ["output.txt"],
            requiredContent: ["output.txt"],
          },
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
      expect(result.checks.length).toBeGreaterThanOrEqual(4);
    });

    it("should warn when outcome passes but some file validators fail", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_combo_02",
          runId: "run_001",
          title: "Partial validation",
          acceptanceCriteria: [],
          expectedResult: "output.txt created with results from task",
          validation: {
            requiredFiles: ["output.txt", "missing.txt"],
            requiredContent: ["output.txt"],
          },
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "output.txt created with results from task",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const outcomeCheck = result.checks.find((c) => c.type === "outcome_comparison");
      expect(outcomeCheck?.status).toBe("passed");
      const failedFileCheck = result.checks.find((c) => c.path === "missing.txt");
      expect(failedFileCheck?.status).toBe("failed");
      expect(result.status).toBe("warning");
    });
  });

  describe("with content validation", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "engine-content-test-"));
      await ensureDir(tempDir);
      await writeTextFile(join(tempDir, "report.md"), "# Analysis Report\n\nFindings here.");
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should validate requiredContent", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_004",
          runId: "run_001",
          title: "Content task",
          acceptanceCriteria: [],
          validation: { requiredContent: ["report.md"] },
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "report generated",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const contentChecks = result.checks.filter((c) => c.type === "content");
      expect(contentChecks.length).toBeGreaterThan(0);
      expect(contentChecks[0]?.status).toBe("passed");
    });

    it("should fail when requiredContent file is missing", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_005",
          runId: "run_001",
          title: "Missing content task",
          acceptanceCriteria: [],
          validation: { requiredContent: ["missing-report.md"] },
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "done",
          startedAt: now(),
          finishedAt: now(),
        },
      });
      const contentChecks = result.checks.filter((c) => c.type === "content");
      expect(contentChecks[0]?.status).toBe("failed");
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
});
