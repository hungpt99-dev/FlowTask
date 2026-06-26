import { describe, it, expect, beforeAll } from "vitest";
import { ProjectManager } from "../../src/core/project-manager.js";
import { RunLifecycle } from "../../src/core/run-lifecycle.js";
import { RunManager } from "../../src/core/run-manager.js";
import { testDir } from "../setup.js";
import { join } from "node:path";

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
});
