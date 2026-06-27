import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";

describe("initCommand", () => {
  let projectDir: string;
  let originalCwd: string;

  beforeEach(() => {
    projectDir = join(testDir, `init-cmd-test-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("should initialize project with default mode when not TTY", async () => {
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false as unknown as boolean;

    try {
      await initCommand({});

      const projectJson = join(projectDir, ".flowtask", "project.json");
      expect(existsSync(projectJson)).toBe(true);
      const project = JSON.parse(readFileSync(projectJson, "utf-8"));
      expect(project.name).toBe("FlowTask Project");

      const configJson = join(projectDir, ".flowtask", "config.json");
      expect(existsSync(configJson)).toBe(true);
      const config = JSON.parse(readFileSync(configJson, "utf-8"));
      expect(config.projectMode).toBe("development");
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });

  it("should create .flowtask directory structure", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    try {
      await initCommand({ name: "MyProject" });

      expect(existsSync(join(projectDir, ".flowtask", "project.json"))).toBe(true);
      expect(existsSync(join(projectDir, ".flowtask", "config.json"))).toBe(true);
      expect(existsSync(join(projectDir, ".flowtask", "state.json"))).toBe(true);
      expect(existsSync(join(projectDir, ".flowtask", "run-index.json"))).toBe(true);
      expect(existsSync(join(projectDir, ".flowtask", "task-index.json"))).toBe(true);
      expect(existsSync(join(projectDir, ".flowtask", "rules"))).toBe(true);
      expect(existsSync(join(projectDir, ".flowtask", "steps"))).toBe(true);
    } finally {
      process.stdin.isTTY = false as unknown as boolean;
    }
  });

  it("should create mode rule file matching selected mode", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    try {
      await initCommand({ mode: "research" });
      const config = JSON.parse(
        readFileSync(join(projectDir, ".flowtask", "config.json"), "utf-8"),
      );
      expect(config.projectMode).toBe("research");
    } finally {
      process.stdin.isTTY = false as unknown as boolean;
    }
  });

  it("should preserve existing .gitignore during init", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    try {
      writeFileSync(join(projectDir, ".gitignore"), "node_modules/\n");
      await initCommand({});
      const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf-8");
      expect(gitignore).toBe("node_modules/\n");
    } finally {
      process.stdin.isTTY = false as unknown as boolean;
    }
  });

  it("should initialize without provider setup in non-TTY environment", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    try {
      await initCommand({});
      const config = JSON.parse(
        readFileSync(join(projectDir, ".flowtask", "config.json"), "utf-8"),
      );
      expect(config.projectMode).toBe("development");
      expect(existsSync(join(projectDir, ".env"))).toBe(false);
    } finally {
      process.stdin.isTTY = false as unknown as boolean;
    }
  });
});
