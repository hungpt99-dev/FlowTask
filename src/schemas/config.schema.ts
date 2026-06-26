import { z } from "zod";

export const RuleSourceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  paths: z
    .array(z.string())
    .default([
      ".flowtask/rules/*.md",
      "AGENTS.md",
      "CLAUDE.md",
      "docs/AI_AGENT_RULES.md",
      "docs/CODE_QUALITY.md",
      "docs/DEVELOPMENT.md",
      ".cursor/rules/*.mdc",
      ".github/copilot-instructions.md",
    ]),
  required: z.boolean().default(false),
  maxFileSizeKb: z.number().int().positive().default(256),
});

export const ApprovalConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireFor: z
    .array(z.string())
    .default([
      "delete_file",
      "install_dependency",
      "git_push",
      "deploy",
      "database_migration",
      "read_sensitive_file",
    ]),
});

export const QualityConfigSchema = z.object({
  commands: z.array(z.string()).default(["pnpm lint", "pnpm typecheck", "pnpm test"]),
});

export const LimitsConfigSchema = z.object({
  maxRunMinutes: z.number().int().positive().default(120),
  maxTaskMinutes: z.number().int().positive().default(30),
  maxRetries: z.number().int().min(0).default(2),
  maxLogSizeMb: z.number().int().positive().default(20),
});

export const ExecutorConfigSchema = z.record(
  z.object({
    type: z.enum(["shell", "command"]),
    command: z.string().optional(),
  }),
);

export const FlowTaskConfigSchema = z.object({
  version: z.string().default("1.0"),
  defaultExecutor: z.string().default("shell"),
  runsDir: z.string().default(".flowtask/runs"),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  autoResume: z.boolean().default(true),
  rules: RuleSourceConfigSchema.default({}),
  approval: ApprovalConfigSchema.default({}),
  quality: QualityConfigSchema.default({}),
  limits: LimitsConfigSchema.default({}),
  executors: ExecutorConfigSchema.default({}),
});

export type FlowTaskConfig = z.infer<typeof FlowTaskConfigSchema>;
