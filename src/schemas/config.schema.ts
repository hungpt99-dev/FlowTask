import { z } from "zod";
import { PlannerConfigSchema } from "./planner.schema.js";
import { AiConfigSchema } from "../ai/ai.schema.js";
import { UseCaseConfigSchema } from "../usecase/usecase-types.js";

export const RuleSourceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  paths: z
    .array(z.string())
    .default([
      ".flowtask/rules/*.md",
      "AGENTS.md",
      "CLAUDE.md",
      "docs/agents/AI_AGENT_RULES.md",
      "docs/guides/CODE_QUALITY.md",
      "docs/guides/DEVELOPMENT.md",
      ".cursor/rules/*.mdc",
      ".github/copilot-instructions.md",
    ]),
  required: z.boolean().default(false),
  maxFileSizeKb: z.number().int().positive().default(256),
});

export const ApprovalGateActionSchema = z.enum([
  "delete_file",
  "install_dependency",
  "git_push",
  "git_commit",
  "deploy",
  "database_migration",
  "read_sensitive_file",
  "env_config_change",
  "external_api_call",
  "network_operation",
  "high_cost_ai_usage",
  "continue_after_repeated_failure",
  "skip_failed_validation",
  "override_validation_failure",
  "plan_execution",
]);

export const ApprovalGatesConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireFor: z
    .array(ApprovalGateActionSchema)
    .default([
      "delete_file",
      "install_dependency",
      "git_push",
      "git_commit",
      "deploy",
      "database_migration",
      "read_sensitive_file",
      "env_config_change",
      "external_api_call",
      "network_operation",
      "high_cost_ai_usage",
      "continue_after_repeated_failure",
      "override_validation_failure",
    ]),
  autoApproveFor: z.array(ApprovalGateActionSchema).default([]),
  riskThreshold: z.enum(["safe", "low", "medium", "high", "critical"]).default("medium"),
  requirePlanApproval: z.boolean().default(true),
  requireStepApproval: z.boolean().default(true),
  maxCostThreshold: z.number().min(0).default(0.5),
  notifyOnGateBlock: z.boolean().default(true),
});

export const ApprovalConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoApprove: z.boolean().default(false),
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
  gates: ApprovalGatesConfigSchema.optional(),
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

const RiskScoreSchema = z.enum(["none", "low", "medium", "high", "critical"]);

export const RiskConfigSchema = z.object({
  enabled: z.boolean().default(true),
  riskThreshold: RiskScoreSchema.default("medium"),
  maxRetries: z.number().int().min(0).default(5),
  maxExecutionTimeMs: z.number().int().positive().default(7200000),
  maxCostUsd: z.number().min(0).default(10),
  safeMode: z.boolean().default(false),
  readOnlyMode: z.boolean().default(false),
  maxFileChangeBytes: z.number().int().positive().default(1048576),
  warnOnSudo: z.boolean().default(true),
  warnOnMigration: z.boolean().default(true),
  warnOnGitPush: z.boolean().default(true),
  warnOnExternalNetwork: z.boolean().default(true),
  warnOnDependencyInstall: z.boolean().default(true),
  blockEnvFileAccess: z.boolean().default(true),
  blockProductionConfigChanges: z.boolean().default(true),
  blockFileDeletion: z.boolean().default(false),
  detectCredentials: z.boolean().default(true),
  protectedFilePatterns: z
    .array(z.string())
    .default([
      ".env",
      ".env.local",
      ".env.production",
      ".env.test",
      "id_rsa",
      "id_ed25519",
      "*.pem",
      "*.key",
      "config/production*",
      "secrets*",
      "credentials*",
      "*.cert",
      "*.keystore",
      "service-account*",
      ".credentials*",
      "docker-compose*.yml",
    ]),
  dangerousCommandPatterns: z.array(z.string()).default([]),
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
  maxConcurrentHeavy: z.number().int().min(1).default(1).optional(),
});

export const VitestConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxWorkers: z.number().int().min(1).default(1),
  runMode: z.boolean().default(true),
});

