import path from "node:path";
import { ProjectScanner, type ProjectMetadata } from "./project-scanner.js";
import { GitScanner, type GitStatus } from "./git-scanner.js";
import { KeywordScanner, type KeywordMatch } from "./keyword-scanner.js";
import { CodeGraphScanner, type CodeGraph } from "./codegraph-scanner.js";
import { TestScanner, type TestScanResult } from "./test-scanner.js";
import { WorkspaceScanner, type CompactContext, FileType } from "../core/scanner.js";
import { UseCaseDetector } from "../usecase/usecase-detector.js";
import type { UseCaseDetection } from "../usecase/usecase-types.js";

export type TaskType =
  | "general"
  | "code"
  | "documentation"
  | "research"
  | "data"
  | "writing"
  | "design"
  | "business_analysis"
  | "qa"
  | "release"
  | "operations"
  | "mixed";

export type WorkflowType =
  | "general"
  | "code_implementation"
  | "bug_fix"
  | "refactor"
  | "test_generation"
  | "documentation"
  | "research"
  | "business_analysis"
  | "requirement_analysis"
  | "product_planning"
  | "data_analysis"
  | "data_transformation"
  | "data_cleanup"
  | "writing"
  | "translation"
  | "design"
  | "qa_checklist"
  | "release_checklist"
  | "meeting_summary"
  | "report_generation"
  | "prompt_engineering"
  | "operations"
  | "mixed";

export interface ContextItem {
  path: string;
  type: string;
  summary: string;
  relevance: number;
}

export interface PreviousDecision {
  description: string;
  reasoning: string;
  confidence: number;
}

export interface Risk {
  description: string;
  level: "low" | "medium" | "high" | "critical";
  mitigation: string;
}

export interface Constraint {
  description: string;
  type: "time" | "resource" | "technical" | "business" | "security";
}

export interface ExpectedOutput {
  type: string;
  description: string;
  validationMethod: string;
}

export interface ValidationMethod {
  type: string;
  description: string;
}

export interface PlanningHint {
  description: string;
  priority: "low" | "medium" | "high";
}

export interface TaskContext {
  userGoal: string;
  taskType: TaskType;
  workflowType: WorkflowType;

  contextItems: ContextItem[];
  relevantFiles: string[];
  relevantDocuments: string[];
  relevantArtifacts: string[];
  relevantDataFiles: string[];
  relatedCommands: string[];

  previousDecisions: PreviousDecision[];
  risks: Risk[];
  constraints: Constraint[];

  expectedOutputs: ExpectedOutput[];
  validationMethods: ValidationMethod[];
  planningHints: PlanningHint[];

  confidenceScore: number;

  compactText: string;

  projectMeta: ProjectMetadata;
  gitStatus: GitStatus;
  keywordMatches: KeywordMatch[];
  codeGraph: CodeGraph | null;
  testResult: TestScanResult | null;
  contextPack: string;
}

export interface TaskContextBuilderOptions {
  cacheDir?: string;
  useCache?: boolean;
}

const USE_CASE_TO_TASK_TYPE: Record<string, TaskType> = {
  coding: "code",
  documentation: "documentation",
  debugging: "code",
  research: "research",
  planning: "business_analysis",
  "project-setup": "code",
  testing: "qa",
  devops: "operations",
  "data-analysis": "data",
  "ui-design": "design",
  writing: "writing",
  general: "general",
};

const USE_CASE_TO_WORKFLOW_TYPE: Record<string, WorkflowType> = {
  coding: "code_implementation",
  documentation: "documentation",
  debugging: "bug_fix",
  research: "research",
  planning: "product_planning",
  "project-setup": "code_implementation",
  testing: "test_generation",
  devops: "operations",
  "data-analysis": "data_analysis",
  "ui-design": "design",
  writing: "writing",
  general: "general",
};

const TASK_TYPE_HINTS: Record<TaskType, PlanningHint[]> = {
  general: [
    { description: "Adapt the approach based on the specific user request", priority: "medium" },
  ],
  code: [
    { description: "Focus on type safety, conventions, and test coverage", priority: "high" },
    { description: "Check for existing patterns before creating new ones", priority: "medium" },
  ],
  documentation: [
    { description: "Focus on clarity, completeness, and audience needs", priority: "high" },
    { description: "Review existing docs for consistency before writing", priority: "medium" },
  ],
  research: [
    { description: "Separate facts from assumptions and track sources", priority: "high" },
    { description: "Define clear research questions before gathering data", priority: "medium" },
  ],
  data: [
    { description: "Validate data quality and schema before transformation", priority: "high" },
    { description: "Document assumptions about data integrity", priority: "medium" },
  ],
  writing: [
    { description: "Follow tone and style guidelines for the content type", priority: "high" },
    { description: "Review for clarity, grammar, and structure", priority: "medium" },
  ],
  design: [
    {
      description: "Focus on visual consistency, accessibility, and responsiveness",
      priority: "high",
    },
    { description: "Check against design system if one exists", priority: "medium" },
  ],
  business_analysis: [
    { description: "Identify stakeholders, risks, and acceptance criteria", priority: "high" },
    { description: "Document decisions and rationale", priority: "medium" },
  ],
  qa: [
    { description: "Plan edge cases, negative tests, and boundary conditions", priority: "high" },
    { description: "Ensure coverage of critical paths first", priority: "medium" },
  ],
  release: [
    { description: "Verify all checks and approvals before release", priority: "high" },
    { description: "Prepare rollback plan alongside the release", priority: "medium" },
  ],
  operations: [
    { description: "Validate changes in staging before production", priority: "high" },
    { description: "Ensure monitoring and alerting are in place", priority: "medium" },
  ],
  mixed: [
    {
      description: "Identify which task types are involved and plan accordingly",
      priority: "high",
    },
    { description: "Coordinate cross-domain dependencies early", priority: "medium" },
  ],
};

