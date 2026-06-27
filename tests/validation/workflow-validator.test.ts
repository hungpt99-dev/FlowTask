import { describe, it, expect } from "vitest";
import { WorkflowValidator } from "../../src/validation/workflow-validator.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";

describe("WorkflowValidator", () => {
  const config = generateDefaultConfig();
  const validator = new WorkflowValidator(config);

  it("should validate a valid validation config", async () => {
    const result = await validator.validateValidationConfig({
      commands: ["pnpm test"],
      requiredFiles: ["src/file.ts"],
    });
    expect(result.valid).toBe(true);
  });

  it("should reject shell injection patterns in commands", async () => {
    const result = await validator.validateValidationConfig({
      commands: ["pnpm test $(rm -rf /)"],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("shell injection");
  });

  it("should accept empty validation config", async () => {
    const result = await validator.validateValidationConfig({});
    expect(result.valid).toBe(true);
  });
});
