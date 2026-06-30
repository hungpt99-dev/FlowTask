import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import {
  doctorCommand,
  doctorProvidersCommand,
  doctorValidationCommand,
} from "../../src/cli/commands/doctor.command.js";

vi.mock("../../src/utils/process.js", () => ({
  spawnWithPromise: vi.fn().mockResolvedValue({
    stdout: "git version 2.45.0",
    stderr: "",
    exitCode: 0,
  }),
}));

describe("FlowTask Doctor", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let originalWrite: typeof process.stdout.write;
  let writeChunks: string[];
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `doctor-test-${Date.now()}`);
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

  it("should show doctor header and system checks", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("FlowTask Doctor");
    expect(fullOutput()).toContain("Node.js version");
    expect(fullOutput()).toContain("Project initialized");
    expect(fullOutput()).toContain("Git available");
    expect(fullOutput()).toContain(".flowtask structure");
  });

  it("should show Project Mode section", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("Project Mode");
    expect(fullOutput()).toContain("Mode: development");
  });

  it("should show Planner section with provider info", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("Planner");
    expect(fullOutput()).toContain("Mode");
    expect(fullOutput()).toContain("Type");
    expect(fullOutput()).toContain("Provider");
    expect(fullOutput()).toContain("Model");
  });

  it("should show Validation section", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("Validation");
    expect(fullOutput()).toContain("Profile");
    expect(fullOutput()).toContain("Concurrency");
    expect(fullOutput()).toContain("Timeout");
  });

  it("should show AI CLI Executors section", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("AI CLI Executors");
  });

  it("should show Vitest section when vitest is in package.json", async () => {
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ devDependencies: { vitest: "^2.0.0" } }),
    );

    await doctorCommand();

    expect(fullOutput()).toContain("Vitest");
    expect(fullOutput()).toContain("detected");
  });

  it("should not show Vitest section when vitest not in package.json", async () => {
    writeFileSync(join(projectDir, "package.json"), JSON.stringify({}));

    await doctorCommand();

    expect(fullOutput()).toContain("vitest not detected");
  });

  it("should work without initialization", async () => {
    const uninitDir = join(testDir, `doctor-no-init-${Date.now()}`);
    mkdirSync(uninitDir, { recursive: true });
    process.chdir(uninitDir);

    await doctorCommand();

    expect(fullOutput()).toContain("FlowTask Doctor");
  });

  it("should show providers-only mode with providers flag", async () => {
    await doctorProvidersCommand();

    expect(fullOutput()).toContain("FlowTask Doctor");
    expect(fullOutput()).toContain("AI Providers");
  });

  it("should show validation section for doctor validation command", async () => {
    await doctorValidationCommand();

    expect(fullOutput()).toContain("FlowTask Doctor");
    expect(fullOutput()).toContain("Validation");
    expect(fullOutput()).toContain("Profile");
  });

  it("should report AI Providers section", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("AI Providers");
  });

  it("should report Node.js version check with version number", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("Node.js version");
    const full = fullOutput();
    expect(full).toMatch(/v\d+/);
  });

  it("should show rules and steps file presence", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("Mode rules");
    expect(fullOutput()).toContain("Steps");
  });

  it("should report planned executor availability", async () => {
    await doctorCommand();

    expect(fullOutput()).toContain("AI CLI Executors");
    expect(fullOutput()).toContain("shell");
  });
});
