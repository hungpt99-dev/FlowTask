import { type FlowTaskConfig } from "../schemas/config.schema.js";

export const DEFAULT_EXECUTORS: Record<
  string,
  {
    type: string;
    command: string;
    args: string[];
    inputMode: string;
    timeoutMs: number;
  }
> = {
  opencode: {
    type: "command",
    command: "opencode",
    args: ["run"],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  claude: {
    type: "command",
    command: "claude",
    args: [],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  codex: {
    type: "command",
    command: "codex",
    args: [],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  gemini: {
    type: "command",
    command: "gemini",
    args: [],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  aider: {
    type: "command",
    command: "aider",
    args: ["--message"],
    inputMode: "argument",
    timeoutMs: 1800000,
  },
};

export function generateDefaultConfig(): FlowTaskConfig {
  return {
    version: "1.0",
    defaultExecutor: "opencode",
    runsDir: ".flowtask/runs",
    logLevel: "info",
    autoResume: true,
    rules: {
      enabled: true,
      paths: [
        ".flowtask/rules/*.md",
        "AGENTS.md",
        "CLAUDE.md",
        "docs/AI_AGENT_RULES.md",
        "docs/CODE_QUALITY.md",
        "docs/DEVELOPMENT.md",
        ".cursor/rules/*.mdc",
        ".github/copilot-instructions.md",
      ],
      required: false,
      maxFileSizeKb: 256,
    },
    approval: {
      enabled: true,
      requireFor: [
        "delete_file",
        "install_dependency",
        "git_push",
        "deploy",
        "database_migration",
        "read_sensitive_file",
      ],
    },
    quality: {
      enabledByDefault: false,
      commands: ["pnpm lint", "pnpm typecheck", "pnpm test"],
    },
    limits: {
      maxRunMinutes: 120,
      maxTaskMinutes: 30,
      maxRetries: 2,
      maxLogSizeMb: 20,
    },
    planner: {
      default: "auto",
      type: "internal-ai",
      executor: "opencode",
      provider: "openai",
      model: "gpt-4.1-mini",
      maxRetries: 1,
      fallbackToSimple: true,
    },
    ai: {
      providers: {
        openai: {
          type: "openai",
          apiKeyEnv: "OPENAI_API_KEY",
          baseUrl: "https://api.openai.com/v1",
        },
      },
    },
    process: {
      gracefulStopTimeoutMs: 5000,
      forceKillTimeoutMs: 10000,
    },
    executors: {
      shell: { type: "shell" as const, args: [], inputMode: "argument", timeoutMs: 1800000 },
      opencode: {
        type: "command",
        command: "opencode",
        args: ["run"],
        inputMode: "stdin",
        timeoutMs: 1800000,
      },
      claude: {
        type: "command",
        command: "claude",
        args: [],
        inputMode: "stdin",
        timeoutMs: 1800000,
      },
      codex: {
        type: "command",
        command: "codex",
        args: [],
        inputMode: "stdin",
        timeoutMs: 1800000,
      },
      gemini: {
        type: "command",
        command: "gemini",
        args: [],
        inputMode: "stdin",
        timeoutMs: 1800000,
      },
      aider: {
        type: "command",
        command: "aider",
        args: ["--message"],
        inputMode: "argument",
        timeoutMs: 1800000,
      },
      "mock-ai": {
        type: "command",
        command: "node",
        args: ["tests/fixtures/mock-ai-executor.mjs"],
        inputMode: "stdin",
        timeoutMs: 30000,
      },
    },
  };
}
