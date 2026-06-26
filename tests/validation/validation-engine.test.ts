import { describe, it, expect } from "vitest";
import { ValidationEngine } from "../../src/validation/validation-engine.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";

describe("ValidationEngine", () => {
  const engine = new ValidationEngine();

  it("should fail when process exits with non-zero", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        id: "task_001",
        runId: "run_001",
        title: "Test task",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now(),
        updatedAt: now(),
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
        id: "task_002",
        runId: "run_001",
        title: "Good task",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now(),
        updatedAt: now(),
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
});
