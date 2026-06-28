import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import {
  doctorCommand,
  doctorProvidersCommand,
  doctorValidationCommand,
} from "../../src/cli/commands/doctor.command.js";

describe("doctorCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let originalWrite: typeof process.stdout.write;
  let writeChunks: string[];
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `doctor-cmd-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
    process.stdin.isTTY = false as unknown as boolean;

    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    originalWrite = process.stdout.write;
    writeChunks = [];
    process.stdout.write = ((chunk: string) => {
      writeChunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    output = "";
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    await initCommand({ name: "DoctorTest" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
    process.stdout.write = originalWrite;
  });

  function fullOutput(): string {
    return output + writeChunks.join("");
  }

  it("should show doctor header and system checks", { timeout: 15000 }, async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("FlowTask Doctor");
    expect(fullOutput()).toContain("Node.js version");
    expect(fullOutput()).toContain("Project initialized");
    expect(fullOutput()).toContain("Git available");
    expect(fullOutput()).toContain(".flowtask structure");
  });

  it("should show planner mode and provider info", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("Planner");
    expect(fullOutput()).toContain("AI Providers");
    expect(fullOutput()).toContain("Validation");
  });

  it("should show project mode section", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("Project Mode");
    expect(fullOutput()).toContain("Mode");
  });

  it("should show AI CLI Executors section", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("AI CLI Executors");
  });

  it("should show providers-only mode with --providers flag", async () => {
    await doctorProvidersCommand();

    expect(fullOutput()).toContain("FlowTask Doctor");
    expect(fullOutput()).toContain("AI Providers");
  });

  it("should show validation section for doctor validation", async () => {
    await doctorValidationCommand();

    expect(fullOutput()).toContain("FlowTask Doctor");
    expect(fullOutput()).toContain("Validation");
    expect(fullOutput()).toContain("Profile");
  });

  it("should work without initialization", async () => {
    const uninitDir = join(testDir, `doctor-no-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);

    await doctorCommand();

    expect(fullOutput()).toContain("FlowTask Doctor");
  });
});
