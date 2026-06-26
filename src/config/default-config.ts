import { type FlowTaskConfig } from "../schemas/config.schema.js";

export function generateDefaultConfig(): FlowTaskConfig {
  return {
    version: "1.0",
    defaultExecutor: "shell",
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
      commands: ["pnpm lint", "pnpm typecheck", "pnpm test"],
    },
    limits: {
      maxRunMinutes: 120,
      maxTaskMinutes: 30,
      maxRetries: 2,
      maxLogSizeMb: 20,
    },
    executors: {
      shell: { type: "shell" },
      opencode: { type: "command", command: "opencode run" },
      claude: { type: "command", command: "claude" },
      codex: { type: "command", command: "codex" },
    },
  };
}
