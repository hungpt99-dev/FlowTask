import { describe, it, expect, beforeAll } from "vitest";
import { ProjectManager } from "../../src/core/project-manager.js";
import { RunLifecycle } from "../../src/core/run-lifecycle.js";
import { RunManager } from "../../src/core/run-manager.js";
import { testDir } from "../setup.js";
import { join } from "node:path";
import { generateDefaultConfig } from "../../src/config/default-config.js";

describe("RunLifecycle", () => {
  let projectDir: string;
  let projectId: string;

  beforeAll(async () => {
    projectDir = join(testDir, "lifecycle-test");
    const manager = new ProjectManager();
    const project = await manager.init(projectDir, "Lifecycle Test");
    projectId = project.projectId;
  });

  it("should execute a plan-only run", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.executeRun("Generate README file", { mode: "plan-only" });
    expect(result.run).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.run.status).toBe("planning");
  });

  it("should execute a dry-run", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.executeRun("Create a test file", { mode: "dry-run" });
    expect(result.success).toBe(true);
  });

  it("should create run files during plan-only", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.executeRun("Document the API", { mode: "plan-only" });
    const runManager = new RunManager(projectDir);
    const run = await runManager.loadRun(result.run.runId);
    expect(run).toBeDefined();

    const { fileExists } = await import("../../src/utils/fs.js");
    const { promptMdPath, planMdPath } = await import("../../src/utils/paths.js");
    expect(await fileExists(promptMdPath(projectDir, result.run.runId))).toBe(true);
    expect(await fileExists(planMdPath(projectDir, result.run.runId))).toBe(true);
  });

  describe("approval config propagation", () => {
    it("should accept auto approval mode option", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Auto approval test", {
        mode: "plan-only",
        approvalMode: "auto",
      });
      expect(result.success).toBe(true);
    });

    it("should accept skip approval mode option", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Skip approval test", {
        mode: "plan-only",
        approvalMode: "skip",
      });
      expect(result.success).toBe(true);
    });

    it("should accept manual approval mode option", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Manual approval test", {
        mode: "plan-only",
        approvalMode: "manual",
      });
      expect(result.success).toBe(true);
    });

    it("should work with autoApprove enabled in default config", async () => {
      const config = generateDefaultConfig();
      config.approval = { enabled: true, autoApprove: true, requireFor: [] };
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Auto approve config test", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });

    it("should work with approval disabled in default config", async () => {
      const config = generateDefaultConfig();
      config.approval = { enabled: false, autoApprove: false, requireFor: [] };
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Disabled approval config test", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("skip validation", () => {
    it("should accept --skip-validation flag in plan-only mode", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Skip validation test", {
        mode: "plan-only",
        skipValidation: true,
      });
      expect(result.success).toBe(true);
      expect(result.run.status).toBe("planning");
    });

    it("should default to validation enabled when not specified", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Default validation test", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });

    it("should work with dry-run and skipValidation", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Dry run skip validation", {
        mode: "dry-run",
        skipValidation: true,
      });
      expect(result.success).toBe(true);
    });

    it("should accept skipValidation via constructor option", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config, undefined, {
        skipValidation: true,
      });
      const result = await lifecycle.executeRun("Constructor skip validation", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });

    it("should accept skipValidation via config", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      config.validation!.skipValidation = true;
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Config skip validation", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });

    it("should be overridable via setSkipValidation", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      lifecycle.setSkipValidation(true);
      const result = await lifecycle.executeRun("SetSkipValidation test", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });
  });
});
