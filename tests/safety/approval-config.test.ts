import { describe, it, expect, beforeAll } from "vitest";
import { ApprovalConfigSchema, FlowTaskConfigSchema } from "../../src/schemas/config.schema.js";
import { ConfigLoader } from "../../src/config/config-loader.js";
import { testDir } from "../setup.js";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

describe("ApprovalConfig - autoApprove", () => {
  it("should default autoApprove to false", () => {
    const config = ApprovalConfigSchema.parse({});
    expect(config.autoApprove).toBe(false);
  });

  it("should accept autoApprove set to true", () => {
    const config = ApprovalConfigSchema.parse({ autoApprove: true });
    expect(config.autoApprove).toBe(true);
  });

  it("should accept autoApprove set to false", () => {
    const config = ApprovalConfigSchema.parse({ autoApprove: false });
    expect(config.autoApprove).toBe(false);
  });
});

describe("FlowTaskConfig - autoApprove integration", () => {
  it("should have autoApprove in approval config with default false", () => {
    const config = FlowTaskConfigSchema.parse({});
    expect(config.approval.autoApprove).toBe(false);
  });

  it("should load autoApprove from config object", () => {
    const config = FlowTaskConfigSchema.parse({
      approval: { autoApprove: true },
    });
    expect(config.approval.autoApprove).toBe(true);
  });
});

describe("ConfigLoader - autoApprove persistence", () => {
  let configDir: string;

  beforeAll(() => {
    configDir = join(testDir, "approval-config-test");
    const flowtaskDir = join(configDir, ".flowtask");
    mkdirSync(flowtaskDir, { recursive: true });
    writeFileSync(
      join(flowtaskDir, "config.json"),
      JSON.stringify({
        version: "1.0",
        approval: {
          enabled: true,
          autoApprove: true,
        },
      }),
    );
  });

  it("should load autoApprove from config file", async () => {
    const loader = new ConfigLoader();
    const config = await loader.load(configDir);
    expect(config.approval.autoApprove).toBe(true);
  });
});