const WORKFLOW_TYPE_RISKS: Record<WorkflowType, Risk[]> = {
  general: [],
  code_implementation: [
    {
      description: "New code may introduce regressions",
      level: "medium",
      mitigation: "Ensure test coverage and run existing tests",
    },
    {
      description: "Architecture drift from existing patterns",
      level: "medium",
      mitigation: "Review existing patterns before implementation",
    },
  ],
  bug_fix: [
    {
      description: "Fix may introduce side effects in other areas",
      level: "medium",
      mitigation: "Run full test suite after fix",
    },
    {
      description: "Root cause may be deeper than initial analysis",
      level: "high",
      mitigation: "Investigate thoroughly before applying fix",
    },
  ],
  refactor: [
    {
      description: "Refactoring may break existing functionality",
      level: "high",
      mitigation: "Ensure comprehensive test coverage before refactoring",
    },
    {
      description: "Scope creep may expand beyond original intent",
      level: "medium",
      mitigation: "Define clear boundaries for the refactor",
    },
  ],
  test_generation: [
    {
      description: "Tests may not cover real edge cases",
      level: "medium",
      mitigation: "Review test cases against requirements",
    },
    {
      description: "Tests may be flaky or non-deterministic",
      level: "medium",
      mitigation: "Ensure tests are isolated and deterministic",
    },
  ],
  documentation: [
    {
      description: "Documentation may become outdated quickly",
      level: "low",
      mitigation: "Reference specific versions and include timestamps",
    },
  ],
  research: [
    {
      description: "Findings may be incomplete or biased",
      level: "medium",
      mitigation: "Use multiple sources and cross-reference",
    },
    {
      description: "Facts may be mistaken for assumptions",
      level: "medium",
      mitigation: "Clearly label facts vs assumptions",
    },
  ],
  business_analysis: [
    {
      description: "Requirements may be incomplete or ambiguous",
      level: "high",
      mitigation: "Seek clarification on unclear requirements",
    },
  ],
  requirement_analysis: [
    {
      description: "Implied requirements may be missed",
      level: "high",
      mitigation: "Ask clarifying questions for ambiguous areas",
    },
  ],
  product_planning: [
    {
      description: "Plan may miss edge cases or dependencies",
      level: "medium",
      mitigation: "Review plan for completeness before execution",
    },
  ],
  data_analysis: [
    {
      description: "Data quality issues may affect conclusions",
      level: "high",
      mitigation: "Profile and validate data before analysis",
    },
  ],
  data_transformation: [
    {
      description: "Data loss or corruption during transformation",
      level: "high",
      mitigation: "Backup source data and validate output",
    },
  ],
  data_cleanup: [
    {
      description: "Important data may be accidentally removed",
      level: "critical",
      mitigation: "Backup data before cleanup and validate results",
    },
  ],
  writing: [
    {
      description: "Tone may not match the target audience",
      level: "low",
      mitigation: "Review for tone and audience appropriateness",
    },
  ],
  translation: [
    {
      description: "Nuance or context may be lost in translation",
      level: "medium",
      mitigation: "Have a native speaker review the translation",
    },
  ],
  design: [
    {
      description: "Design may not be accessible to all users",
      level: "medium",
      mitigation: "Check accessibility guidelines and contrast ratios",
    },
  ],
  qa_checklist: [
    {
      description: "Checklist may miss important test scenarios",
      level: "medium",
      mitigation: "Review against requirements and common failure patterns",
    },
  ],
  release_checklist: [
    {
      description: "Critical step may be missed during release",
      level: "critical",
      mitigation: "Automate checklist validation where possible",
    },
  ],
  meeting_summary: [
    {
      description: "Summary may miss key decisions or action items",
      level: "low",
      mitigation: "Review with meeting participants for accuracy",
    },
  ],
  report_generation: [
    {
      description: "Report may contain outdated or incorrect data",
      level: "medium",
      mitigation: "Verify data freshness and accuracy before finalizing",
    },
  ],
  prompt_engineering: [
    {
      description: "Prompt may not produce the intended output",
      level: "medium",
      mitigation: "Test and iterate on the prompt before use",
    },
  ],
  operations: [
    {
      description: "Configuration changes may affect live systems",
      level: "critical",
      mitigation: "Test in staging before applying to production",
    },
  ],
  mixed: [
    {
      description: "Cross-domain dependencies may cause coordination issues",
      level: "high",
      mitigation: "Identify inter-domain dependencies early in planning",
    },
    {
      description: "Different domains may conflict in requirements",
      level: "medium",
      mitigation: "Review all requirements holistically",
    },
  ],
};

