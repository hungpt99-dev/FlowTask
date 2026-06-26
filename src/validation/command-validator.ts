import type { ValidationCheck } from "../schemas/validation.schema.js";
import { spawnWithPromise } from "../utils/process.js";
import { getShell, getShellCommandFlag } from "../utils/shell.js";

export class CommandValidator {
  async validateCommands(commands: string[], cwd: string): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];
    for (const command of commands) {
      try {
        const result = await spawnWithPromise(getShell(), [getShellCommandFlag(), command], {
          cwd,
        });
        checks.push({
          type: "command",
          status: result.exitCode === 0 ? "passed" : "failed",
          command,
          exitCode: result.exitCode ?? undefined,
          message:
            result.exitCode === 0
              ? `Command passed: ${command}`
              : `Command failed: ${result.stderr.slice(0, 500) || command}`,
        });
      } catch (err) {
        checks.push({
          type: "command",
          status: "failed",
          command,
          message: `Command error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    return checks;
  }
}
