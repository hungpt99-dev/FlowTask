import crypto from "node:crypto";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import type { ValidationCheck } from "../schemas/validation.schema.js";
import { ValidationRunner } from "./validation-runner.js";
import { generateDefaultConfig } from "../config/default-config.js";

export class CommandValidator {
  private runner: ValidationRunner;

  constructor(config?: FlowTaskConfig) {
    this.runner = new ValidationRunner(config ?? generateDefaultConfig());
  }

  async validateCommands(commands: string[], cwd: string): Promise<ValidationCheck[]> {
    if (commands.length === 0) return [];

    const results = await this.runner.runValidation({
      commands,
      cwd,
      runId: `validation-${crypto.randomUUID()}`,
    });

    const checks: ValidationCheck[] = [];
    for (const r of results) {
      checks.push({
        type: "command",
        status: mapToCheckStatus(r.status),
        command: r.command,
        exitCode: r.exitCode,
        message: formatCommandMessage(r),
      });
    }

    this.runner.clearDedupeCache();
    return checks;
  }
}

function mapToCheckStatus(s: string): ValidationCheck["status"] {
  if (s === "passed") return "passed";
  if (s === "skipped") return "skipped";
  return "failed";
}

function formatCommandMessage(r: {
  command: string;
  status: string;
  exitCode?: number;
  error?: string;
  timedOut: boolean;
  cancelled: boolean;
}): string {
  if (r.status === "passed") return `Command passed: ${r.command}`;
  if (r.timedOut) return `Command timed out: ${r.command}`;
  if (r.cancelled) return `Command cancelled: ${r.command}`;
  if (r.status === "skipped") return `Command skipped (already completed): ${r.command}`;
  return `Command failed: ${r.command}\n  ${r.error ?? `exit code ${r.exitCode ?? "unknown"}`}`;
}
