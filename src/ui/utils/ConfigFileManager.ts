import { z } from "zod";
import {
  FlowTaskConfigSchema,
  RuleSourceConfigSchema,
  ApprovalConfigSchema,
  QualityConfigSchema,
  LimitsConfigSchema,
  ValidationConfigSchema,
  LoggingConfigSchema,
  ProjectModeSchema,
  HooksConfigSchema,
  ExecutorConfigSchema,
  ProcessConfigSchema,
  RiskConfigSchema,
} from "../../schemas/config.schema.js";
import { PlannerConfigSchema } from "../../schemas/planner.schema.js";
import { AiConfigSchema } from "../../ai/ai.schema.js";
import { UseCaseConfigSchema } from "../../usecase/usecase-types.js";
import { configJsonPath } from "../../utils/paths.js";
import { atomicWriteJsonFile, readJsonFile, fileExists } from "../../utils/fs.js";
import type { FlowTaskConfig } from "../../schemas/config.schema.js";

const SECTION_SCHEMAS: Record<string, z.ZodTypeAny | undefined> = {
  version: z.string(),
  projectMode: ProjectModeSchema,
  defaultExecutor: z.string(),
  runsDir: z.string(),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
  autoResume: z.boolean(),
  rules: RuleSourceConfigSchema,
  approval: ApprovalConfigSchema,
  quality: QualityConfigSchema,
  validation: ValidationConfigSchema,
  logging: LoggingConfigSchema,
  limits: LimitsConfigSchema,
  planner: PlannerConfigSchema,
  ai: AiConfigSchema,
  useCase: UseCaseConfigSchema,
  process: ProcessConfigSchema,
  executors: ExecutorConfigSchema,
  hooks: HooksConfigSchema,
  risk: RiskConfigSchema,
};

export interface ConfigValidationResult {
  valid: boolean;
  errors?: string[];
}

export class ConfigFileManager {
  constructor(private rootPath: string) {}

  async read(): Promise<FlowTaskConfig> {
    const cPath = configJsonPath(this.rootPath);
    const exists = await fileExists(cPath);
    if (!exists) {
      throw new Error(`Config file not found at ${cPath}`);
    }
    const raw = await readJsonFile<Record<string, unknown>>(cPath);
    const result = FlowTaskConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message);
      throw new Error(`Config validation failed: ${issues.join("; ")}`);
    }
    return result.data;
  }

  async get(key: string): Promise<unknown> {
    const config = await this.read();
    const value = (config as Record<string, unknown>)[key];
    if (value !== undefined) return value;
    const cPath = configJsonPath(this.rootPath);
    const raw = await readJsonFile<Record<string, unknown>>(cPath).catch(() => ({}));
    const result = FlowTaskConfigSchema.safeParse(raw);
    if (result.success) {
      return (result.data as Record<string, unknown>)[key];
    }
    return undefined;
  }

  async validate(changes: Partial<FlowTaskConfig>): Promise<ConfigValidationResult> {
    try {
      const base = FlowTaskConfigSchema.parse({});
      const merged = { ...base, ...changes } as Record<string, unknown>;
      const result = FlowTaskConfigSchema.safeParse(merged);
      if (!result.success) {
        return {
          valid: false,
          errors: result.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`),
        };
      }
      return { valid: true };
    } catch {
      return { valid: false, errors: ["Failed to validate config changes"] };
    }
  }

  async validateSection(section: string, data: unknown): Promise<ConfigValidationResult> {
    const schema = SECTION_SCHEMAS[section];
    if (!schema) {
      return { valid: false, errors: [`Unknown config section: "${section}"`] };
    }
    const result = schema.safeParse(data);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`),
      };
    }
    return { valid: true };
  }

  async update(changes: Partial<FlowTaskConfig>): Promise<FlowTaskConfig> {
    const merged = await this.mergeWithExisting(changes);
    const result = FlowTaskConfigSchema.safeParse(merged);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message);
      throw new Error(`Config validation failed: ${issues.join("; ")}`);
    }
    const cPath = configJsonPath(this.rootPath);
    await atomicWriteJsonFile(cPath, result.data, true);
    return result.data;
  }

  private async mergeWithExisting(
    changes: Partial<FlowTaskConfig>,
  ): Promise<Record<string, unknown>> {
    const cPath = configJsonPath(this.rootPath);
    let existing: Record<string, unknown> = {};
    const exists = await fileExists(cPath);
    if (exists) {
      existing = await readJsonFile<Record<string, unknown>>(cPath).catch(() => ({}));
    }
    return { ...existing, ...changes };
  }
}
