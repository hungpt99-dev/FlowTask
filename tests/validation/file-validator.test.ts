import { describe, it, expect } from "vitest";
import { FileValidator } from "../../src/validation/file-validator.js";
import { testDir } from "../setup.js";

describe("FileValidator", () => {
  const validator = new FileValidator();

  it("should create an instance", () => {
    expect(validator).toBeInstanceOf(FileValidator);
  });

  it("should return failed check for non-existent files", async () => {
    const checks = await validator.validateFiles(testDir, ["non-existent-file.ts"]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("failed");
    expect(checks[0]?.path).toBe("non-existent-file.ts");
  });

  it("should handle multiple files", async () => {
    const checks = await validator.validateFiles(testDir, ["file1.ts", "file2.ts"]);
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.status === "failed")).toBe(true);
  });
});
