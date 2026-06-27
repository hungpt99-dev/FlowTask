import { describe, it, expect } from "vitest";
import { AcceptanceCriteriaValidator } from "../../src/validation/acceptance-criteria-validator.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";

describe("AcceptanceCriteriaValidator", () => {
  const validator = new AcceptanceCriteriaValidator();

  it("should return empty array for no criteria", async () => {
    const checks = await validator.validate(
      [],
      {
        status: "done",
        exitCode: 0,
        output: "",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks).toHaveLength(0);
  });

  it("should mark criteria as passed when text evidence and process success exist", async () => {
    const checks = await validator.validate(
      ["Research report is saved"],
      {
        status: "done",
        exitCode: 0,
        output: "Research report is saved to output.md",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]?.type).toBe("acceptance_criteria");
    expect(checks[0]?.status).toBe("passed");
    expect(checks[0]?.criteria).toBe("Research report is saved");
  });

  it("should mark criteria as warning when no evidence is found", async () => {
    const checks = await validator.validate(
      ["All stakeholders approve the final output"],
      {
        status: "done",
        exitCode: 0,
        output: "some unrelated output about unrelated things",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]?.type).toBe("acceptance_criteria");
    expect(checks[0]?.status).toBe("warning");
  });

  it("should handle multiple criteria with mixed results", async () => {
    const checks = await validator.validate(
      ["API endpoint is documented", "This criterion has no matching evidence"],
      {
        status: "done",
        exitCode: 0,
        output: "API endpoint is documented in the README",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks).toHaveLength(2);
    const matched = checks.find((c) => c.criteria === "API endpoint is documented");
    const unmatched = checks.find((c) => c.criteria === "This criterion has no matching evidence");
    expect(matched?.status).toBe("passed");
    expect(unmatched?.status).toBe("warning");
  });

  it("should check for file-like paths in criteria", async () => {
    const checks = await validator.validate(
      ["Create output.txt with results"],
      {
        status: "done",
        exitCode: 0,
        output: "task done",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]?.type).toBe("acceptance_criteria");
  });
});
