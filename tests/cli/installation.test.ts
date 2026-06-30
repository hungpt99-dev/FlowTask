import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { reinitializationConfirmation } from "../../src/cli/errors.js";

describe("installation and init", () => {
  let projectDir: string;
  let originalCwd: string;
  let output: string;

  beforeEach(() => {
    projectDir = join(testDir, `install-test-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
    output = "";
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("should initialize a new project in the current directory", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    await initCommand({});

    const projectJson = join(projectDir, ".flowtask", "project.json");
    expect(existsSync(projectJson)).toBe(true);
    const project = JSON.parse(readFileSync(projectJson, "utf-8"));
    expect(project.name).toBe("FlowTask Project");
    expect(existsSync(join(projectDir, ".flowtask", "config.json"))).toBe(true);
    expect(existsSync(join(projectDir, ".flowtask", "state.json"))).toBe(true);
    expect(existsSync(join(projectDir, ".flowtask", "run-index.json"))).toBe(true);
    expect(existsSync(join(projectDir, ".flowtask", "task-index.json"))).toBe(true);
    expect(existsSync(join(projectDir, ".flowtask", "rules"))).toBe(true);
    expect(existsSync(join(projectDir, ".flowtask", "steps"))).toBe(true);

    expect(output).toContain("FlowTask initialized");
    expect(output).toContain("Next steps");
  });

  it("should initialize with a custom project name", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    await initCommand({ name: "MyApp" });

    const project = JSON.parse(
      readFileSync(join(projectDir, ".flowtask", "project.json"), "utf-8"),
    );
    expect(project.name).toBe("MyApp");
  });

  it("should initialize with a specific mode", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    await initCommand({ mode: "research" });

    const config = JSON.parse(readFileSync(join(projectDir, ".flowtask", "config.json"), "utf-8"));
    expect(config.projectMode).toBe("research");
  });

  it("should show confirmation when already initialized without --force", async () => {
    process.stdin.isTTY = false as unknown as boolean;
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    try {
      await initCommand({});
      expect(existsSync(join(projectDir, ".flowtask", "project.json"))).toBe(true);

      await initCommand({});
      expect.unreachable("Should have thrown");
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("process.exit(0)");
      expect(output).toContain("already initialized");
    } finally {
      process.exit = originalExit;
    }
  });

  it("should force reinitialize with --force flag", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    await initCommand({ name: "Original" });

    await initCommand({ name: "Reinitialized", force: true });

    const project = JSON.parse(
      readFileSync(join(projectDir, ".flowtask", "project.json"), "utf-8"),
    );
    expect(project.name).toBe("Reinitialized");
  });

  it("should preserve .flowtask directories during reinit", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    await initCommand({ name: "First" });

    const testFile = join(projectDir, ".flowtask", "rules", "custom.md");
    writeFileSync(testFile, "# Custom rule\n");

    await initCommand({ force: true });

    expect(existsSync(testFile)).toBe(true);
    expect(existsSync(join(projectDir, ".flowtask", "project.json"))).toBe(true);
  });

  it("should reject invalid mode and exit with code 1", async () => {
    process.stdin.isTTY = false as unknown as boolean;
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    try {
      await initCommand({ mode: "invalid_mode" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });

  it("should show available modes with --showModes", async () => {
    await initCommand({ showModes: true });

    expect(output).toContain("Available init modes");
    expect(output).toContain("development");
    expect(output).toContain("writing");
    expect(output).toContain("research");
    expect(output).toContain("general");
  });

  it("should not overwrite existing .gitignore during init", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    writeFileSync(join(projectDir, ".gitignore"), "node_modules/\n.env\n");
    await initCommand({});

    const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toBe("node_modules/\n.env\n");
  });

  it("should use development mode by default in non-TTY environment", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    await initCommand({});

    const config = JSON.parse(readFileSync(join(projectDir, ".flowtask", "config.json"), "utf-8"));
    expect(config.projectMode).toBe("development");
  });

  it("should configure mode rules matching selected mode", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    await initCommand({ mode: "writing" });

    const modeRule = readFileSync(join(projectDir, ".flowtask", "rules", "mode.md"), "utf-8");
    expect(modeRule).toContain("writing");
    expect(modeRule).toContain("Mode Rules");
  });

  it("should generate project ID on init", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    await initCommand({ name: "IDTest" });

    const project = JSON.parse(
      readFileSync(join(projectDir, ".flowtask", "project.json"), "utf-8"),
    );
    expect(project.projectId).toBeDefined();
    expect(project.projectId).toContain("idtest");
  });

  it("should reinitialize without confirmation when --force flag used", async () => {
    process.stdin.isTTY = false as unknown as boolean;

    await initCommand({ name: "FirstInit" });

    const outputBefore = output;
    output = "";

    await initCommand({ force: true });

    expect(output).toContain("FlowTask initialized");
  });
});
