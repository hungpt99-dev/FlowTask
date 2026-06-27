import { z } from "zod";
import { PlannerConfigSchema } from "./planner.schema.js";
import { AiConfigSchema } from "../ai/ai.schema.js";

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
  enabledByDefault: z.boolean().default(false),
  commands: z.array(z.string()).default(["pnpm lint", "pnpm typecheck", "pnpm test"]),
});

export const LimitsConfigSchema = z.object({
  maxRunMinutes: z.number().int().positive().default(120),
  maxTaskMinutes: z.number().int().positive().default(30),
  maxRetries: z.number().int().min(0).default(2),
  maxLogSizeMb: z.number().int().positive().default(20),
});

const COMMAND_INJECTION_RE = /\$\(|`/;

export const ExecutorEntrySchema = z.object({
  type: z.enum(["shell", "command", "manual"]),
  command: z
    .string()
    .refine((cmd) => !COMMAND_INJECTION_RE.test(cmd), {
      message: "Executor command must not contain shell injection patterns",
    })
    .optional(),
  args: z.array(z.string()).optional().default([]),
  inputMode: z.enum(["argument", "stdin", "file"]).optional().default("argument"),
  fileArg: z.string().optional(),
  timeoutMs: z.number().int().positive().optional().default(1800000),
});

export const ExecutorConfigSchema = z.record(ExecutorEntrySchema);

export const ProcessConfigSchema = z.object({
  gracefulStopTimeoutMs: z.number().int().positive().default(5000),
  forceKillTimeoutMs: z.number().int().positive().default(10000),
});

export const VitestConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxWorkers: z.number().int().min(1).default(1),
  runMode: z.boolean().default(true),
});

export const ValidationProfileSchema = z.enum(["quick", "safe", "full", "custom"]);

export const ValidationConfigSchema = z.object({
  profile: ValidationProfileSchema.default("safe"),
  concurrency: z.number().int().min(1).default(1),
  timeoutMs: z.number().int().positive().default(300000),
  killGraceMs: z.number().int().positive().default(5000),
  dedupeCommands: z.boolean().default(true),
  resourceGuard: z.boolean().default(true),
  commands: z.array(z.string()).default([]),
  vitest: VitestConfigSchema.default({}),
});

export const LoggingConfigSchema = z.object({
  maxInMemoryLines: z.number().int().positive().default(500),
  maxLineLength: z.number().int().positive().default(4000),
});

export const ProjectModeSchema = z.enum(["development", "writing", "research", "general"]);

export const FlowTaskConfigSchema = z.object({
  version: z.string().default("1.0"),
  projectMode: ProjectModeSchema.default("development"),
  defaultExecutor: z.string().default("opencode"),
  runsDir: z.string().default(".flowtask/runs"),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  autoResume: z.boolean().default(true),
  rules: RuleSourceConfigSchema.default({}),
  approval: ApprovalConfigSchema.default({}),
  quality: QualityConfigSchema.default({}),
  validation: ValidationConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  limits: LimitsConfigSchema.default({}),
  planner: PlannerConfigSchema.default({
    default: "auto",
    type: "internal-ai",
    executor: "opencode",
    provider: "openai",
    model: "gpt-4.1-mini",
    maxRetries: 1,
    fallbackToSimple: true,
  }),
  ai: AiConfigSchema.default({}),
  process: ProcessConfigSchema.default({}),
  executors: ExecutorConfigSchema.default({}),
});

export type FlowTaskConfig = z.infer<typeof FlowTaskConfigSchema>;
export type ExecutorEntry = z.infer<typeof ExecutorEntrySchema>;