const WORKFLOW_VALIDATIONS: Record<WorkflowType, ValidationMethod[]> = {
  general: [{ type: "acceptance_criteria", description: "Verify against acceptance criteria" }],
  code_implementation: [
    { type: "test", description: "Run test suite" },
    { type: "file_diff", description: "Verify file changes match plan" },
    { type: "acceptance_criteria", description: "Verify against acceptance criteria" },
  ],
  bug_fix: [
    { type: "test", description: "Run test suite to confirm fix and check regressions" },
    { type: "acceptance_criteria", description: "Verify the bug is fixed per criteria" },
  ],
  refactor: [
    { type: "test", description: "Run test suite to verify no behavioral changes" },
    { type: "command_output", description: "Run type check and lint" },
  ],
  test_generation: [
    { type: "test", description: "Run the new tests to confirm they pass" },
    { type: "acceptance_criteria", description: "Verify test coverage meets criteria" },
  ],
  documentation: [
    { type: "file_exists", description: "Verify document files were created" },
    { type: "ai_review", description: "Review document for clarity and completeness" },
  ],
  research: [
    { type: "ai_review", description: "Review findings for accuracy and completeness" },
    { type: "acceptance_criteria", description: "Verify research questions are answered" },
  ],
  business_analysis: [
    { type: "acceptance_criteria", description: "Verify all requirements are covered" },
    { type: "ai_review", description: "Review analysis for completeness" },
  ],
  requirement_analysis: [
    { type: "acceptance_criteria", description: "Verify all requirements are identified" },
  ],
  product_planning: [
    { type: "acceptance_criteria", description: "Verify plan covers all requirements" },
  ],
  data_analysis: [
    { type: "command_output", description: "Verify analysis scripts ran successfully" },
    { type: "file_exists", description: "Verify output files exist" },
  ],
  data_transformation: [
    { type: "command_output", description: "Verify transformation completed" },
    { type: "file_diff", description: "Verify data changes" },
  ],
  data_cleanup: [
    { type: "command_output", description: "Verify cleanup completed" },
    { type: "file_diff", description: "Verify cleanup changes" },
  ],
  writing: [
    { type: "file_exists", description: "Verify document files exist" },
    { type: "ai_review", description: "Review for tone, clarity, and structure" },
  ],
  translation: [
    { type: "file_exists", description: "Verify translated files exist" },
    { type: "ai_review", description: "Review translation accuracy" },
  ],
  design: [
    { type: "file_exists", description: "Verify design artifacts exist" },
    { type: "ai_review", description: "Review design against requirements" },
  ],
  qa_checklist: [
    { type: "acceptance_criteria", description: "Verify checklist covers all test areas" },
  ],
  release_checklist: [
    { type: "acceptance_criteria", description: "Verify all release steps are addressed" },
  ],
  meeting_summary: [
    { type: "file_exists", description: "Verify summary document exists" },
    { type: "ai_review", description: "Review summary for completeness" },
  ],
  report_generation: [
    { type: "file_exists", description: "Verify report file exists" },
    { type: "acceptance_criteria", description: "Verify report covers all required sections" },
  ],
  prompt_engineering: [
    { type: "file_exists", description: "Verify prompt file exists" },
    { type: "ai_review", description: "Review prompt for clarity and effectiveness" },
  ],
  operations: [
    { type: "command_output", description: "Verify operation commands succeeded" },
    { type: "acceptance_criteria", description: "Verify operational requirements met" },
  ],
  mixed: [
    { type: "acceptance_criteria", description: "Verify against acceptance criteria" },
    { type: "ai_review", description: "Review overall coherence of mixed workflow" },
  ],
};

const MAX_CONTEXT_ITEMS_IN_COMPACT = 50;
const MAX_CONTEXT_ITEM_SUMMARY_LENGTH = 150;

export class TaskContextBuilder {
  private projectScanner: ProjectScanner;
  private gitScanner: GitScanner;
  private keywordScanner: KeywordScanner;
  private codeGraphScanner: CodeGraphScanner;
  private testScanner: TestScanner;
  private workspaceScanner: WorkspaceScanner;
  private useCaseDetector: UseCaseDetector;
  private cacheDir: string | undefined;

