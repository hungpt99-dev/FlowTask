import { describe, it, expect } from "vitest";
import { generateRunId, generateTaskId, generateProjectId } from "../../src/utils/ids.js";

describe("ID generation", () => {
  it("should generate a run ID with timestamp and slug", () => {
    const id = generateRunId("Implement OCR module");
    expect(id).toMatch(/^run_\d{8}T\d{6}_implement_ocr_module$/);
  });

  it("should generate different run IDs for different titles", () => {
    const id1 = generateRunId("Feature A");
    const id2 = generateRunId("Feature B");
    expect(id1).not.toBe(id2);
  });

  it("should generate task IDs with task_ prefix", () => {
    const id = generateTaskId();
    expect(id).toMatch(/^task_[a-f0-9]{12}$/);
  });

  it("should generate unique task IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTaskId()));
    expect(ids.size).toBe(100);
  });

  it("should generate project IDs from name", () => {
    expect(generateProjectId("Guest Scan")).toBe("guest-scan");
    expect(generateProjectId("MyProject")).toBe("myproject");
    expect(generateProjectId("  Special  Project!  ")).toBe("special-project");
  });
});
