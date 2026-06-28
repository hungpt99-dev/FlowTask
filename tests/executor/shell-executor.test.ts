import { describe, it, expect } from "vitest";
import { ShellExecutor } from "../../src/executor/shell-executor.js";
import { serializeOutputPlan } from "../../src/executor/executor.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";

describe("serializeOutputPlan", () => {
  it("should serialize output plan to JSON string", () => {
    const result = serializeOutputPlan([
      {
        action: "create",
        target: "report.md",
        description: "Generate report",
        validationMethod: "file_exists",
      },
    ]);
    expect(result).toBe(
      '[{"action":"create","target":"report.md","description":"Generate report","validationMethod":"file_exists"}]',
    );
  });

  it("should return empty string for undefined output plan", () => {
    expect(serializeOutputPlan(undefined)).toBe("");
  });

  it("should return empty string for empty output plan", () => {
    expect(serializeOutputPlan([])).toBe("");
  });
});

describe("ShellExecutor", () => {
  const executor = new ShellExecutor();

  it("should have the correct name", () => {
    expect(executor.name).toBe("shell");
  });

  it("should execute a simple command successfully", async () => {
    const result = await executor.execute({
      projectRoot: testDir,
      runId: "test-run",
      task: {
        id: "task_001",
        runId: "test-run",
        title: "echo hello",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        validation: { commands: ["echo hello"], requiredArtifacts: [] },
        retryCount: 0,
        maxRetries: 2,
        createdAt: now(),
        updatedAt: now(),
      },
      contextPackPath: "/dev/null",
      contextPackContent: "",
    });

    expect(result.status).toBe("done");
    expect(result.exitCode).toBe(0);
  });

  it("should fail on a non-zero exit code", async () => {
    const result = await executor.execute({
      projectRoot: testDir,
      runId: "test-run",
      task: {
        id: "task_002",
        runId: "test-run",
        title: "exit 1",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        validation: { commands: ["exit 1"], requiredArtifacts: [] },
        retryCount: 0,
        maxRetries: 2,
        createdAt: now(),
        updatedAt: now(),
      },
      contextPackPath: "/dev/null",
      contextPackContent: "",
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
  });

  it("should pass output plan as FLOWTASK_OUTPUT_PLAN env var", async () => {
    const result = await executor.execute({
      projectRoot: testDir,
      runId: "test-run",
      task: {
        id: "task_output_plan",
        runId: "test-run",
        title: "check output plan env",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        outputPlan: [
          {
            action: "create",
            target: "report.md",
            description: "Generate report",
            validationMethod: "file_exists",
          },
        ],
        validation: {
          commands: ["echo output plan: $FLOWTASK_OUTPUT_PLAN"],
          requiredArtifacts: [],
        },
        retryCount: 0,
        maxRetries: 2,
        createdAt: now(),
        updatedAt: now(),
      },
      contextPackPath: "/dev/null",
      contextPackContent: "",
    });

    expect(result.status).toBe("done");
    expect(result.output).toContain("create");
    expect(result.output).toContain("report.md");
  });

  it("should succeed when no commands are defined", async () => {
    const result = await executor.execute({
      projectRoot: testDir,
      runId: "test-run",
      task: {
        id: "task_003",
        runId: "test-run",
        title: "Read project rules",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        validation: { requiredArtifacts: [] },
        retryCount: 0,
        maxRetries: 2,
        createdAt: now(),
        updatedAt: now(),
      },
      contextPackPath: "/dev/null",
      contextPackContent: "",
    });

    expect(result.status).toBe("done");
    expect(result.exitCode).toBe(0);
  });
});