  constructor(options?: TaskContextBuilderOptions) {
    const cacheDir = options?.cacheDir;
    const useCache = options?.useCache ?? true;
    const cache = cacheDir && useCache ? { cacheDir, useCache } : undefined;

    this.cacheDir = cacheDir;
    this.projectScanner = new ProjectScanner(cache ? { cache } : undefined);
    this.gitScanner = new GitScanner(cache ? { cache } : undefined);
    this.keywordScanner = new KeywordScanner(cache ? { cache } : undefined);
    this.codeGraphScanner = new CodeGraphScanner(cache ? { cache } : undefined);
    this.testScanner = new TestScanner(cache ? { cache } : undefined);
    this.workspaceScanner = new WorkspaceScanner({
      cacheDir,
      useCache,
    });
    this.useCaseDetector = new UseCaseDetector();
  }

  async build(projectRoot: string, prompt: string): Promise<TaskContext> {
    const projectMeta = await this.projectScanner.scanMetadata(projectRoot);
    const gitStatus = await this.gitScanner.scan(projectRoot);

    const keywordResult = await this.keywordScanner.scan(projectRoot, prompt);
    const keywordMatches = keywordResult.matches;

    const compactContext = await this.workspaceScanner.scan(projectRoot, prompt);

    const useCase = this.useCaseDetector.detect(prompt);

    const taskType = this.determineTaskType(useCase, projectMeta, compactContext);
    const workflowType = this.determineWorkflowType(useCase, taskType, prompt);

    const isCodeProject = projectMeta.type === "code" || projectMeta.type === "mixed";
    let codeGraph: CodeGraph | null = null;
    if (isCodeProject && keywordMatches.length > 0) {
      const result = await this.codeGraphScanner.scan(
        keywordMatches.map((m) => m.filePath),
        projectRoot,
      );
      if (result.graph.files.length > 0) {
        codeGraph = result.graph;
      }
    }

    let testResult: TestScanResult | null = null;
    if (projectMeta.hasTests) {
      const result = await this.testScanner.scan(projectRoot);
      if (result.testFiles.length > 0) {
        testResult = result;
      }
    }

    const contextItems = this.buildContextItems(compactContext, keywordMatches);
    const relevantFiles = this.extractRelevantFiles(compactContext, taskType);
    const relevantDocuments = this.extractRelevantDocuments(compactContext);
    const relevantArtifacts = this.extractRelevantArtifacts(compactContext);
    const relevantDataFiles = this.extractRelevantDataFiles(compactContext);
    const relatedCommands = this.extractRelatedCommands(projectMeta);
    const previousDecisions = this.buildPreviousDecisions();
    const risks = this.buildRisks(taskType, workflowType, projectMeta);
    const constraints = this.buildConstraints(projectMeta, prompt);
    const expectedOutputs = this.buildExpectedOutputs(workflowType, prompt);
    const validationMethods = this.buildValidationMethods(workflowType);
    const planningHints = this.buildPlanningHints(taskType, workflowType, useCase);
    const confidenceScore = this.calculateConfidence(useCase, compactContext);

    const contextPack = this.buildContextPack(
      projectMeta,
      gitStatus,
      keywordMatches,
      codeGraph,
      testResult,
    );

    const compactText = this.buildCompactText({
      userGoal: prompt,
      taskType,
      workflowType,
      contextItems: this.compressContextItems(contextItems),
      relevantFiles: relevantFiles.slice(0, 20),
      relevantDocuments: relevantDocuments.slice(0, 10),
      relevantDataFiles: relevantDataFiles.slice(0, 5),
      relatedCommands: relatedCommands.slice(0, 10),
      risks,
      constraints: constraints.slice(0, 5),
      expectedOutputs,
      validationMethods,
      planningHints,
      confidenceScore,
      projectMeta,
      gitStatus,
    });

    const result: TaskContext = {
      userGoal: prompt,
      taskType,
      workflowType,
      contextItems,
      relevantFiles,
      relevantDocuments,
      relevantArtifacts,
      relevantDataFiles,
      relatedCommands,
      previousDecisions,
      risks,
      constraints,
      expectedOutputs,
      validationMethods,
      planningHints,
      confidenceScore,
      compactText,
      projectMeta,
      gitStatus,
      keywordMatches,
      codeGraph,
      testResult,
      contextPack,
    };

    return result;
  }

  private compressContextItems(items: ContextItem[]): ContextItem[] {
    return items.slice(0, MAX_CONTEXT_ITEMS_IN_COMPACT).map((item) => {
      if (item.summary.length > MAX_CONTEXT_ITEM_SUMMARY_LENGTH) {
        return {
          ...item,
          summary: item.summary.slice(0, MAX_CONTEXT_ITEM_SUMMARY_LENGTH - 3) + "...",
        };
      }
      return item;
    });
  }

