import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";
import { ValidationEngine } from "../../src/validation/validation-engine.js";
import { OutputPlanValidator } from "../../src/validation/output-plan-validator.js";
import { writeTextFile, ensureDir } from "../../src/utils/fs.js";
import { serializeOutputPlan } from "../../src/executor/executor.js";
import { now } from "../../src/utils/time.js";

interface TaskOverrides {
  id: string;
  runId: string;
  title: string;
  status: "pending" | "done" | "running" | "failed" | "skipped";
  executor: string;
  dependsOn: string[];
  acceptanceCriteria: string[];
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  description?: string;
  outputPlan?: Array<{
    action: "create" | "modify" | "delete";
    target: string;
    description?: string;
    validationMethod:
      | "file_exists"
      | "file_content"
      | "file_diff"
      | "command_output"
      | "test"
      | "ai_review"
      | "manual";
    acceptanceCriteria?: string[];
  }>;
  validation?: { commands?: string[] };
  expectedResult?: string;
}

function makeTask(
  overrides: Partial<TaskOverrides> & { id: string; runId: string; title: string },
): TaskOverrides {
  const nowDate = new Date().toISOString();
  return {
    status: "pending" as const,
    executor: "shell",
    dependsOn: [],
    acceptanceCriteria: [],
    retryCount: 0,
    maxRetries: 2,
    createdAt: nowDate,
    updatedAt: nowDate,
    ...overrides,
  };
}