export const ValidationProfileSchema = z.enum(["quick", "safe", "full", "custom"]);

export const ValidationConfigSchema = z.object({
  profile: ValidationProfileSchema.default("safe"),
  skipValidation: z.boolean().optional(),
  adaptiveValidation: z.boolean().default(true),
  concurrency: z.number().int().min(1).default(1),
  timeoutMs: z.number().int().positive().default(300000),
  killGraceMs: z.number().int().positive().default(5000),
  dedupeCommands: z.boolean().default(true),
  resourceGuard: z.boolean().default(true),
  commands: z.array(z.string()).default([]),
  vitest: VitestConfigSchema.default({}),
  aiValidation: z.enum(["off", "fallback", "always", "high_risk_only"]).default("fallback"),
  aiProvider: z.string().optional(),
});

export const ShellHookEntrySchema = z.object({
  type: z.literal("shell"),
  command: z.string().refine((cmd) => !COMMAND_INJECTION_RE.test(cmd), {
    message: "Hook command must not contain shell injection patterns",
  }),
  timeoutMs: z.number().int().positive().default(30000),
});

export const ScriptHookEntrySchema = z.object({
  type: z.literal("script"),
  path: z.string().min(1, "Script path is required"),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().default(60000),
});

export const WebhookHookEntrySchema = z.object({
  type: z.literal("webhook"),
  url: z.string().url("Valid URL required for webhook hook"),
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
  headers: z.record(z.string()).default({}),
  timeoutMs: z.number().int().positive().default(10000),
});

export const HookEntrySchema = z.union([
  z.string(),
  ShellHookEntrySchema,
  ScriptHookEntrySchema,
  WebhookHookEntrySchema,
]);

export type HookEntry = z.infer<typeof HookEntrySchema>;
export type ShellHookEntry = z.infer<typeof ShellHookEntrySchema>;
export type ScriptHookEntry = z.infer<typeof ScriptHookEntrySchema>;
export type WebhookHookEntry = z.infer<typeof WebhookHookEntrySchema>;

export const HooksConfigSchema = z.object({
  beforeRun: z.array(HookEntrySchema).default([]),
  afterRun: z.array(HookEntrySchema).default([]),
  beforeTask: z.array(HookEntrySchema).default([]),
  afterTask: z.array(HookEntrySchema).default([]),
  beforeRetry: z.array(HookEntrySchema).default([]),
  afterRetry: z.array(HookEntrySchema).default([]),
  onFailure: z.array(HookEntrySchema).default([]),
  beforeScan: z.array(HookEntrySchema).default([]),
  afterScan: z.array(HookEntrySchema).default([]),
  beforePlan: z.array(HookEntrySchema).default([]),
  afterPlan: z.array(HookEntrySchema).default([]),
  beforeStep: z.array(HookEntrySchema).default([]),
  afterStep: z.array(HookEntrySchema).default([]),
  onStepFail: z.array(HookEntrySchema).default([]),
  onStepRetry: z.array(HookEntrySchema).default([]),
  onApprovalRequired: z.array(HookEntrySchema).default([]),
  beforeValidate: z.array(HookEntrySchema).default([]),
  afterValidate: z.array(HookEntrySchema).default([]),
  onArtifactCreated: z.array(HookEntrySchema).default([]),
  onFileChanged: z.array(HookEntrySchema).default([]),
  onRunComplete: z.array(HookEntrySchema).default([]),
  onRunFail: z.array(HookEntrySchema).default([]),
  onRunCancel: z.array(HookEntrySchema).default([]),
  failOnError: z.boolean().default(false),
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
  useCase: UseCaseConfigSchema.default({}),
  process: ProcessConfigSchema.default({}),
  executors: ExecutorConfigSchema.default({}),
  hooks: HooksConfigSchema.partial().default({}),
  risk: RiskConfigSchema.optional(),
});

export type FlowTaskConfig = z.infer<typeof FlowTaskConfigSchema>;
export type ExecutorEntry = z.infer<typeof ExecutorEntrySchema>;