  formatSummary(ctx: TaskContext): string {
    return [
      `Task: ${ctx.taskType} / ${ctx.workflowType}`,
      `Confidence: ${Math.round(ctx.confidenceScore * 100)}%`,
      `Project: ${ctx.projectMeta.name} (${ctx.projectMeta.type})`,
      `Branch: ${ctx.gitStatus.branch ?? "detached"}`,
      `Changes: ${ctx.gitStatus.hasChanges ? "yes" : "no"}`,
      `Keywords matched: ${ctx.keywordMatches.length} file(s)`,
      `Code graph: ${ctx.codeGraph ? `${ctx.codeGraph.files.length} module(s)` : "none"}`,
      `Tests: ${ctx.testResult ? `${ctx.testResult.testFileCount} file(s)` : "none"}`,
      `Context items: ${ctx.contextItems.length}`,
      `Risks: ${ctx.risks.length}`,
      `Planning hints: ${ctx.planningHints.length}`,
    ].join("\n");
  }

  private buildCompactText(data: {
    userGoal: string;
    taskType: TaskType;
    workflowType: WorkflowType;
    contextItems: ContextItem[];
    relevantFiles: string[];
    relevantDocuments: string[];
    relevantDataFiles: string[];
    relatedCommands: string[];
    risks: Risk[];
    constraints: Constraint[];
    expectedOutputs: ExpectedOutput[];
    validationMethods: ValidationMethod[];
    planningHints: PlanningHint[];
    confidenceScore: number;
    projectMeta: ProjectMetadata;
    gitStatus: GitStatus;
  }): string {
    const parts: string[] = [];

    parts.push("# Task Context\n");
    parts.push(`## Goal\n${data.userGoal}\n`);
    parts.push(`## Type\n- Task: ${data.taskType}\n- Workflow: ${data.workflowType}\n`);
    parts.push(`## Confidence\n${Math.round(data.confidenceScore * 100)}%\n`);

    parts.push("## Project\n");
    parts.push(`- Name: ${data.projectMeta.name}`);
    parts.push(`- Type: ${data.projectMeta.type}`);
    if (data.projectMeta.languages.length > 0) {
      parts.push(`- Languages: ${data.projectMeta.languages.join(", ")}`);
    }
    if (data.projectMeta.frameworks.length > 0) {
      parts.push(`- Frameworks: ${data.projectMeta.frameworks.join(", ")}`);
    }
    if (data.projectMeta.scripts.length > 0) {
      parts.push(`- Scripts: ${data.projectMeta.scripts.join(", ")}`);
    }
    parts.push("");

    if (data.gitStatus.branch) {
      parts.push("## Git\n");
      parts.push(`- Branch: ${data.gitStatus.branch}`);
      if (data.gitStatus.hasChanges) {
        parts.push(`- Modified: ${data.gitStatus.staged + data.gitStatus.unstaged} file(s)`);
        parts.push(`- Untracked: ${data.gitStatus.untracked} file(s)`);
      }
      parts.push("");
    }

    if (data.contextItems.length > 0) {
      parts.push("## Relevant Context\n");
      const maxItems = Math.min(data.contextItems.length, 30);
      for (let i = 0; i < maxItems; i++) {
        const item = data.contextItems[i]!;
        parts.push(
          `- ${item.path} (${item.type}, relevance: ${Math.round(item.relevance * 100)}%)`,
        );
        if (item.summary) {
          parts.push(`  ${item.summary}`);
        }
      }
      if (data.contextItems.length > maxItems) {
        parts.push(`  ... and ${data.contextItems.length - maxItems} more items`);
      }
      parts.push("");
    }

    if (data.relevantFiles.length > 0) {
      parts.push(`## Key Files (${data.relevantFiles.length})\n`);
      for (const f of data.relevantFiles.slice(0, 15)) {
        parts.push(`- ${f}`);
      }
      parts.push("");
    }

    if (data.relatedCommands.length > 0) {
      parts.push("## Available Commands\n");
      for (const cmd of data.relatedCommands) {
        parts.push(`- \`${cmd}\``);
      }
      parts.push("");
    }

    if (data.risks.length > 0) {
      parts.push("## Identified Risks\n");
      for (const risk of data.risks) {
        parts.push(`- [${risk.level.toUpperCase()}] ${risk.description}`);
        parts.push(`  Mitigation: ${risk.mitigation}`);
      }
      parts.push("");
    }

    if (data.constraints.length > 0) {
      parts.push("## Constraints\n");
      for (const c of data.constraints) {
        parts.push(`- [${c.type}] ${c.description}`);
      }
      parts.push("");
    }

    if (data.expectedOutputs.length > 0) {
      parts.push("## Expected Outputs\n");
      for (const o of data.expectedOutputs) {
        parts.push(`- ${o.type}: ${o.description} (validate: ${o.validationMethod})`);
      }
      parts.push("");
    }

    if (data.validationMethods.length > 0) {
      parts.push("## Validation Methods\n");
      for (const v of data.validationMethods) {
        parts.push(`- ${v.type}: ${v.description}`);
      }
      parts.push("");
    }

    if (data.planningHints.length > 0) {
      parts.push("## Planning Hints\n");
      for (const h of data.planningHints) {
        parts.push(`- [${h.priority.toUpperCase()}] ${h.description}`);
      }
      parts.push("");
    }

    return parts.join("\n");
  }

