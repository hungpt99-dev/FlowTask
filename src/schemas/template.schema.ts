import { z } from "zod";
import { OutputPlanSchema } from "./output-plan.schema.js";

export const TemplateRiskLevelSchema = z.enum([
  "safe",
  "risky",
  "dangerous",
  "low",
  "medium",
  "high",
]);

export const TemplateTaskTypeSchema = z.enum([
  "general",
  "coding",
  "documentation",
  "research",
  "data",
  "writing",
  "design",
  "qa",
  "release",
  "operations",
  "testing",
  "analysis",
  "review",
  "approval",
  "validation",
]);

export const TemplateActionTypeSchema = z.enum([
  "create",
  "modify",
  "delete",
  "read",
  "analyze",
  "execute",
  "validate",
  "approve",
  "review",
  "transform",
  "generate",
  "investigate",
]);

export const TemplateExpectedOutputTypeSchema = z.enum([
  "code_change",
  "file",
  "document",
  "report",
  "summary",
  "research_result",
  "data_file",
  "data_change",
  "config_change",
  "command_result",
  "test_result",
  "build_result",
  "log_output",
  "decision",
  "checklist",
  "analysis",
  "recommendation",
  "translation",
  "design_artifact",
  "ui_change",
  "screenshot",
  "mixed_artifact",
]);

export const TemplateRetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).optional().default(2),
  retryDelayMs: z.number().int().min(0).optional().default(1000),
});

export const TemplateStepSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  taskType: TemplateTaskTypeSchema.optional().default("general"),
  actionType: TemplateActionTypeSchema.optional().default("execute"),
  executor: z.string().optional().default("shell"),
  dependsOn: z.array(z.string()).optional().default([]),
  inputContext: z.string().optional(),
  targetFiles: z.array(z.string()).optional().default([]),
  targetArtifacts: z.array(z.string()).optional().default([]),
  expectedResult: z.string().optional(),
  expectedOutputType: TemplateExpectedOutputTypeSchema.optional(),
  expectedOutputDescription: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).min(1),
  evidence: z.array(z.string()).optional().default([]),
  verificationCommand: z.string().optional(),
  validationMethod: z.string().optional().default("file_exists"),
  approvalRequired: z.boolean().optional().default(false),
  riskLevel: TemplateRiskLevelSchema.optional().default("safe"),
  retryPolicy: TemplateRetryPolicySchema.optional(),
  timeout: z.number().int().positive().optional(),
  finalOutputContribution: z.string().optional(),
  outputPlan: OutputPlanSchema.optional(),
});

export const WorkflowTemplateMetaSchema = z.object({
  requiresScan: z.boolean().optional().default(true),
  requiresApproval: z.boolean().optional().default(false),
  requiresCodegraph: z.boolean().optional().default(false),
  outputTypes: z.array(TemplateExpectedOutputTypeSchema).optional().default([]),
});

export const WorkflowTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  workflowType: z.string().min(1),
  category: z.string().min(1),
  version: z.string().optional().default("1.0"),
  tags: z.array(z.string()).optional().default([]),
  defaultMode: z.enum(["auto", "manual"]).optional().default("auto"),
  estimatedDuration: z.string().optional(),
  typicalSteps: z.number().int().positive().optional(),
  steps: z.array(TemplateStepSchema).min(1),
  metadata: WorkflowTemplateMetaSchema.optional().default({}),
});

export const WorkflowTemplateCollectionSchema = z.array(WorkflowTemplateSchema);

export type TemplateRiskLevel = z.infer<typeof TemplateRiskLevelSchema>;
export type TemplateTaskType = z.infer<typeof TemplateTaskTypeSchema>;
export type TemplateActionType = z.infer<typeof TemplateActionTypeSchema>;
export type TemplateExpectedOutputType = z.infer<typeof TemplateExpectedOutputTypeSchema>;
export type TemplateRetryPolicy = z.infer<typeof TemplateRetryPolicySchema>;
export type TemplateStep = z.infer<typeof TemplateStepSchema>;
export type WorkflowTemplateMeta = z.infer<typeof WorkflowTemplateMetaSchema>;
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;
