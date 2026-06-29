import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OutputPlanValidator } from "../../src/validation/output-plan-validator.js";
import { now } from "../../src/utils/time.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTextFile, ensureDir } from "../../src/utils/fs.js";

const baseResult = {
  status: "done" as const,
  exitCode: 0,
  output: "",
  startedAt: now(),
  finishedAt: now(),
};

describe("OutputPlanValidator", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "opv-test-"));
    await ensureDir(tempDir);
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("file_exists validation", () => {
    it("should pass when a create target file exists", async () => {
      await writeTextFile(join(tempDir, "created.txt"), "new file content");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "created.txt", validationMethod: "file_exists" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
      expect(checks[0]?.type).toBe("output_plan");
      expect(checks[0]?.path).toBe("created.txt");
    });

    it("should fail when a create target file is missing", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "missing.txt", validationMethod: "file_exists" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("failed");
      expect(checks[0]?.message).toContain("not created");
    });

    it("should pass when a modify target file exists", async () => {
      await writeTextFile(join(tempDir, "modify-me.txt"), "original content");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "modify", target: "modify-me.txt", validationMethod: "file_exists" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
      expect(checks[0]?.message).toContain("exists for modification");
    });

    it("should fail when a modify target file is missing", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "modify", target: "ghost.txt", validationMethod: "file_exists" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("failed");
      expect(checks[0]?.message).toContain("not found for modification");
    });

    it("should pass when a delete target file has been removed", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "delete", target: "already-deleted.txt", validationMethod: "file_exists" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
      expect(checks[0]?.message).toContain("File deleted");
    });

    it("should fail when a delete target file still exists", async () => {
      await writeTextFile(join(tempDir, "should-be-deleted.txt"), "delete me");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "delete", target: "should-be-deleted.txt", validationMethod: "file_exists" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("failed");
      expect(checks[0]?.message).toContain("still exists");
    });

    it("should handle absolute paths", async () => {
      const absPath = join(tempDir, "absolute-path.txt");
      await writeTextFile(absPath, "absolute");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: absPath, validationMethod: "file_exists" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
    });
  });

  describe("file_content validation", () => {
    it("should pass when file has meaningful content (create)", async () => {
      await writeTextFile(join(tempDir, "report.md"), "# Analysis Report\n\nFindings here.");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "report.md", validationMethod: "file_content" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
    });

    it("should pass when file has meaningful content (modify)", async () => {
      await writeTextFile(join(tempDir, "updated.txt"), "modified content");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "modify", target: "updated.txt", validationMethod: "file_content" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
      expect(checks[0]?.message).toContain("Modified with content");
    });

    it("should fail when file is empty", async () => {
      await writeTextFile(join(tempDir, "empty.txt"), "");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "empty.txt", validationMethod: "file_content" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("failed");
      expect(checks[0]?.message).toContain("empty");
    });

    it("should fail when file has only whitespace", async () => {
      await writeTextFile(join(tempDir, "whitespace.txt"), "   \n  \n  ");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "whitespace.txt", validationMethod: "file_content" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("failed");
      expect(checks[0]?.message).toContain("no meaningful content");
    });

    it("should fail when file does not exist", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "nonexistent.md", validationMethod: "file_content" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("failed");
      expect(checks[0]?.message).toContain("not found");
    });
  });

  describe("command_output validation", () => {
    it("should pass when executor output mentions the target and action verb (create)", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "output.md", validationMethod: "command_output" }],
        { ...baseResult, output: "Created output.md with analysis results" },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
      expect(checks[0]?.message).toContain("mentions create of output.md");
    });

    it("should pass when executor output mentions the target and action verb (modify)", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "modify", target: "config.json", validationMethod: "command_output" }],
        { ...baseResult, output: "Updated config.json with new settings" },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
    });

    it("should pass when executor output mentions the target and action verb (delete)", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "delete", target: "temp.log", validationMethod: "command_output" }],
        { ...baseResult, output: "Removed temp.log as part of cleanup" },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
    });

    it("should return warning when output does not mention target", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "report.md", validationMethod: "command_output" }],
        { ...baseResult, output: "All tasks completed successfully" },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("warning");
    });

    it("should return warning when output does not contain matching action verb", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "delete", target: "report.md", validationMethod: "command_output" }],
        { ...baseResult, output: "report.md was checked and verified" },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("warning");
    });

    it("should handle empty executor output gracefully", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "output.txt", validationMethod: "command_output" }],
        { ...baseResult, output: "" },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("warning");
    });
  });

  describe("test validation", () => {
    it("should pass when process exit code is 0", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "any.txt", validationMethod: "test" }],
        { ...baseResult, exitCode: 0, output: "All tests passed" },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
    });

    it("should pass when file exists even if exit code is non-zero", async () => {
      await writeTextFile(join(tempDir, "artifact.txt"), "artifact data");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "artifact.txt", validationMethod: "test" }],
        { ...baseResult, exitCode: 1, output: "warnings" },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
    });

    it("should return warning when process failed and file does not exist", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "missing.txt", validationMethod: "test" }],
        { ...baseResult, exitCode: 1, output: "Tests failed" },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("warning");
    });

    it("should include acceptance criteria matches in evidence when file exists", async () => {
      await writeTextFile(join(tempDir, "test-evidence.txt"), "test passed results");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          {
            action: "create",
            target: "test-evidence.txt",
            validationMethod: "test",
            acceptanceCriteria: ["test passed"],
          },
        ],
        { ...baseResult, exitCode: 0, output: "All test passed successfully" },
        tempDir,
      );
      expect(checks).toHaveLength(2);
      const primaryCheck = checks.find((c) => c.type === "output_plan" && !c.criteria);
      expect(primaryCheck?.status).toBe("passed");
      expect(primaryCheck?.evidence).toContain("test passed");
      const acCheck = checks.find((c) => c.criteria === "test passed");
      expect(acCheck?.status).toBe("passed");
    });
  });

  describe("ai_review and manual validation", () => {
    it("should flag ai_review as warning with appropriate message", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "complex-report.md", validationMethod: "ai_review" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("warning");
      expect(checks[0]?.message).toContain("AI review needed");
      expect(checks[0]?.evidence).toContain("Flagged for AI review");
    });

    it("should flag manual as warning with appropriate message", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "modify", target: "sensitive-config.json", validationMethod: "manual" }],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("warning");
      expect(checks[0]?.message).toContain("Manual verification needed");
      expect(checks[0]?.evidence).toContain("Flagged for manual review");
    });
  });

  describe("acceptance criteria on output plan items", () => {
    it("should pass acceptance criteria when file content matches keywords", async () => {
      await writeTextFile(join(tempDir, "criteria.txt"), "functional implementation with tests");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          {
            action: "create",
            target: "criteria.txt",
            validationMethod: "file_exists",
            acceptanceCriteria: ["Contains functional implementation"],
          },
        ],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(2);
      const acCheck = checks.find((c) => c.criteria);
      expect(acCheck?.status).toBe("passed");
    });

    it("should return warning when acceptance criteria file does not exist", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          {
            action: "create",
            target: "non-existent-criteria.txt",
            validationMethod: "file_exists",
            acceptanceCriteria: ["Contains comprehensive analysis with detailed findings"],
          },
        ],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(2);
      const acCheck = checks.find(
        (c) => c.criteria === "Contains comprehensive analysis with detailed findings",
      );
      expect(acCheck?.status).toBe("warning");
    });

    it("should not add extra checks when acceptance criteria is empty", async () => {
      await writeTextFile(join(tempDir, "no-ac.txt"), "content");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          {
            action: "create",
            target: "no-ac.txt",
            validationMethod: "file_exists",
            acceptanceCriteria: [],
          },
        ],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
    });

    it("should handle multiple acceptance criteria where some criteria match file content", async () => {
      await writeTextFile(join(tempDir, "mixed-ac.txt"), "API documentation with endpoints");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          {
            action: "create",
            target: "mixed-ac.txt",
            validationMethod: "file_exists",
            acceptanceCriteria: [
              "Contains API documentation",
              "Contains exhaustive performance benchmarks",
            ],
          },
        ],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(3);
      const pasCriteria = checks.find((c) => c.criteria === "Contains API documentation");
      const secondaryCriterion = checks.find(
        (c) => c.criteria === "Contains exhaustive performance benchmarks",
      );
      expect(pasCriteria?.status).toBe("passed");
      expect(secondaryCriterion?.status).toBe("passed");
    });
  });

  describe("multiple output plan items", () => {
    it("should pass all items when all targets are satisfied", async () => {
      await writeTextFile(join(tempDir, "multi-1.txt"), "one");
      await writeTextFile(join(tempDir, "multi-2.txt"), "two");
      await writeTextFile(join(tempDir, "multi-3.txt"), "three");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          { action: "create", target: "multi-1.txt", validationMethod: "file_exists" },
          { action: "create", target: "multi-2.txt", validationMethod: "file_exists" },
          { action: "modify", target: "multi-3.txt", validationMethod: "file_exists" },
        ],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(3);
      expect(checks.every((c) => c.status === "passed")).toBe(true);
    });

    it("should report mixed results when some items fail", async () => {
      await writeTextFile(join(tempDir, "present.txt"), "present");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          { action: "create", target: "present.txt", validationMethod: "file_exists" },
          { action: "create", target: "absent.txt", validationMethod: "file_exists" },
        ],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(2);
      const passed = checks.find((c) => c.status === "passed");
      const failed = checks.find((c) => c.status === "failed");
      expect(passed?.path).toBe("present.txt");
      expect(failed?.path).toBe("absent.txt");
    });

    it("should handle items with different validation methods", async () => {
      await writeTextFile(join(tempDir, "report.md"), "# Report\n\nContent here.");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          { action: "create", target: "report.md", validationMethod: "file_exists" },
          { action: "modify", target: "config.json", validationMethod: "ai_review" },
          { action: "delete", target: "temp.log", validationMethod: "command_output" },
        ],
        { ...baseResult, output: "Deleted temp.log during cleanup" },
        tempDir,
      );
      expect(checks).toHaveLength(3);
      const fileExistsCheck = checks.find((c) => c.path === "report.md");
      const aiReviewCheck = checks.find((c) => c.path === "config.json");
      const cmdCheck = checks.find((c) => c.path === "temp.log");
      expect(fileExistsCheck?.status).toBe("passed");
      expect(aiReviewCheck?.status).toBe("warning");
      expect(cmdCheck?.status).toBe("passed");
    });
  });

  describe("edge cases", () => {
    it("should return empty array for empty output plan", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate([], baseResult, tempDir);
      expect(checks).toHaveLength(0);
    });

    it("should fail when create target already exists (create implies fresh output)", async () => {
      await writeTextFile(join(tempDir, "preexisting.txt"), "already here");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          {
            action: "create",
            target: "preexisting.txt",
            validationMethod: "file_exists",
          },
        ],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
    });

    it("should handle description field gracefully", async () => {
      await writeTextFile(join(tempDir, "desc-file.txt"), "with description");
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [
          {
            action: "create",
            target: "desc-file.txt",
            validationMethod: "file_exists",
            description: "The main output file for this task",
          },
        ],
        baseResult,
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("passed");
    });

    it("should handle executor with failed status and no output", async () => {
      const validator = new OutputPlanValidator();
      const checks = await validator.validate(
        [{ action: "create", target: "failed-output.txt", validationMethod: "command_output" }],
        {
          status: "failed" as const,
          exitCode: 1,
          output: "",
          startedAt: now(),
          finishedAt: now(),
        },
        tempDir,
      );
      expect(checks).toHaveLength(1);
      expect(checks[0]?.status).toBe("warning");
    });
  });
});
