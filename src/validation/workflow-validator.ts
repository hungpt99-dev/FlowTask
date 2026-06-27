import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { ValidationConfigSchema } from "../schemas/task.schema.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export class WorkflowValidator {
  private config: FlowTaskConfig;

  constructor(config: FlowTaskConfig) {
    this.config = config;
  }

  async validateValidationConfig(config: Record<string, unknown>): Promise<ValidationResult> {
    const result = ValidationConfigSchema.safeParse(config);
    if (!result.success) {
      const error = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { valid: false, error };
    }

    return { valid: true };
  }
}
