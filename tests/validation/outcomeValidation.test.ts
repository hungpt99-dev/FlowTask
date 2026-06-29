import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ValidationEngine } from "../../src/validation/validation-engine.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTextFile, ensureDir } from "../../src/utils/fs.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

const OUTCOME_BASED_TYPES = new Set([
  "process",
  "command",
  "acceptance_criteria",
  "outcome_comparison",
  "output_plan",
]);

const baseTask = {
  status: "running" as const,
  executor: "shell",
  dependsOn: [] as string[],
  retryCount: 0,
  maxRetries: 2,
  createdAt: now(),
  updatedAt: now(),
};

const engine = new ValidationEngine();

describe("Outcome-based validation only", () => {
  it("should never produce file or content type checks", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_never_file",
        runId: "run_001",
        title: "No file checks",
        acceptanceCriteria: ["Task completed"],
        expectedResult: "Task completes successfully",
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

  it("should only produce outcome-based check types", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_only_types",
        runId: "run_001",
        title: "Types test",
        acceptanceCriteria: ["Output generated"],
        expectedResult: "Generate output file with results",
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "Generated output file with results successfully",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    for (const check of result.checks) {
      expect(OUTCOME_BASED_TYPES.has(check.type)).toBe(true);
    }
  });

  it("should pass when process exit code is 0", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_process_pass",
        runId: "run_001",
        title: "Process pass",
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
    const processCheck = result.checks.find((c) => c.type === "process");
    expect(processCheck?.status).toBe("passed");
  });

  it("should fail when process exit code is non-zero", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_process_fail",
        runId: "run_001",
        title: "Process fail",
        acceptanceCriteria: [],
      },
      executorResult: {
        status: "failed",
        exitCode: 1,
        output: "error occurred",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    expect(result.status).toBe("failed");
    const processCheck = result.checks.find((c) => c.type === "process");
    expect(processCheck?.status).toBe("failed");
  });

  it("should pass validation commands when they succeed", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_cmd_pass",
        runId: "run_001",
        title: "Validation cmd pass",
        acceptanceCriteria: [],
        validation: {
          commands: ["node -e 'process.exit(0)'"],
        },
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "task done",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    const cmdChecks = result.checks.filter((c) => c.type === "command");
    expect(cmdChecks.length).toBeGreaterThan(0);
    expect(cmdChecks.every((c) => c.status === "passed")).toBe(true);
  });

  it("should fail validation commands when they fail", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_cmd_fail",
        runId: "run_001",
        title: "Validation cmd fail",
        acceptanceCriteria: [],
        validation: {
          commands: ["node -e 'process.exit(1)'"],
        },
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "task done",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    const cmdChecks = result.checks.filter((c) => c.type === "command");
    expect(cmdChecks.length).toBeGreaterThan(0);
    expect(cmdChecks.some((c) => c.status === "failed")).toBe(true);
  });

  it("should pass acceptance criteria when outputs mention them", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_ac_pass",
        runId: "run_001",
        title: "AC pass",
        acceptanceCriteria: ["Feature implemented and tested"],
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "Feature implemented and tested with all scenarios passing",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    const acChecks = result.checks.filter((c) => c.type === "acceptance_criteria");
    expect(acChecks.length).toBeGreaterThan(0);
    expect(acChecks.every((c) => c.status === "passed")).toBe(true);
  });

  it("should warn on acceptance criteria when no evidence found", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_ac_warn",
        runId: "run_001",
        title: "AC warn",
        acceptanceCriteria: ["Unrelated requirement with no evidence"],
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "something completely different",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    const acChecks = result.checks.filter((c) => c.type === "acceptance_criteria");
    expect(acChecks.length).toBeGreaterThan(0);
    expect(acChecks.some((c) => c.status === "warning")).toBe(true);
  });

  it("should pass expectedResult outcome comparison when output matches", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_expected_pass",
        runId: "run_001",
        title: "Expected result pass",
        acceptanceCriteria: [],
        expectedResult: "All tests pass and report is generated",
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "All tests pass and report is generated",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    const ocCheck = result.checks.find((c) => c.type === "outcome_comparison");
    expect(ocCheck?.status).toBe("passed");
  });

  it("should fail expectedResult outcome comparison when process fails", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_outcome_expected_fail",
        runId: "run_001",
        title: "Expected result fail",
        acceptanceCriteria: [],
        expectedResult: "Generate comprehensive analysis report",
      },
      executorResult: {
        status: "failed",
        exitCode: 1,
        output: "something went wrong",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    const ocCheck = result.checks.find((c) => c.type === "outcome_comparison");
    expect(ocCheck?.status).toBe("failed");
  });

  describe("with outputPlan validation", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "outcome-opv-"));
      await ensureDir(tempDir);
      await writeTextFile(join(tempDir, "existing.txt"), "existing content");
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should pass output_plan when target file exists", async () => {
      await writeTextFile(join(tempDir, "created-op.txt"), "new file");
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_pass",
          runId: "run_001",
          title: "OP pass",
          acceptanceCriteria: [],
          outputPlan: [
            { action: "create", target: "created-op.txt", validationMethod: "file_exists" },
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
      expect(opChecks.length).toBeGreaterThan(0);
      expect(opChecks.every((c) => c.status === "passed")).toBe(true);
    });

    it("should fail output_plan when target file is missing", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_fail",
          runId: "run_001",
          title: "OP fail",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "should-exist-op.txt",
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
      expect(opChecks.length).toBeGreaterThan(0);
      expect(opChecks.some((c) => c.status === "failed")).toBe(true);
    });

    it("should pass output_plan with command_output validation method", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_cmd_output",
          runId: "run_001",
          title: "OP cmd output",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "report.md",
              validationMethod: "command_output",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Created report.md with analysis results",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBeGreaterThan(0);
      expect(opChecks.every((c) => c.status === "passed")).toBe(true);
    });

    it("should pass output_plan with file_content validation method when file has content", async () => {
      await writeTextFile(
        join(tempDir, "content-report.txt"),
        "analysis complete with 10 test cases passing",
      );
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_file_content",
          runId: "run_001",
          title: "OP file content",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "content-report.txt",
              validationMethod: "file_content",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "created content-report.txt",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBeGreaterThan(0);
      expect(opChecks.every((c) => c.status === "passed")).toBe(true);
      const contentCheck = opChecks.find(
        (c) => (c.details as Record<string, unknown>)?.validationMethod === "file_content",
      );
      expect(contentCheck).toBeDefined();
    });

    it("should fail output_plan with file_content when file is empty", async () => {
      await writeTextFile(join(tempDir, "empty.txt"), "");
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_empty_content",
          runId: "run_001",
          title: "OP empty content",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "empty.txt",
              validationMethod: "file_content",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "created empty.txt",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.some((c) => c.status === "failed")).toBe(true);
      const contentCheck = opChecks.find(
        (c) => (c.details as Record<string, unknown>)?.validationMethod === "file_content",
      );
      expect(contentCheck).toBeDefined();
    });

    it("should handle output_plan with file_diff validation method (create action)", async () => {
      await writeTextFile(join(tempDir, "diff-output.txt"), "new content");
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_op_file_diff",
          runId: "run_001",
          title: "OP file diff",
          acceptanceCriteria: [],
          outputPlan: [
            {
              action: "create",
              target: "diff-output.txt",
              validationMethod: "file_diff",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "created diff-output.txt",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBeGreaterThan(0);
      expect(opChecks.every((c) => c.status === "passed")).toBe(true);
      const diffCheck = opChecks.find(
        (c) => (c.details as Record<string, unknown>)?.validationMethod === "file_diff",
      );
      expect(diffCheck).toBeDefined();
    });
  });

  describe("combined outcome-based checks", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "outcome-combined-"));
      await ensureDir(tempDir);
      await writeTextFile(join(tempDir, "output.txt"), "task results data");
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should pass with all outcome-based checks succeeding", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_combined_all_pass",
          runId: "run_001",
          title: "All outcome checks pass",
          acceptanceCriteria: ["output.txt contains task results"],
          expectedResult: "Generate output.txt with task data",
          validation: { commands: ["node -e 'process.exit(0)'"] },
          outputPlan: [
            {
              action: "create",
              target: "output.txt",
              validationMethod: "file_exists",
            },
          ],
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
      const types = new Set(result.checks.map((c) => c.type));
      for (const check of result.checks) {
        expect(OUTCOME_BASED_TYPES.has(check.type)).toBe(true);
      }
      expect(types.has("process")).toBe(true);
      expect(types.has("command")).toBe(true);
      expect(types.has("acceptance_criteria")).toBe(true);
      expect(types.has("outcome_comparison")).toBe(true);
      expect(types.has("output_plan")).toBe(true);
      expect(types.has("file")).toBe(false);
      expect(types.has("content")).toBe(false);
    });

    it("should warn when outcome passes but process fails", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          ...baseTask,
          id: "task_combined_outcome_pass_process_fail",
          runId: "run_001",
          title: "Outcome pass, process fail",
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

      expect(result.status).toBe("warning");
      const fileCheck = result.checks.find((c) => c.type === "file");
      expect(fileCheck).toBeUndefined();
    });
  });

  it("should not produce file or content checks when using all outcome-based fields together", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_all_outcome",
        runId: "run_001",
        title: "All outcome",
        acceptanceCriteria: ["Task completed"],
        expectedResult: "Task completes successfully",
        validation: { commands: ["node -e 'process.exit(0)'"] },
        outputPlan: [{ action: "create", target: "output.md", validationMethod: "command_output" }],
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "Task completed successfully output.md created",
        startedAt: now(),
        finishedAt: now(),
      },
    });

    const checkTypes = result.checks.map((c) => c.type);
    expect(checkTypes).not.toContain("file");
    expect(checkTypes).not.toContain("content");
    expect(result.checks.every((c) => OUTCOME_BASED_TYPES.has(c.type))).toBe(true);
  });

  describe("empty validation", () => {
    it("should use only process check when no other validation is configured", async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: "task_no_checks",
          runId: "run_001",
          title: "No checks",
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
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0]?.type).toBe("process");
      expect(result.checks[0]?.status).toBe("passed");
    });
  });
});