  private determineTaskType(
    useCase: UseCaseDetection,
    projectMeta: ProjectMetadata,
    _compactContext: CompactContext,
  ): TaskType {
    if (useCase.type !== "general") {
      return USE_CASE_TO_TASK_TYPE[useCase.type] ?? "general";
    }
    if (projectMeta.type === "code" || projectMeta.type === "mixed") {
      return "code";
    }
    if (projectMeta.type === "docs") {
      return "documentation";
    }
    return "general";
  }

  private determineWorkflowType(
    useCase: UseCaseDetection,
    taskType: TaskType,
    _prompt: string,
  ): WorkflowType {
    if (useCase.type !== "general") {
      return USE_CASE_TO_WORKFLOW_TYPE[useCase.type] ?? "general";
    }
    const taskTypeToWorkflow: Record<TaskType, WorkflowType> = {
      general: "general",
      code: "code_implementation",
      documentation: "documentation",
      research: "research",
      data: "data_analysis",
      writing: "writing",
      design: "design",
      business_analysis: "business_analysis",
      qa: "qa_checklist",
      release: "release_checklist",
      operations: "operations",
      mixed: "mixed",
    };
    return taskTypeToWorkflow[taskType] ?? "general";
  }

  private buildContextItems(
    compactContext: CompactContext,
    keywordMatches: KeywordMatch[],
  ): ContextItem[] {
    const items: ContextItem[] = [];
    const matchedPaths = new Set(keywordMatches.map((m) => m.filePath));

    for (const item of compactContext.items) {
      const relevance = matchedPaths.has(item.filePath) ? 0.9 : 0.3;
      items.push({
        path: item.relativePath,
        type: item.type,
        summary: item.summary,
        relevance,
      });
    }

    items.sort((a, b) => b.relevance - a.relevance);
    return items;
  }

  private extractRelevantFiles(compactContext: CompactContext, taskType: TaskType): string[] {
    const relevant: string[] = [];
    for (const item of compactContext.items) {
      if (taskType === "code") {
        if (
          item.type === FileType.CODE ||
          item.type === FileType.JSON ||
          item.type === FileType.YAML ||
          item.type === FileType.CONFIG
        ) {
          relevant.push(item.relativePath);
        }
      } else {
        relevant.push(item.relativePath);
      }
    }
    return relevant.slice(0, 30);
  }

  private extractRelevantDocuments(compactContext: CompactContext): string[] {
    const docs: string[] = [];
    for (const item of compactContext.items) {
      if (item.type === FileType.MARKDOWN || item.type === FileType.DOCUMENT) {
        docs.push(item.relativePath);
      }
    }
    return docs;
  }

  private extractRelevantArtifacts(compactContext: CompactContext): string[] {
    const artifacts: string[] = [];
    for (const item of compactContext.items) {
      if (item.type === FileType.ARTIFACT) {
        artifacts.push(item.relativePath);
      }
    }
    return artifacts;
  }

  private extractRelevantDataFiles(compactContext: CompactContext): string[] {
    const dataFiles: string[] = [];
    for (const item of compactContext.items) {
      if (
        item.type === FileType.CSV ||
        item.type === FileType.DATA ||
        item.type === FileType.SPREADSHEET ||
        item.type === FileType.JSON
      ) {
        dataFiles.push(item.relativePath);
      }
    }
    return dataFiles;
  }

  private extractRelatedCommands(projectMeta: ProjectMetadata): string[] {
    const commands: string[] = [];
    if (projectMeta.packageManager) {
      const pm = projectMeta.packageManager;
      if (pm === "npm") {
        commands.push("npm test", "npm run build", "npm run lint");
      } else if (pm === "pnpm") {
        commands.push("pnpm test", "pnpm build", "pnpm lint");
      } else if (pm === "yarn") {
        commands.push("yarn test", "yarn build", "yarn lint");
      }
    }
    for (const script of projectMeta.scripts) {
      if (!commands.includes(script)) {
        commands.push(script);
      }
    }
    return commands;
  }

  private buildPreviousDecisions(): PreviousDecision[] {
    return [];
  }

  private buildRisks(
    _taskType: TaskType,
    workflowType: WorkflowType,
    projectMeta: ProjectMetadata,
  ): Risk[] {
    const risks: Risk[] = [];
    const workflowRisks = WORKFLOW_TYPE_RISKS[workflowType] ?? [];
    risks.push(...workflowRisks);

    if (projectMeta.gitHasChanges) {
      risks.push({
        description: "Working directory has uncommitted changes that may conflict",
        level: "medium",
        mitigation: "Commit or stash changes before starting workflow",
      });
    }

    return risks;
  }

