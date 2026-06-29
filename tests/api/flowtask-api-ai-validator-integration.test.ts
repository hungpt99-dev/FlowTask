import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";
import { OutputPlanValidator } from "../../src/validation/output-plan-validator.js";
import { AiValidator } from "../../src/validation/ai-validator.js";
import { ProviderRegistry } from "../../src/ai/provider-registry.js";
import { ContextPackBuilder } from "../../src/context/context-pack-builder.js";
import { ValidationEngine } from "../../src/validation/validation-engine.js";
import type {
  AiProvider,
  AiProviderRequest,
  AiProviderResponse,
} from "../../src/ai/ai-provider.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import { now } from "../../src/utils/time.js";

function createMockProvider(verdictGetter: () => string): AiProvider {
  return {
    name: "mock-validator",
    type: "test",
    supportsJsonObject: true,
    supportsStreaming: false,
    async generate(_request: AiProviderRequest): Promise<AiProviderResponse> {
      return { text: verdictGetter(), model: "mock-model", provider: "mock-validator" };
    },
  };
}

const verdicts: { current: string } = { current: "" };
const mockProvider = createMockProvider(() => verdicts.current);

function setVerdict(status: string, suggestion: string): void {
  verdicts.current = JSON.stringify({
    status,
    suggestion,
    explanation: status === "passed" ? "Task completed as expected" : `Task failed: ${suggestion}`,
    confidence: status === "passed" ? "high" : status === "warning" ? "medium" : "high",
    evidenceSummary: `Status: ${status}, Suggestion: ${suggestion}`,
    evidenceGaps: suggestion ? [suggestion] : [],
  });
}

function createMinimalConfig(): FlowTaskConfig {
  return {
    version: "1.0",
    projectMode: "development",
    defaultExecutor: "shell",
    runsDir: ".flowtask/runs",
    logLevel: "info",
    autoResume: true,
    rules: { enabled: true, paths: [], required: false, maxFileSizeKb: 256 },
    approval: { enabled: false, autoApprove: true, requireFor: [] },
    quality: { enabledByDefault: false, commands: [] },
    validation: {
      profile: "quick",
      adaptiveValidation: true,
      concurrency: 1,
      timeoutMs: 300000,
      killGraceMs: 5000,
      dedupeCommands: true,
      resourceGuard: true,
      commands: [],
      vitest: { enabled: true, maxWorkers: 1, runMode: true },
      aiValidation: "fallback",
    },
    logging: { maxInMemoryLines: 500, maxLineLength: 4000 },
    limits: { maxRunMinutes: 120, maxTaskMinutes: 30, maxRetries: 2, maxLogSizeMb: 20 },
    planner: {
      default: "auto",
      type: "internal-ai",
      executor: "opencode",
      provider: "mock-validator",
      model: "mock-model",
      maxRetries: 1,
      fallbackToSimple: true,
    },
    ai: { providers: { "mock-validator": { type: "test", allowNoApiKey: true } } },
    useCase: { enabled: true, customPatterns: [], confidenceThreshold: 0.5 },
    process: { gracefulStopTimeoutMs: 5000, forceKillTimeoutMs: 10000 },
    executors: {},
    hooks: {
      beforeRun: [],
      afterRun: [],
      beforeTask: [],
      afterTask: [],
      beforeRetry: [],
      afterRetry: [],
      onFailure: [],
      failOnError: false,
    },
  };
}

