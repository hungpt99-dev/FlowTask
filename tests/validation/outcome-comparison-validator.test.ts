import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OutcomeComparisonValidator } from "../../src/validation/outcome-comparison-validator.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTextFile, ensureDir } from "../../src/utils/fs.js";

describe("OutcomeComparisonValidator", () => {
  const validator = new OutcomeComparisonValidator();

  it("should pass when expected result matches output and process succeeds", async () => {
    const check = await validator.validate(
      "Research report is saved to output.md",
      {
        status: "done",
        exitCode: 0,
        output: "Research report is saved to output.md",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(check.type).toBe("outcome_comparison");
    expect(check.status).toBe("passed");
    expect(check.details?.expectedResult).toBe("Research report is saved to output.md");
  });

  it("should fail when process fails and no evidence matches", async () => {
    const check = await validator.validate(
      "Research report is saved to output.md",
      {
        status: "failed",
        exitCode: 1,
        output: "something went wrong",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(check.status).toBe("failed");
    expect(check.message).toContain("not achieved");
  });

  it("should return warning when process passes but no evidence matches", async () => {
    const check = await validator.validate(
      "All stakeholders approve the final output",
      {
        status: "done",
        exitCode: 0,
        output: "some unrelated output about unrelated things",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(check.status).toBe("warning");
  });

  it("should pass for test-type expected result when process succeeds", async () => {
    const check = await validator.validate(
      "Type check, lint, and test commands all exit successfully",
      {
        status: "done",
        exitCode: 0,
        output: "all tests pass",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(check.status).toBe("passed");
  });

  it("should fail for test-type expected result when process fails", async () => {
    const check = await validator.validate(
      "Type check, lint, and test commands all exit successfully",
      {
        status: "failed",
        exitCode: 1,
        output: "lint errors found",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(check.status).toBe("failed");
  });

  it("should detect keywords when exact match is missing", async () => {
    const check = await validator.validate(
      "Implementation files have been created or modified with correct code",
      {
        status: "done",
        exitCode: 0,
        output: "Created new implementation files for the feature",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(check.status).toBe("passed");
  });

  describe("with file evidence", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "outcome-file-test-"));
      await ensureDir(tempDir);
      await writeTextFile(join(tempDir, "report.md"), "# Analysis Report\n\nFindings here.");
      await writeTextFile(join(tempDir, "output.txt"), "task results");
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should pass when all expected files exist with content", async () => {
      const check = await validator.validate(
        "Report file exists at report.md with summary of changes",
        {
          status: "done",
          exitCode: 0,
          output: "task completed",
          startedAt: now(),
          finishedAt: now(),
        },
        tempDir,
      );
      expect(check.status).toBe("passed");
      expect(check.evidence).toContain("Expected file exists with content: report.md");
    });

    it("should pass when expected file exists even if process failed", async () => {
      const check = await validator.validate(
        "Create report.md file with documentation",
        {
          status: "failed",
          exitCode: 1,
          output: "error",
          startedAt: now(),
          finishedAt: now(),
        },
        tempDir,
      );
      expect(check.status).toBe("passed");
    });

    it("should fail when expected files do not exist and process failed", async () => {
      const check = await validator.validate(
        "Generate missing-output.md with results",
        {
          status: "failed",
          exitCode: 1,
          output: "error",
          startedAt: now(),
          finishedAt: now(),
        },
        tempDir,
      );
      expect(check.status).toBe("failed");
    });

    it("should warn when some files exist but process failed", async () => {
      const check = await validator.validate(
        "Generate missing.txt and output.txt with task results",
        {
          status: "failed",
          exitCode: 1,
          output: "partial output",
          startedAt: now(),
          finishedAt: now(),
        },
        tempDir,
      );
      expect(check.status).toBe("warning");
    });
  });

  describe("with artifacts", () => {
    it("should pass when artifacts are produced with successful process", async () => {
      const check = await validator.validate(
        "Process the data and produce results",
        {
          status: "done",
          exitCode: 0,
          output: "processing complete",
          artifacts: ["results.json", "summary.md"],
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("passed");
    });

    it("should pass when artifact name matches expected result exactly", async () => {
      const check = await validator.validate(
        "results.json",
        {
          status: "done",
          exitCode: 0,
          output: "task done",
          artifacts: ["results.json"],
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("passed");
      expect(check.evidence).toContain("Artifact matches expected outcome: results.json");
    });

    it("should fail when process fails despite matching artifact (no output match)", async () => {
      const check = await validator.validate(
        "results.json",
        {
          status: "failed",
          exitCode: 1,
          output: "error occurred",
          artifacts: ["results.json"],
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("failed");
    });

    it("should fail when no artifacts and process failed", async () => {
      const check = await validator.validate(
        "Comprehensive analysis report",
        {
          status: "failed",
          exitCode: 1,
          output: "crash",
          artifacts: [],
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("failed");
    });
  });

  describe("result type classification", () => {
    it("should classify as test type and pass when process succeeds", async () => {
      const check = await validator.validate(
        "All lint and typecheck commands must pass without errors",
        {
          status: "done",
          exitCode: 0,
          output: "all lint checks pass",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("passed");
      expect(check.details?.resultType).toBe("test");
    });

    it("should classify as content type for documentation tasks", async () => {
      const check = await validator.validate(
        "API endpoints are documented with request/response examples",
        {
          status: "done",
          exitCode: 0,
          output: "Documented all API endpoints",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.details?.resultType).toBe("content");
    });

    it("should classify as command type for execution tasks", async () => {
      const check = await validator.validate(
        "Run the migration script and execute all pending changes",
        {
          status: "done",
          exitCode: 0,
          output: "Migration script executed successfully",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.details?.resultType).toBe("command");
    });

    it("should classify as mixed for expected results with multiple type indicators", async () => {
      const check = await validator.validate(
        "Run tests and generate report.md with results",
        {
          status: "done",
          exitCode: 0,
          output: "tests passed and report saved",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.details?.resultType).toBe("mixed");
    });
  });

  describe("evidence gathering edge cases", () => {
    it("should return warning when output is empty and process passed", async () => {
      const check = await validator.validate(
        "Very specific outcome that is not mentioned anywhere",
        {
          status: "done",
          exitCode: 0,
          output: "",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("warning");
      expect(check.message).toContain("not verifiable");
    });

    it("should return warning when expected result consists only of stop words", async () => {
      const check = await validator.validate(
        "This that then with from have been",
        {
          status: "done",
          exitCode: 0,
          output: "completely unrelated output about something else",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("warning");
    });

    it("should not treat URLs as file paths", async () => {
      const check = await validator.validate(
        "Fetch data from https://example.com/api/endpoint and save",
        {
          status: "done",
          exitCode: 0,
          output: "data fetched successfully",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("passed");
    });

    it("should handle output with undefined gracefully", async () => {
      const check = await validator.validate(
        "Task completed successfully",
        {
          status: "done",
          exitCode: 0,
          output: undefined as unknown as string,
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("warning");
    });

    it("should handle null exit code gracefully", async () => {
      const check = await validator.validate(
        "Build process completes with zero exit code",
        {
          status: "failed",
          exitCode: undefined as unknown as number,
          output: "something went wrong",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("failed");
    });

    it("should match key terms when exact match fails but keywords are present", async () => {
      const check = await validator.validate(
        "Implementation files have correct structure and follow conventions",
        {
          status: "done",
          exitCode: 0,
          output:
            "Modified files now follow project structure conventions with clean implementation",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("passed");
    });

    it("should warn when process passes but no output or keyword match", async () => {
      const check = await validator.validate(
        "Unlikely specific phrase with no keywords",
        {
          status: "done",
          exitCode: 0,
          output: "completely unrelated output about other things",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("warning");
    });
  });

  describe("verdict path coverage", () => {
    it("should pass when output matches and process passes", async () => {
      const check = await validator.validate(
        "Service layer refactored for testability",
        {
          status: "done",
          exitCode: 0,
          output: "Service layer refactored for testability",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("passed");
      expect(check.message).toContain("evidence found in output and process");
    });

    it("should warn when output matches but process fails", async () => {
      const check = await validator.validate(
        "Service layer refactored",
        {
          status: "failed",
          exitCode: 1,
          output: "Service layer refactored but with errors",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("warning");
      expect(check.message).toContain("process issues");
    });

    it("should fail for test-type when process fails", async () => {
      const check = await validator.validate(
        "All unit tests pass without failures",
        {
          status: "failed",
          exitCode: 1,
          output: "test failed",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.status).toBe("failed");
      expect(check.message).toContain("not achieved");
    });

    it("should include expectedResult in details", async () => {
      const check = await validator.validate(
        "Generate summary report",
        {
          status: "done",
          exitCode: 0,
          output: "summary report generated",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );
      expect(check.details?.expectedResult).toBe("Generate summary report");
    });
  });

  describe("file evidence edge cases", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = mkdtempSync(join(tmpdir(), "outcome-file-edge-"));
      await ensureDir(tempDir);
      await writeTextFile(join(tempDir, "result.json"), JSON.stringify({ status: "ok" }));
      await writeTextFile(join(tempDir, "report.md"), "# Report\n\nContent here.");
    });

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should reject file paths that attempt path traversal", async () => {
      const check = await validator.validate(
        "Create file at ../../../etc/passwd",
        {
          status: "done",
          exitCode: 0,
          output: "file created",
          startedAt: now(),
          finishedAt: now(),
        },
        tempDir,
      );
      expect(check.details?.filesExpected).toBe(0);
    });

    it("should pass when exact file paths in expected result match existing files", async () => {
      const check = await validator.validate(
        "Generate result.json with data",
        {
          status: "done",
          exitCode: 0,
          output: "data generated",
          startedAt: now(),
          finishedAt: now(),
        },
        tempDir,
      );
      expect(check.status).toBe("passed");
      expect(check.details?.filesFound).toBe(1);
    });

    it("should pass when all expected files exist with content even if process fails", async () => {
      const check = await validator.validate(
        "Generate report.md with analysis",
        {
          status: "failed",
          exitCode: 1,
          output: "generation had warnings",
          startedAt: now(),
          finishedAt: now(),
        },
        tempDir,
      );
      expect(check.status).toBe("passed");
      expect(check.message).toContain("All expected files exist");
    });
  });
});
