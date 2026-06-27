import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ValidationEngine } from "../../src/validation/validation-engine.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTextFile, ensureDir } from "../../src/utils/fs.js";

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
});
