import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import { healthCheckCommand } from "../../src/cli/commands/healthcheck.js";

describe("healthCheckCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `healthcheck-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
    process.stdin.isTTY = false as unknown as boolean;

    originalExit = process.exit;
    process.exit = ((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    }) as typeof process.exit;

    output = "";
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    await initCommand({ name: "HealthCheckTest" });
    // Clear init output before healthcheck tests
    output = "";
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  it("should report healthy when project is initialized", async () => {
    try {
      await healthCheckCommand();
    } catch {
      // process.exit expected
    }

    expect(output).toContain("FlowTask Health Check");
    expect(output).toContain("Node.js version");
    expect(output).toContain("Project initialized");
    expect(output).toContain("Git available");
    expect(output).toContain(".flowtask structure");
    expect(output).toContain("Configuration");
  });

  it("should output JSON when --json option is set", async () => {
    try {
      await healthCheckCommand({ json: true });
    } catch {
      // process.exit expected
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed).toHaveProperty("overall");
    expect(parsed).toHaveProperty("checks");
    expect(parsed).toHaveProperty("summary");
    expect(parsed.checks).toBeInstanceOf(Array);
    expect(parsed.checks.length).toBeGreaterThanOrEqual(5);
  });

  it("should include node version check", async () => {
    try {
      await healthCheckCommand({ json: true });
    } catch {
      // process.exit expected
    }

    const parsed = JSON.parse(output.trim());
    const nodeCheck = parsed.checks.find((c: { name: string }) => c.name === "Node.js version");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck.status).toBe("healthy");
    expect(nodeCheck.details.version).toBe(process.version);
  });

  it("should include configuration check in report", async () => {
    try {
      await healthCheckCommand({ json: true });
    } catch {
      // process.exit expected
    }

    const parsed = JSON.parse(output.trim());
    const configCheck = parsed.checks.find((c: { name: string }) => c.name === "Configuration");
    expect(configCheck).toBeDefined();
    expect(configCheck.status).toBe("healthy");
  });

  it("should include git check in report", async () => {
    try {
      await healthCheckCommand({ json: true });
    } catch {
      // process.exit expected
    }

    const parsed = JSON.parse(output.trim());
    const gitCheck = parsed.checks.find((c: { name: string }) => c.name === "Git available");
    expect(gitCheck).toBeDefined();
  });
});
