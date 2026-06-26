import type { FlowTaskConfig } from "../schemas/config.schema.js";

const HEAVY_COMMAND_PATTERNS = [
  /vitest/,
  /jest/,
  /playwright/,
  /cypress/,
  /test:e2e/,
  /test:integration/,
  /test:e2e:/,
  /test:integration:/,
  /nightwatch/,
  /webdriverio/,
  /wdio/,
  /karma/,
  /mocha.*--watch/,
  /ava.*--watch/,
  /tap.*--watch/,
];

const VITEST_PATTERNS = [/vitest/];

const WORKER_LIMIT_FLAGS = [
  /--maxWorkers/,
  /--minWorkers/,
  /--workers/,
  /--max-instances/,
  /--max-parallel/,
  /--parallel/,
  /--jobs/,
  /--shard/,
];

export interface ResourceGuardWarning {
  command: string;
  severity: "info" | "warning" | "error";
  message: string;
  suggestion?: string;
}

export class ResourceGuard {
  private config: FlowTaskConfig;

  constructor(config: FlowTaskConfig) {
    this.config = config;
  }

  inspect(command: string): ResourceGuardWarning[] {
    const warnings: ResourceGuardWarning[] = [];

    const isHeavy = HEAVY_COMMAND_PATTERNS.some((p) => p.test(command));
    if (!isHeavy) return warnings;

    const isVitest = VITEST_PATTERNS.some((p) => p.test(command));
    const hasWorkerLimit = WORKER_LIMIT_FLAGS.some((f) => f.test(command));

    if (isVitest) {
      const profile = this.config.validation?.profile ?? "safe";
      const resourceGuard = this.config.validation?.resourceGuard ?? true;

      if (!hasWorkerLimit && resourceGuard && profile !== "full") {
        warnings.push({
          command,
          severity: "warning",
          message:
            "Vitest command without worker limit — may spawn too many workers and consume excessive memory",
          suggestion: getVitestSafeSuggestion(command, this.config),
        });
      }

      if (profile === "safe" && !hasWorkerLimit) {
        warnings.push({
          command,
          severity: "info",
          message: "FlowTask will run Vitest in memory-safe mode",
          suggestion: getVitestSafeSuggestion(command, this.config),
        });
      }
    }

    if (isHeavy && !hasWorkerLimit) {
      warnings.push({
        command,
        severity: "info",
        message: "Heavy test command detected — will run serially with timeout protection",
      });
    }

    return warnings;
  }

  getSafeCommand(command: string): string {
    if (!VITEST_PATTERNS.some((p) => p.test(command))) return command;

    const profile = this.config.validation?.profile ?? "safe";
    if (profile === "full") return command;

    const maxWorkers = this.config.validation?.vitest?.maxWorkers ?? 1;
    const useRunMode = this.config.validation?.vitest?.runMode ?? true;

    const hasWorkerLimit = WORKER_LIMIT_FLAGS.some((f) => f.test(command));
    if (hasWorkerLimit) return command;

    if (useRunMode && !command.includes(" --run") && !command.includes("vitest run")) {
      return `${command} -- --run --maxWorkers=${maxWorkers}`;
    }

    return `${command} --maxWorkers=${maxWorkers}`;
  }

  isHeavy(command: string): boolean {
    return HEAVY_COMMAND_PATTERNS.some((p) => p.test(command));
  }
}

function getVitestSafeSuggestion(command: string, config: FlowTaskConfig): string {
  const maxWorkers = config.validation?.vitest?.maxWorkers ?? 1;
  if (
    command.startsWith("pnpm test") ||
    command.startsWith("npm test") ||
    command.startsWith("yarn test")
  ) {
    return `${command} -- --run --maxWorkers=${maxWorkers}`;
  }
  if (command.startsWith("pnpm vitest")) {
    return `${command} run --maxWorkers=${maxWorkers}`;
  }
  return `${command} --maxWorkers=${maxWorkers}`;
}