let testDir: string;
let api: FlowTaskAPI;
let registry: ProviderRegistry;

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-ai-val-int-"));
  api = new FlowTaskAPI({ rootPath: testDir });
  await api.initProject("AiValidator Integration Test", "development");
  await api.initDatabase();

  const config = createMinimalConfig();
  registry = new ProviderRegistry(config);
  (registry as unknown as { mergedProviders: Record<string, unknown> }).mergedProviders = {};
  (registry as unknown as { getProvider: () => AiProvider }).getProvider = () => mockProvider;
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("AiValidator Integration with OutputPlan and Retry Feedback", () => {
  describe("AiValidator verdict drives validation result", () => {
    it("should pass validation when AiValidator returns passed", async () => {
      setVerdict("passed", "");

      const validator = new OutputPlanValidator(new AiValidator(registry));
      const checks = await validator.validate(
        [{ action: "create", target: "test-output.txt", validationMethod: "ai_review" }],
        {
          status: "done",
          exitCode: 0,
          output: "Created test-output.txt",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
        "Create the output file test-output.txt",
      );

      expect(checks).toHaveLength(1);
      expect(checks[0]?.type).toBe("ai_review");
      expect(checks[0]?.status).toBe("passed");
      expect(checks[0]?.message).toContain("AI review passed");
    });

    it("should fail validation when AiValidator returns failed", async () => {
      setVerdict("failed", "File was not created: test-output.txt is missing");

      const validator = new OutputPlanValidator(new AiValidator(registry));
      const checks = await validator.validate(
        [{ action: "create", target: "test-output.txt", validationMethod: "ai_review" }],
        { status: "done", exitCode: 0, output: "", startedAt: now(), finishedAt: now() },
        testDir,
        "Create the output file test-output.txt",
      );

      expect(checks).toHaveLength(1);
      expect(checks[0]?.type).toBe("ai_review");
      expect(checks[0]?.status).toBe("failed");
      expect(checks[0]?.message).toContain("File was not created");
    });

    it("should return warning when AiValidator returns warning", async () => {
      setVerdict("warning", "Implementation is incomplete, missing error handling");

      const validator = new OutputPlanValidator(new AiValidator(registry));
      const checks = await validator.validate(
        [{ action: "modify", target: "src/handler.ts", validationMethod: "ai_review" }],
        {
          status: "done",
          exitCode: 0,
          output: "Modified handler.ts",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
        "Modify the handler to add error handling",
      );

      expect(checks).toHaveLength(1);
      expect(checks[0]?.type).toBe("ai_review");
      expect(checks[0]?.status).toBe("warning");
      expect(checks[0]?.message).toContain("missing error handling");
    });
  });

  describe("OutputPlanValidator integration with AiValidator via ai_review", () => {
    it("should route ai_review through OutputPlanValidator and return AiValidator verdict", async () => {
      setVerdict("passed", "");

      const validator = new OutputPlanValidator(new AiValidator(registry));
      const checks = await validator.validate(
        [{ action: "create", target: "test-output.txt", validationMethod: "ai_review" }],
        {
          status: "done",
          exitCode: 0,
          output: "Created test-output.txt",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
        "Create the output file test-output.txt",
      );

      const aiChecks = checks.filter((c) => c.type === "ai_review");
      expect(aiChecks.length).toBeGreaterThanOrEqual(1);
      expect(aiChecks[0]?.status).toBe("passed");
    });

    it("should return failed when AiValidator returns failed through OutputPlanValidator", async () => {
      setVerdict("failed", "File src/missing.ts was not created.");

      const validator = new OutputPlanValidator(new AiValidator(registry));
      const checks = await validator.validate(
        [{ action: "create", target: "src/missing.ts", validationMethod: "ai_review" }],
        { status: "done", exitCode: 0, output: "", startedAt: now(), finishedAt: now() },
        testDir,
        "Create src/missing.ts",
      );

      expect(checks[0]?.type).toBe("ai_review");
      expect(checks[0]?.status).toBe("failed");
      expect(checks[0]?.message).toContain("src/missing.ts was not created");
      expect(checks[0]?.details?.verdict).toBeDefined();
      const v = checks[0]?.details?.verdict as { suggestion: string };
      expect(v.suggestion).toContain("src/missing.ts was not created");
    });
  });

  describe("Retry feedback loop: suggestion extraction and context update", () => {
    it("should extract suggestion from ai_review check verdict", async () => {
      setVerdict("failed", "Missing the main export function in src/index.ts");

      const validator = new OutputPlanValidator(new AiValidator(registry));
      const checks = await validator.validate(
        [{ action: "modify", target: "src/index.ts", validationMethod: "ai_review" }],
        {
          status: "done",
          exitCode: 0,
          output: "Modified file",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
        "Add main export function to src/index.ts",
      );

      const verdict = checks[0]?.details?.verdict as { status: string; suggestion: string };
      expect(verdict.status).toBe("failed");
      expect(verdict.suggestion).toBe("Missing the main export function in src/index.ts");
    });

    it("should append suggestion to context pack markdown on failure", async () => {
      const suggestion = "The file was not created. Please create src/output.ts.";

      const contextPack = new ContextPackBuilder().build({
        prompt: "Create src/output.ts",
        rulesContext: "Follow project conventions.",
        run: {
          runId: "run_001",
          projectId: "proj_001",
          title: "Test run",
          mode: "auto",
          status: "running",
          createdAt: now(),
          updatedAt: now(),
          taskCount: 1,
          completedTaskCount: 0,
        },
        task: {
          id: "task_001",
          runId: "run_001",
          title: "Create output file",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create the output file",
        },
        completedTasks: [],
        isRetry: false,
      });

      const updatedMarkdown =
        contextPack.markdown + `\n\n## AI Validation Feedback\n\n${suggestion}\n`;

      expect(updatedMarkdown).toContain("## AI Validation Feedback");
      expect(updatedMarkdown).toContain(suggestion);
      expect(updatedMarkdown).toContain("# FlowTask Context Pack");
    });

    it("should simulate full retry feedback loop: validate → extract suggestion → update context → retry uses updated context", async () => {
      setVerdict("failed", "File was not created at src/output.ts. Please create it.");

      const aiValidator = new AiValidator(registry);
      const validator = new OutputPlanValidator(aiValidator);
      const contextBuilder = new ContextPackBuilder();

      const baseContext = contextBuilder.build({
        prompt: "Create src/output.ts with a greeting message",
        rulesContext: "Use TypeScript. Use named exports.",
        run: {
          runId: "run_retry_001",
          projectId: "proj_001",
          title: "Retry feedback test",
          mode: "auto",
          status: "running",
          createdAt: now(),
          updatedAt: now(),
          taskCount: 1,
          completedTaskCount: 0,
        },
        task: {
          id: "task_retry_001",
          runId: "run_retry_001",
          title: "Create output file",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create the output file src/output.ts",
          outputPlan: [
            { action: "create", target: "src/output.ts", validationMethod: "ai_review" },
          ],
        },
        completedTasks: [],
        isRetry: false,
      });

      let contextContent = baseContext.markdown;

      // First execution — simulation
      const executorOutput = "Done.";
      const result = await validator.validate(
        [{ action: "create", target: "src/output.ts", validationMethod: "ai_review" }],
        {
          status: "done",
          exitCode: 0,
          output: executorOutput,
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
        "Create the output file src/output.ts",
      );

      // Verify validation failed with suggestion
      expect(result[0]?.status).toBe("failed");
      const verdict = result[0]?.details?.verdict as { status: string; suggestion: string };
      expect(verdict.suggestion).toBeTruthy();

      // Simulate extractValidationSuggestion logic (matching run-lifecycle.ts)
      const suggestions: string[] = [];
      const aiFailed = result.filter((c) => c.type === "ai_review" && c.status === "failed");
      for (const check of aiFailed) {
        const v = check.details?.verdict;
        if (v && typeof v === "object" && "suggestion" in v) {
          const s = (v as { suggestion: string }).suggestion;
          if (s.length > 0) suggestions.push(s);
        }
      }
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toBe("File was not created at src/output.ts. Please create it.");

      // Append suggestion to context (matching run-lifecycle.ts L1146-1148)
      contextContent =
        contextContent + `\n\n## AI Validation Feedback\n\n${suggestions.join("\n")}\n`;

      expect(contextContent).toContain("## AI Validation Feedback");
      expect(contextContent).toContain("File was not created at src/output.ts. Please create it.");

      // Retry execution would now use the updated contextContent
      // Verify the updated context is not the same as the original
      expect(contextContent).not.toBe(baseContext.markdown);
      expect(contextContent.length).toBeGreaterThan(baseContext.markdown.length);

      // Verify the AI Validation Feedback section comes after the original context
      const feedbackIndex = contextContent.indexOf("## AI Validation Feedback");
      const instructionsIndex = contextContent.indexOf("## Instructions");
      expect(feedbackIndex).toBeGreaterThan(instructionsIndex);

      // Simulate second retry with AiValidator returning passed
      setVerdict("passed", "");

      const retryResult = await validator.validate(
        [{ action: "create", target: "src/output.ts", validationMethod: "ai_review" }],
        {
          status: "done",
          exitCode: 0,
          output: "Created src/output.ts with greeting",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
        "Create the output file src/output.ts",
      );

      expect(retryResult[0]?.status).toBe("passed");
    });
  });

  describe("FlowTaskAPI + ai_review outputPlan persistence and validation", () => {
    let runId: string;

    beforeAll(async () => {
      const project = await api.loadProject();
      const run = await api.createRun(project!.projectId, "AiValidator Persistence", "auto");
      runId = run.runId;
    });

    it("should save and load task with ai_review outputPlan", async () => {
      const taskId = "e2e_ai_val_persist_001";

      await api.saveTasks(runId, [
        {
          id: taskId,
          runId,
          title: "AiValidator persistence task",
          status: "done",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          description: "Create the output file",
          outputPlan: [
            {
              action: "create",
              target: "src/output.ts",
              validationMethod: "ai_review",
              description: "Main output file",
            },
          ],
        },
      ]);

      const loaded = await api.loadTasks(runId);
      const task = loaded.find((t) => t.id === taskId)!;
      expect(task.outputPlan).toBeDefined();
      expect(task.outputPlan).toHaveLength(1);
      expect(task.outputPlan![0]!.validationMethod).toBe("ai_review");
    });

    it("should validate ai_review outputPlan with AiValidator using OutputPlanValidator", async () => {
      setVerdict("passed", "");

      const validator = new OutputPlanValidator(new AiValidator(registry));
      const checks = await validator.validate(
        [{ action: "create", target: "src/output.ts", validationMethod: "ai_review" }],
        {
          status: "done",
          exitCode: 0,
          output: "Created src/output.ts",
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
        "Create src/output.ts",
      );

      expect(checks[0]?.type).toBe("ai_review");
      expect(checks[0]?.status).toBe("passed");
    });
  });

  describe("ValidationEngine integration with ai_review outputPlan", () => {
    const engineVerdicts: { current: string } = { current: "" };
    const mockEngineProvider: AiProvider = {
      name: "mock-validation-engine",
      type: "test",
      supportsJsonObject: true,
      supportsStreaming: false,
      async generate(_request: AiProviderRequest): Promise<AiProviderResponse> {
        const parsed = JSON.parse(engineVerdicts.current);
        const enhanced = {
          status: parsed.status,
          suggestion: parsed.suggestion ?? "",
          explanation: parsed.explanation ?? `Status: ${parsed.status}`,
          confidence: parsed.confidence ?? (parsed.status === "passed" ? "high" : "medium"),
          evidenceSummary: parsed.evidenceSummary ?? `Verdict: ${parsed.status}`,
          evidenceGaps: parsed.evidenceGaps ?? (parsed.suggestion ? [parsed.suggestion] : []),
        };
        return {
          text: JSON.stringify(enhanced),
          model: "mock",
          provider: "mock-validation-engine",
        };
      },
    };
    const mockEngineRegistry = new ProviderRegistry(createMinimalConfig());
    (mockEngineRegistry as unknown as { getProvider: (name?: string) => AiProvider }).getProvider =
      () => mockEngineProvider;

    let engine: ValidationEngine;

    beforeAll(() => {
      engine = new ValidationEngine(createMinimalConfig());
      (engine as unknown as { aiValidator: AiValidator }).aiValidator = new AiValidator(
        mockEngineRegistry,
      );
      (engine as unknown as { outputPlanValidator: OutputPlanValidator }).outputPlanValidator =
        new OutputPlanValidator(new AiValidator(mockEngineRegistry));
    });

    it("should route ai_review through ValidationEngine validateTask and return passed verdict", async () => {
      engineVerdicts.current = JSON.stringify({ status: "passed", suggestion: "" });

      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          id: "engine_ai_pass_001",
          runId: "run_engine_001",
          title: "AI review pass",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create an output file with proper content",
          outputPlan: [
            { action: "create", target: "engine-output.txt", validationMethod: "ai_review" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Created engine-output.txt with proper content",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
      expect(aiChecks[0]!.status).toBe("passed");
      expect(result.status).toBe("passed");
    });

    it("should return failed when AiValidator fails through ValidationEngine validateTask", async () => {
      engineVerdicts.current = JSON.stringify({
        status: "failed",
        suggestion: "Missing required content in engine-output.txt",
      });

      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          id: "engine_ai_fail_001",
          runId: "run_engine_001",
          title: "AI review fail",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create an output file with proper content",
          outputPlan: [
            { action: "create", target: "engine-output.txt", validationMethod: "ai_review" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
      expect(aiChecks[0]!.status).toBe("failed");
      expect(result.status).toBe("failed");
      const verdict = aiChecks[0]!.details?.verdict as { suggestion: string };
      expect(verdict.suggestion).toBe("Missing required content in engine-output.txt");
    });

    it("should return warning when AiValidator warns through ValidationEngine validateTask", async () => {
      engineVerdicts.current = JSON.stringify({
        status: "warning",
        suggestion: "Consider adding error handling",
      });

      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          id: "engine_ai_warn_001",
          runId: "run_engine_001",
          title: "AI review warning",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create an output file with basic content",
          outputPlan: [
            { action: "create", target: "engine-output.txt", validationMethod: "ai_review" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Done",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      const aiChecks = result.checks.filter((c) => c.type === "ai_review");
      expect(aiChecks).toHaveLength(1);
      expect(aiChecks[0]!.status).toBe("warning");
      expect(result.status).toBe("warning");
    });

    it("should extract suggestion from ValidationEngine ai_review checks and append to context pack", async () => {
      engineVerdicts.current = JSON.stringify({
        status: "failed",
        suggestion: "Output file engine-output.txt was not created with required headers",
      });

      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          id: "engine_extract_001",
          runId: "run_engine_001",
          title: "Extract suggestion test",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create engine-output.txt with proper headers",
          outputPlan: [
            { action: "create", target: "engine-output.txt", validationMethod: "ai_review" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      // Replicate extractValidationSuggestion logic from run-lifecycle.ts L1303-1330
      const aiReviewChecks = result.checks.filter(
        (c) => c.type === "ai_review" && c.status === "failed",
      );
      const suggestions: string[] = [];
      for (const check of aiReviewChecks) {
        const v = check.details?.verdict;
        if (v && typeof v === "object" && "suggestion" in v) {
          const s = (v as { suggestion: string }).suggestion;
          if (s.length > 0) suggestions.push(s);
        }
      }

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toBe(
        "Output file engine-output.txt was not created with required headers",
      );

      // Append to context pack (as run-lifecycle.ts does at L1146-1148)
      const contextInput = {
        prompt: "Create output file",
        rulesContext: "Follow project conventions",
        run: {
          runId: "run_engine_001",
          projectId: "proj_001",
          title: "Engine test run",
          mode: "auto" as const,
          status: "running" as const,
          createdAt: now(),
          updatedAt: now(),
          taskCount: 1,
          completedTaskCount: 0,
        },
        task: {
          id: "engine_extract_001",
          runId: "run_engine_001",
          title: "Extract suggestion test",
          status: "running" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create engine-output.txt with proper headers",
          outputPlan: [
            {
              action: "create" as const,
              target: "engine-output.txt",
              validationMethod: "ai_review" as const,
            },
          ],
        },
        completedTasks: [],
        isRetry: false,
      };

      const contextPack = new ContextPackBuilder().build(contextInput);
      const updatedMarkdown =
        contextPack.markdown + `\n\n## AI Validation Feedback\n\n${suggestions.join("\n")}\n`;

      expect(updatedMarkdown).toContain("## AI Validation Feedback");
      expect(updatedMarkdown).toContain(
        "Output file engine-output.txt was not created with required headers",
      );
    });

    it("should simulate retry feedback loop with validation through ValidationEngine", async () => {
      // First execution — failed
      engineVerdicts.current = JSON.stringify({
        status: "failed",
        suggestion: "File engine-output.txt is missing content. Add the implementation.",
      });

      const firstResult = await engine.validateTask({
        projectRoot: testDir,
        task: {
          id: "engine_retry_001",
          runId: "run_engine_001",
          title: "Retry feedback test",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create engine-output.txt with implementation",
          outputPlan: [
            { action: "create", target: "engine-output.txt", validationMethod: "ai_review" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: "Done",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      expect(firstResult.status).toBe("failed");
      const firstAi = firstResult.checks.filter((c) => c.type === "ai_review");
      expect(firstAi[0]!.status).toBe("failed");

      // Extract suggestion
      const failedChecks = firstResult.checks.filter(
        (c) => c.type === "ai_review" && c.status === "failed",
      );
      const extractedSuggestions: string[] = [];
      for (const check of failedChecks) {
        const v = check.details?.verdict;
        if (v && typeof v === "object" && "suggestion" in v) {
          const s = (v as { suggestion: string }).suggestion;
          if (s.length > 0) extractedSuggestions.push(s);
        }
      }
      expect(extractedSuggestions[0]).toContain("missing content");

      // Build updated context (simulating run-lifecycle.ts retry logic)
      const retryContextInput = {
        prompt: "Create engine-output.txt with implementation",
        rulesContext: "Use TypeScript. Use named exports.",
        run: {
          runId: "run_engine_001",
          projectId: "proj_001",
          title: "Retry feedback test",
          mode: "auto" as const,
          status: "running" as const,
          createdAt: now(),
          updatedAt: now(),
          taskCount: 1,
          completedTaskCount: 0,
        },
        task: {
          id: "engine_retry_001",
          runId: "run_engine_001",
          title: "Retry feedback test",
          status: "running" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create engine-output.txt with implementation",
          outputPlan: [
            {
              action: "create" as const,
              target: "engine-output.txt",
              validationMethod: "ai_review" as const,
            },
          ],
        },
        completedTasks: [],
        isRetry: true,
      };

      let contextContent = new ContextPackBuilder().build(retryContextInput).markdown;
      contextContent += `\n\n## AI Validation Feedback\n\n${extractedSuggestions.join("\n")}\n`;

      expect(contextContent).toContain("## AI Validation Feedback");
      expect(contextContent).toContain("missing content");

      // Second execution — passed after incorporating feedback
      engineVerdicts.current = JSON.stringify({ status: "passed", suggestion: "" });

      const secondResult = await engine.validateTask({
        projectRoot: testDir,
        task: {
          id: "engine_retry_001",
          runId: "run_engine_001",
          title: "Retry feedback test",
          status: "running",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 1,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
          description: "Create engine-output.txt with implementation",
          outputPlan: [
            { action: "create", target: "engine-output.txt", validationMethod: "ai_review" },
          ],
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output:
            "Created engine-output.txt with full implementation including all required features",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      expect(secondResult.status).toBe("passed");
      const secondAi = secondResult.checks.filter((c) => c.type === "ai_review");
      expect(secondAi[0]!.status).toBe("passed");

      // Context now contains the feedback from first failure
      expect(contextContent).toContain("## AI Validation Feedback");
      expect(contextContent.length).toBeGreaterThan(100);

      // Verify context would be used for next executor call
      const feedbackSection = "## AI Validation Feedback";
      const hasFeedback = contextContent.includes(feedbackSection);
      expect(hasFeedback).toBe(true);
    });
  });
});