  private buildConstraints(projectMeta: ProjectMetadata, _prompt: string): Constraint[] {
    const constraints: Constraint[] = [];
    if (projectMeta.scripts.length === 0) {
      constraints.push({
        description: "No project scripts defined for validation",
        type: "technical",
      });
    }
    return constraints;
  }

  private buildExpectedOutputs(workflowType: WorkflowType, _prompt: string): ExpectedOutput[] {
    const outputs: ExpectedOutput[] = [];
    switch (workflowType) {
      case "code_implementation":
      case "bug_fix":
      case "refactor":
        outputs.push({
          type: "code_change",
          description: "Source code changes",
          validationMethod: "file_diff",
        });
        outputs.push({
          type: "test_result",
          description: "Tests pass after changes",
          validationMethod: "test",
        });
        break;
      case "documentation":
        outputs.push({
          type: "document",
          description: "Documentation files",
          validationMethod: "file_exists",
        });
        break;
      case "research":
        outputs.push({
          type: "report",
          description: "Research findings report",
          validationMethod: "file_exists",
        });
        outputs.push({
          type: "summary",
          description: "Research summary",
          validationMethod: "ai_review",
        });
        break;
      case "data_analysis":
      case "data_transformation":
      case "data_cleanup":
        outputs.push({
          type: "data_file",
          description: "Processed data output",
          validationMethod: "file_exists",
        });
        outputs.push({
          type: "report",
          description: "Analysis report",
          validationMethod: "file_exists",
        });
        break;
      case "writing":
        outputs.push({
          type: "document",
          description: "Written content",
          validationMethod: "file_exists",
        });
        break;
      case "design":
        outputs.push({
          type: "design_artifact",
          description: "Design artifacts",
          validationMethod: "file_exists",
        });
        break;
      case "qa_checklist":
        outputs.push({
          type: "checklist",
          description: "QA checklist",
          validationMethod: "file_exists",
        });
        break;
      case "release_checklist":
        outputs.push({
          type: "checklist",
          description: "Release checklist",
          validationMethod: "file_exists",
        });
        break;
      case "report_generation":
        outputs.push({
          type: "report",
          description: "Generated report",
          validationMethod: "file_exists",
        });
        break;
      case "operations":
        outputs.push({
          type: "command_result",
          description: "Operation command output",
          validationMethod: "command_output",
        });
        break;
      default:
        outputs.push({
          type: "mixed_artifact",
          description: "Workflow outputs",
          validationMethod: "acceptance_criteria",
        });
    }
    return outputs;
  }

  private buildValidationMethods(workflowType: WorkflowType): ValidationMethod[] {
    return WORKFLOW_VALIDATIONS[workflowType] ?? WORKFLOW_VALIDATIONS.general;
  }

  private buildPlanningHints(
    taskType: TaskType,
    _workflowType: WorkflowType,
    useCase: UseCaseDetection,
  ): PlanningHint[] {
    const hints: PlanningHint[] = [];
    const taskHints = TASK_TYPE_HINTS[taskType] ?? TASK_TYPE_HINTS.general;
    hints.push(...taskHints);

    if (useCase.type !== "general" && useCase.confidence > 0.5) {
      hints.push({
        description: `Detected use case: ${useCase.type} with ${Math.round(useCase.confidence * 100)}% confidence`,
        priority: "high",
      });
    }

    return hints;
  }

  private calculateConfidence(useCase: UseCaseDetection, compactContext: CompactContext): number {
    let confidence = 0.3;
    if (useCase.confidence > 0) {
      confidence = Math.max(confidence, useCase.confidence);
    } else {
      confidence = 0.5;
    }
    if (compactContext.totalFiles > 0) {
      confidence = Math.min(confidence + 0.1, 1);
    }
    if (compactContext.items.length > 0) {
      confidence = Math.min(confidence + 0.1, 1);
    }
    return Math.round(confidence * 100) / 100;
  }

  private buildContextPack(
    projectMeta: ProjectMetadata,
    gitStatus: GitStatus,
    keywordMatches: KeywordMatch[],
    codeGraph: CodeGraph | null,
    testResult: TestScanResult | null,
  ): string {
    const parts: string[] = [];

    parts.push("## Project Context\n");
    this.appendProjectMeta(parts, projectMeta);
    parts.push("");

    parts.push("### Git Status\n");
    this.appendGitStatus(parts, gitStatus);
    parts.push("");

    if (keywordMatches.length > 0) {
      parts.push("### Relevant Files\n");
      this.appendKeywordMatches(parts, keywordMatches);
      parts.push("");
    }

    if (codeGraph) {
      parts.push("### Code Graph\n");
      this.appendCodeGraph(parts, codeGraph);
      parts.push("");
    }

    if (testResult) {
      parts.push("### Tests\n");
      this.appendTestResult(parts, testResult);
      parts.push("");
    }

    return parts.join("\n").trim();
  }