let testDir: string;
let api: FlowTaskAPI;

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-op-flow-"));
  api = new FlowTaskAPI({ rootPath: testDir });
  await api.initProject("Output Plan Integration Test", "development");
  await api.initDatabase();
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("FlowTask Output Plan Integration", () => {
  describe("Task persistence with outputPlan", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "Output plan persist test", "auto");
      runId = run.runId;
    });

    it("should save and load tasks with outputPlan", async () => {
      const outputPlan = [
        {
          action: "create" as const,
          target: "output-plan-report.md",
          validationMethod: "file_exists" as const,
          description: "Main report file",
        },
        {
          action: "modify" as const,
          target: "config.json",
          validationMethod: "file_diff" as const,
          description: "Update configuration",
        },
        {
          action: "delete" as const,
          target: "temp.log",
          validationMethod: "file_exists" as const,
          description: "Remove temp file",
        },
      ];

      const tasks = [
        makeTask({
          id: "op_task_save_1",
          runId,
          title: "Task with output plan",
          outputPlan,
        }),
        makeTask({
          id: "op_task_no_plan",
          runId,
          title: "Task without output plan",
        }),
      ];

      await api.saveTasks(runId, tasks);

      const loaded = await api.loadTasks(runId);
      expect(loaded).toHaveLength(2);

      const withPlan = loaded.find((t) => t.id === "op_task_save_1")!;
      expect(withPlan.outputPlan).toBeDefined();
      expect(withPlan.outputPlan).toHaveLength(3);
      expect(withPlan.outputPlan![0]!.action).toBe("create");
      expect(withPlan.outputPlan![0]!.target).toBe("output-plan-report.md");
      expect(withPlan.outputPlan![1]!.action).toBe("modify");
      expect(withPlan.outputPlan![2]!.action).toBe("delete");

      const withoutPlan = loaded.find((t) => t.id === "op_task_no_plan")!;
      expect(withoutPlan.outputPlan).toBeUndefined();
    });

    it("should persist outputPlan across API instances", async () => {
      const api2 = new FlowTaskAPI({ rootPath: testDir });
      await api2.initDatabase();
      const loaded = await api2.loadTasks(runId);
      const task = loaded.find((t) => t.id === "op_task_save_1");
      expect(task).toBeDefined();
      expect(task!.outputPlan).toBeDefined();
      expect(task!.outputPlan!.length).toBe(3);
    });
  });

  describe("Output plan serialization for executors", () => {
    it("should serialize outputPlan to JSON string", () => {
      const outputPlan = [
        {
          action: "create" as const,
          target: "report.md",
          validationMethod: "file_exists" as const,
        },
        {
          action: "modify" as const,
          target: "config.json",
          validationMethod: "file_diff" as const,
        },
      ];
      const serialized = serializeOutputPlan(outputPlan);
      expect(serialized).toBeTruthy();
      const parsed = JSON.parse(serialized);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]!.action).toBe("create");
      expect(parsed[0]!.target).toBe("report.md");
    });

    it("should return empty string for undefined outputPlan", () => {
      expect(serializeOutputPlan(undefined)).toBe("");
    });

    it("should return empty string for empty outputPlan", () => {
      expect(serializeOutputPlan([])).toBe("");
    });

    it("should produce env-var-friendly serialization", () => {
      const outputPlan = [
        {
          action: "create" as const,
          target: "src/report.md",
          validationMethod: "file_exists" as const,
        },
      ];
      const serialized = serializeOutputPlan(outputPlan);
      expect(serialized).not.toContain("\n");
      expect(serialized).toContain("src/report.md");
    });
  });

  describe("ValidationEngine integration with outputPlan", () => {
    let tempDir: string;
    const engine = new ValidationEngine();

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "op-validate-integration-"));
      await ensureDir(tempDir);
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should pass validation when outputPlan items are satisfied (create + file_exists)", async () => {
      const targetFile = join(tempDir, "created-output.txt");
      await writeTextFile(targetFile, "output content");

      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_001",
          runId: "run_op_001",
          title: "Create output file",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "create", target: "created-output.txt", validationMethod: "file_exists" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Created created-output.txt",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      expect(result.status).toBe("passed");
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBeGreaterThanOrEqual(1);
      expect(opChecks[0]!.status).toBe("passed");
    });

    it("should fail validation when outputPlan item is not satisfied (create + file_missing)", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_002",
          runId: "run_op_001",
          title: "Missing output file",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "create", target: "should-exist.txt", validationMethod: "file_exists" },
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
      expect(opChecks.length).toBeGreaterThanOrEqual(1);
      expect(opChecks[0]!.status).toBe("failed");
    });

    it("should validate modify action - pass when file exists", async () => {
      const modFile = join(tempDir, "modify-existing.txt");
      await writeTextFile(modFile, "content to modify");

      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_mod_001",
          runId: "run_op_001",
          title: "Modify file",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "modify", target: "modify-existing.txt", validationMethod: "file_exists" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "modified",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks[0]!.status).toBe("passed");
      expect(opChecks[0]!.message).toContain("exists for modification");
    });

    it("should validate modify action - fail when file missing", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_mod_002",
          runId: "run_op_001",
          title: "Modify missing file",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "modify", target: "ghost-config.json", validationMethod: "file_exists" },
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
      expect(opChecks[0]!.status).toBe("failed");
      expect(opChecks[0]!.message).toContain("not found for modification");
    });

    it("should validate delete action - pass when file does not exist", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_del_001",
          runId: "run_op_001",
          title: "Delete removed file",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "delete", target: "already-deleted.txt", validationMethod: "file_exists" },
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
      expect(opChecks[0]!.status).toBe("passed");
      expect(opChecks[0]!.message).toContain("File deleted");
    });

    it("should validate delete action - fail when file still exists", async () => {
      const delFile = join(tempDir, "should-be-deleted.txt");
      await writeTextFile(delFile, "delete me");

      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_del_002",
          runId: "run_op_001",
          title: "Delete file still present",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "delete", target: "should-be-deleted.txt", validationMethod: "file_exists" },
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
      expect(opChecks[0]!.status).toBe("failed");
      expect(opChecks[0]!.message).toContain("still exists");
    });

    it("should validate with file_content method - pass when file has content", async () => {
      const contentFile = join(tempDir, "content-report.md");
      await writeTextFile(contentFile, "# Report\n\nThis is the analysis report.");

      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_content_001",
          runId: "run_op_001",
          title: "Create report with content",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "create", target: "content-report.md", validationMethod: "file_content" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Created report with analysis",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks[0]!.status).toBe("passed");
      expect(opChecks[0]!.message).toContain("Created with content");
    });

    it("should validate with file_content method - fail when file empty", async () => {
      const emptyFile = join(tempDir, "empty-report.md");
      await writeTextFile(emptyFile, "");

      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_content_002",
          runId: "run_op_001",
          title: "Create empty report",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "create", target: "empty-report.md", validationMethod: "file_content" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "created",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks[0]!.status).toBe("failed");
      expect(opChecks[0]!.message).toContain("empty");
    });

    it("should validate with command_output - pass when output mentions target + action", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_cmd_001",
          runId: "run_op_001",
          title: "Task with output mention",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "create", target: "generated-report.md", validationMethod: "command_output" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Successfully created generated-report.md with all findings",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks[0]!.status).toBe("passed");
    });

    it("should validate with command_output - warn when output missing target", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_cmd_002",
          runId: "run_op_001",
          title: "Task without output mention",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "create", target: "missing-output.md", validationMethod: "command_output" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "All tasks completed successfully",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks[0]!.status).toBe("warning");
    });

    it("should validate with test method - pass when process exits 0", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_test_001",
          runId: "run_op_001",
          title: "Test validation task",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [{ action: "create", target: "test-output.txt", validationMethod: "test" }],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "All tests passed",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks[0]!.status).toBe("passed");
    });

    it("should flag ai_review and manual as warning", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "validate_op_review_001",
          runId: "run_op_001",
          title: "Review task",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "create", target: "complex-report.md", validationMethod: "ai_review" },
            { action: "modify", target: "sensitive-config.json", validationMethod: "manual" },
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
      expect(opChecks).toHaveLength(2);
      expect(opChecks[0]!.status).toBe("warning");
      expect(opChecks[0]!.message).toContain("AI review needed");
      expect(opChecks[1]!.status).toBe("warning");
      expect(opChecks[1]!.message).toContain("Manual verification needed");
    });
  });

  describe("Plan-vs-reality validation with outputPlan", () => {
    let tempDir: string;
    const engine = new ValidationEngine();

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "op-plan-reality-"));
      await ensureDir(tempDir);
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should pass when all outputPlan items are satisfied", async () => {
      await writeTextFile(join(tempDir, "report.md"), "# Full Report\n\nComplete.");
      await writeTextFile(join(tempDir, "config.json"), '{"updated": true}');

      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "plan_reality_pass_001",
          runId: "run_001",
          title: "All outputs created",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            {
              action: "create",
              target: "report.md",
              validationMethod: "file_exists",
              description: "Final report",
            },
            {
              action: "modify",
              target: "config.json",
              validationMethod: "file_content",
              description: "Updated config",
            },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Created report.md, modified config.json",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      expect(result.status).toBe("passed");
      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.every((c) => c.status === "passed")).toBe(true);
    });

    it("should fail when outputPlan item is missing (create action)", async () => {
      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "plan_reality_fail_001",
          runId: "run_001",
          title: "Missing create output",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "create", target: "report.md", validationMethod: "file_exists" },
            { action: "create", target: "missing-doc.md", validationMethod: "file_exists" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Created report.md only",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      const passedChecks = opChecks.filter((c) => c.status === "passed");
      const failedChecks = opChecks.filter((c) => c.status === "failed");
      expect(passedChecks.length).toBeGreaterThanOrEqual(1);
      expect(failedChecks.length).toBeGreaterThanOrEqual(1);
      expect(failedChecks[0]!.path).toBe("missing-doc.md");
    });

    it("should fail when file still exists after delete action", async () => {
      await writeTextFile(join(tempDir, "should-remove.log"), "old data");

      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "plan_reality_del_fail_001",
          runId: "run_001",
          title: "Delete not executed",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            { action: "delete", target: "should-remove.log", validationMethod: "file_exists" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task done",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks[0]!.status).toBe("failed");
      expect(opChecks[0]!.message).toContain("still exists");
    });

    it("should handle multiple outputPlan items with mixed validation methods", async () => {
      await writeTextFile(
        join(tempDir, "api-doc.md"),
        "# API Documentation\n\nEndpoint docs here.",
      );

      const result = await engine.validateTask({
        projectRoot: tempDir,
        task: {
          id: "plan_reality_mixed_001",
          runId: "run_001",
          title: "Mixed validation task",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          outputPlan: [
            {
              action: "create",
              target: "api-doc.md",
              validationMethod: "file_content",
              description: "API documentation file",
            },
            {
              action: "modify",
              target: "non-existent-for-modify.json",
              validationMethod: "file_exists",
              description: "Update config",
            },
            {
              action: "delete",
              target: "deleted-temp.log",
              validationMethod: "file_exists",
              description: "Cleanup temp",
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
      expect(opChecks).toHaveLength(3);

      const createCheck = opChecks.find((c) => c.path === "api-doc.md");
      expect(createCheck!.status).toBe("passed");

      const modifyCheck = opChecks.find((c) => c.path === "non-existent-for-modify.json");
      expect(modifyCheck!.status).toBe("failed");

      const deleteCheck = opChecks.find((c) => c.path === "deleted-temp.log");
      expect(deleteCheck!.status).toBe("passed");
    });

    it("should include acceptance criteria checks on output plan items", async () => {
      await writeTextFile(
        join(tempDir, "criteria-output.txt"),
        "functional implementation with comprehensive tests",
      );

      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          {
            action: "create",
            target: "criteria-output.txt",
            validationMethod: "file_exists",
            acceptanceCriteria: [
              "Contains functional implementation",
              "Contains comprehensive tests",
            ],
          },
        ],
        { status: "done", exitCode: 0, output: "done", startedAt: now(), finishedAt: now() },
        tempDir,
      );

      expect(checks.length).toBeGreaterThanOrEqual(2);
      const acChecks = checks.filter((c) => c.criteria);
      expect(acChecks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("End-to-end flow: save → execute → validate with outputPlan", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "E2E Output Plan Flow", "auto");
      runId = run.runId;
    });

    it("should save tasks with outputPlan, execute (shell), and validate results", async () => {
      const outputPlan = [
        {
          action: "create" as const,
          target: "e2e-artifact.txt",
          validationMethod: "file_exists" as const,
          description: "E2E test artifact",
        },
        {
          action: "create" as const,
          target: "e2e-report.md",
          validationMethod: "file_content" as const,
          description: "E2E report with content",
        },
      ];

      const taskId = "e2e_op_flow_001";
      await api.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "E2E output plan task",
          status: "done" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["Output files created"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          outputPlan,
        },
      ]);

      const loaded = await api.loadTasks(runId);
      expect(loaded).toHaveLength(1);
      const task = loaded[0]!;
      expect(task.outputPlan).toBeDefined();
      expect(task.outputPlan).toHaveLength(2);

      await writeTextFile(join(testDir, "e2e-artifact.txt"), "artifact content");
      await writeTextFile(join(testDir, "e2e-report.md"), "# E2E Report\n\nSuccess.");

      const engine = new ValidationEngine();
      const result = await engine.validateTask({
        projectRoot: testDir,
        task,
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Created e2e-artifact.txt and e2e-report.md",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBeGreaterThanOrEqual(1);
      expect(opChecks.every((c) => c.status === "passed")).toBe(true);
    });

    it("should correctly report failed validation when outputs are missing", async () => {
      const taskId = "e2e_op_flow_fail_001";
      await api.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "E2E output plan fail task",
          status: "done" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          outputPlan: [
            {
              action: "create" as const,
              target: "missing-file.txt",
              validationMethod: "file_exists" as const,
            },
          ],
        },
      ]);

      const tasks = await api.loadTasks(runId);
      const task = tasks.find((t) => t.id === taskId)!;

      const engine = new ValidationEngine();
      const result = await engine.validateTask({
        projectRoot: testDir,
        task,
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "task executed",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const opChecks = result.checks.filter((c) => c.type === "output_plan");
      expect(opChecks.length).toBeGreaterThanOrEqual(1);
      expect(opChecks[0]!.status).toBe("failed");
      expect(opChecks[0]!.message).toContain("not created");
    });
  });

  describe("OutputPlan details and evidence", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "op-details-"));
      await ensureDir(tempDir);
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should include action and validation method in check details", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "any-file.txt", validationMethod: "file_exists" }],
        { status: "done", exitCode: 0, output: "", startedAt: now(), finishedAt: now() },
        tempDir,
      );

      expect(checks[0]!.details).toBeDefined();
      expect(checks[0]!.details!.action).toBe("create");
      expect(checks[0]!.details!.validationMethod).toBe("file_exists");
      expect(checks[0]!.details!.target).toBe("any-file.txt");
    });

    it("should include evidence string for passed checks", async () => {
      await writeTextFile(join(tempDir, "evidence-pass.txt"), "content");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "evidence-pass.txt", validationMethod: "file_exists" }],
        { status: "done", exitCode: 0, output: "", startedAt: now(), finishedAt: now() },
        tempDir,
      );

      expect(checks[0]!.evidence).toBeTruthy();
      expect(checks[0]!.evidence).toContain("exists");
    });

    it("should include evidence string for failed checks", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "not-created.txt", validationMethod: "file_exists" }],
        { status: "done", exitCode: 0, output: "", startedAt: now(), finishedAt: now() },
        tempDir,
      );

      expect(checks[0]!.evidence).toBeTruthy();
      expect(checks[0]!.evidence).toContain("does not exist");
    });
  });
});
