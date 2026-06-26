import { describe, it, expect, beforeAll } from "vitest";
import { ProjectManager } from "../../src/core/project-manager.js";
import { fileExists } from "../../src/utils/fs.js";
import { testDir } from "../setup.js";
import { join } from "node:path";

describe("ProjectManager", () => {
  let manager: ProjectManager;

  beforeAll(() => {
    manager = new ProjectManager();
  });

  it("should create project with correct structure", async () => {
    const projectDir = join(testDir, "init-test");
    const project = await manager.init(projectDir, "Test Project");
    expect(project.projectId).toBe("test-project");
    expect(project.name).toBe("Test Project");
    expect(project.rootPath).toBe(projectDir);

    const projectJsonExists = await fileExists(join(projectDir, ".flowtask", "project.json"));
    expect(projectJsonExists).toBe(true);

    const configExists = await fileExists(join(projectDir, ".flowtask", "config.json"));
    expect(configExists).toBe(true);
  });

  it("should load existing project", async () => {
    const projectDir = join(testDir, "load-test");
    await manager.init(projectDir, "Load Test");
    const loaded = await manager.load(projectDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("Load Test");
  });

  it("should return null for non-initialized directory", async () => {
    const loaded = await manager.load(join(testDir, "nonexistent-path"));
    expect(loaded).toBeNull();
  });

  it("should detect if project is initialized", async () => {
    const projectDir = join(testDir, "check-test");
    expect(await manager.isInitialized(projectDir)).toBe(false);
    await manager.init(projectDir, "Check Test");
    expect(await manager.isInitialized(projectDir)).toBe(true);
  });

  it("should create rule files during init", async () => {
    const projectDir = join(testDir, "rules-test");
    await manager.init(projectDir, "Rules Test");
    const { readDir } = await import("../../src/utils/fs.js");
    const rulesDir = join(projectDir, ".flowtask", "rules");
    const files = await readDir(rulesDir);
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files).toContain("project.md");
  });
});
