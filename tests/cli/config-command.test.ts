import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { testDir } from "../setup.js";
import { initCommand } from "../../src/cli/commands/init.command.js";
import {
  configSetCommand,
  configGetCommand,
  configListCommand,
} from "../../src/cli/commands/config.command.js";

describe("configCommand", () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let output: string;

  beforeEach(async () => {
    projectDir = join(testDir, `config-cmd-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(projectDir);
    process.stdin.isTTY = false as unknown as boolean;

    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    output = "";
    console.log = (...args: string[]) => {
      output += args.join(" ") + "\n";
    };

    await initCommand({ name: "ConfigTest" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    process.stdin.isTTY = true as unknown as boolean;
  });

  describe("configListCommand", () => {
    it("should list configurable settings", async () => {
      await configListCommand();

      expect(output).toContain("Configurable settings");
      expect(output).toContain("approval.autoApprove");
    });
  });

  describe("configSetCommand", () => {
    it("should set approval.autoApprove to true", async () => {
      await configSetCommand("approval.autoApprove", "true");

      expect(output).toContain('Config "approval.autoApprove" set to true');
    });

    it("should set approval.autoApprove to false", async () => {
      await configSetCommand("approval.autoApprove", "false");

      expect(output).toContain('Config "approval.autoApprove" set to false');
    });

    it("should accept yes/no as boolean values", async () => {
      await configSetCommand("approval.autoApprove", "yes");

      expect(output).toContain("set to true");
    });

    it("should accept 1/0 as boolean values", async () => {
      await configSetCommand("approval.autoApprove", "1");

      expect(output).toContain("set to true");
    });

    it("should accept no as false boolean value", async () => {
      await configSetCommand("approval.autoApprove", "no");

      expect(output).toContain("set to false");
    });

    it("should accept 0 as false boolean value", async () => {
      await configSetCommand("approval.autoApprove", "0");

      expect(output).toContain("set to false");
    });

    it("should persist value change across set and get", async () => {
      await configSetCommand("approval.autoApprove", "yes");

      output = "";
      await configGetCommand("approval.autoApprove");

      expect(output).toContain("true");
    });

    it("should reject unknown config key", async () => {
      try {
        await configSetCommand("invalid.key", "true");
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });

    it("should reject invalid boolean value", async () => {
      try {
        await configSetCommand("approval.autoApprove", "notabool");
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });
  });

  describe("configGetCommand", () => {
    it("should show config value for valid key", async () => {
      await configGetCommand("approval.autoApprove");

      expect(output).toContain("approval.autoApprove");
    });

    it("should reject unknown key", async () => {
      try {
        await configGetCommand("invalid.key");
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit(1)");
      }
    });

    it("should show all config when no key specified", async () => {
      await configGetCommand();

      expect(output).toContain("Current configuration");
      expect(output).toContain("approval.autoApprove");
    });
  });

  describe("not initialized", () => {
    it("should exit when not initialized", async () => {
      const uninitDir = join(testDir, `not-init-${Date.now()}`);
      mkdirSync(uninitDir, { recursive: true });
      process.chdir(uninitDir);
      try {
        await configListCommand();
        expect.unreachable("Should have thrown");
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain("process.exit");
      }
    });
  });
});