  private appendProjectMeta(parts: string[], meta: ProjectMetadata): void {
    parts.push(`- Name: ${meta.name}`);
    parts.push(`- Type: ${meta.type}`);
    if (meta.languages.length > 0) parts.push(`- Languages: ${meta.languages.join(", ")}`);
    if (meta.frameworks.length > 0) parts.push(`- Frameworks: ${meta.frameworks.join(", ")}`);
    if (meta.packageManager) parts.push(`- Package manager: ${meta.packageManager}`);
    if (meta.buildTool) parts.push(`- Build tool: ${meta.buildTool}`);
    if (meta.testFramework) parts.push(`- Test framework: ${meta.testFramework}`);
    if (meta.entryPoints.length > 0) parts.push(`- Entry points: ${meta.entryPoints.join(", ")}`);
    if (meta.importantFolders.length > 0)
      parts.push(`- Folders: ${meta.importantFolders.join(", ")}`);
    if (meta.configFiles.length > 0) parts.push(`- Config files: ${meta.configFiles.join(", ")}`);
    if (meta.docs.length > 0) parts.push(`- Docs: ${meta.docs.join(", ")}`);
    parts.push(`- Dependencies: ${meta.dependencies} (dev: ${meta.devDependencies})`);
  }

  private appendGitStatus(parts: string[], status: GitStatus): void {
    parts.push(`- Branch: ${status.branch ?? "detached"}`);
    parts.push(
      `- Modified: ${status.staged + status.unstaged} file(s) (${status.staged} staged, ${status.unstaged} unstaged, ${status.untracked} untracked)`,
    );
    if (status.recentCommits.length > 0) {
      const recent = status.recentCommits.slice(0, 3);
      for (const c of recent) {
        parts.push(`- [${c.hash.slice(0, 7)}] ${c.subject}`);
      }
    }
  }

  private appendKeywordMatches(parts: string[], matches: KeywordMatch[]): void {
    const grouped = new Map<string, KeywordMatch[]>();
    for (const m of matches) {
      const dir = path.dirname(m.relativePath);
      const group = grouped.get(dir) ?? [];
      group.push(m);
      grouped.set(dir, group);
    }

    for (const [, files] of [...grouped.entries()].sort()) {
      for (const f of files) {
        const label = "matched by " + f.matchedBy;
        parts.push(`- ${f.relativePath} (${label})`);
      }
    }
  }

  private appendCodeGraph(parts: string[], graph: CodeGraph): void {
    parts.push(`Modules: ${graph.files.length}, Edges: ${graph.edges.length}`);
    if (graph.entryPoints.length > 0) {
      parts.push(`Entry points: ${graph.entryPoints.join(", ")}`);
    }
    for (const mod of graph.files.slice(0, 20)) {
      const entryLabel = mod.isEntryPoint ? " [entry]" : "";
      parts.push(`\n#### ${mod.relativePath}${entryLabel}`);
      if (mod.exports.length > 0) {
        parts.push(`  Exports: ${mod.exports.join(", ")}`);
      }
      const localImports = mod.imports.filter((i) => i.startsWith("."));
      if (localImports.length > 0) {
        parts.push(`  Imports: ${localImports.join(", ")}`);
      }
      if (mod.relatedTests.length > 0) {
        parts.push(`  Tests: ${mod.relatedTests.join(", ")}`);
      }
    }
    if (graph.files.length > 20) {
      parts.push(`\n... and ${graph.files.length - 20} more module(s)`);
    }
  }

  private appendTestResult(parts: string[], result: TestScanResult): void {
    if (result.frameworks.length > 0) {
      const names = result.frameworks.map((f) => f.name);
      parts.push(`Framework(s): ${names.join(", ")}`);
    }
    parts.push(`Test files: ${result.testFileCount}`);
    if (result.coverage.available) {
      const covParts: string[] = ["Coverage:"];
      if (result.coverage.lines !== null) covParts.push(`lines ${result.coverage.lines}%`);
      if (result.coverage.branches !== null) covParts.push(`branches ${result.coverage.branches}%`);
      if (result.coverage.functions !== null)
        covParts.push(`functions ${result.coverage.functions}%`);
      if (covParts.length > 1) parts.push(covParts.join(" "));
    }
    if (result.testFiles.length > 0) {
      for (const tf of result.testFiles.slice(0, 15)) {
        const sourceInfo = tf.relatedSourceModule ? ` → ${tf.relatedSourceModule}` : "";
        parts.push(`- ${tf.relativePath}${sourceInfo}`);
      }
      if (result.testFiles.length > 15) {
        parts.push(`... and ${result.testFiles.length - 15} more`);
      }
    }
  }
}
