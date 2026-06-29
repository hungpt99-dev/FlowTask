import { describe, it, expect } from "vitest";
import {
  AiVerdictSchema,
  AiValidator,
  createPassedVerdict,
  createFailedVerdict,
  createNeedsReviewVerdict,
  createSkippedVerdict,
  type AiVerdict,
} from "../../src/validation/ai-validator.js";
import { ProviderRegistry } from "../../src/ai/provider-registry.js";
import type {
  AiProvider,
  AiProviderRequest,
  AiProviderResponse,
} from "../../src/ai/ai-provider.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

function createMockProvider(responseText: string): AiProvider {
  return {
    name: "mock-provider",
    type: "test",
    supportsJsonObject: true,
    supportsStreaming: false,
    async generate(_request: AiProviderRequest): Promise<AiProviderResponse> {
      return { text: responseText, model: "mock-model", provider: "mock-provider" };
    },
  };
}

function createMockRegistry(provider: AiProvider): ProviderRegistry {
  const config: FlowTaskConfig = {
    version: "1.0",
    projectMode: "development",
    defaultExecutor: "opencode",
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
      provider: "mock-provider",
      model: "mock-model",
      maxRetries: 1,
      fallbackToSimple: true,
    },
    ai: { providers: { "mock-provider": { type: "test", allowNoApiKey: true } } },
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

  const registry = new ProviderRegistry(config);
  (registry as unknown as { mergedProviders: Record<string, unknown> }).mergedProviders = {};
  (registry as unknown as { getProvider: () => AiProvider }).getProvider = () => provider;
  return registry;
}

describe("createPassedVerdict", () => {
  it("should create passed verdict with defaults", () => {
    const result = createPassedVerdict();
    expect(result.status).toBe("passed");
    expect(result.suggestion).toBe("");
    expect(result.confidence).toBe("high");
  });

  it("should create passed verdict with custom explanation", () => {
    const result = createPassedVerdict("Custom explanation", "Custom summary");
    expect(result.status).toBe("passed");
    expect(result.explanation).toBe("Custom explanation");
    expect(result.evidenceSummary).toBe("Custom summary");
  });
});

describe("createFailedVerdict", () => {
  it("should create failed verdict with suggestion", () => {
    const result = createFailedVerdict("File was not created");
    expect(result.status).toBe("failed");
    expect(result.suggestion).toBe("File was not created");
    expect(result.confidence).toBe("high");
  });
});

describe("createNeedsReviewVerdict", () => {
  it("should create needs_review verdict with gaps", () => {
    const result = createNeedsReviewVerdict("Insufficient evidence", [
      "missing output",
      "no files changed",
    ]);
    expect(result.status).toBe("needs_review");
    expect(result.suggestion).toBe("Insufficient evidence");
    expect(result.evidenceGaps).toEqual(["missing output", "no files changed"]);
    expect(result.confidence).toBe("low");
  });
});

describe("createSkippedVerdict", () => {
  it("should create skipped verdict with reason", () => {
    const result = createSkippedVerdict("Provider not available");
    expect(result.status).toBe("needs_review");
    expect(result.suggestion).toBe("Provider not available");
    expect(result.confidence).toBe("low");
  });
});

describe("AiVerdictSchema", () => {
  it("should accept valid passed verdict", () => {
    const result = AiVerdictSchema.parse({
      status: "passed",
      suggestion: "",
      explanation: "Task completed",
      confidence: "high",
      evidenceSummary: "All criteria met",
      evidenceGaps: [],
    });
    expect(result.status).toBe("passed");
    expect(result.suggestion).toBe("");
  });

  it("should accept valid failed verdict with suggestion", () => {
    const result = AiVerdictSchema.parse({
      status: "failed",
      suggestion: "File was not created: src/output.ts is missing",
      explanation: "Required file is missing",
      confidence: "high",
      evidenceSummary: "Evidence shows file was not created",
      evidenceGaps: ["src/output.ts"],
    });
    expect(result.status).toBe("failed");
    expect(result.suggestion).toContain("File was not created");
  });

  it("should accept valid warning verdict with suggestion", () => {
    const result = AiVerdictSchema.parse({
      status: "warning",
      suggestion: "Implementation is incomplete, missing error handling",
      explanation: "Partial implementation detected",
      confidence: "medium",
      evidenceSummary: "Some criteria met but gaps remain",
      evidenceGaps: ["error handling"],
    });
    expect(result.status).toBe("warning");
  });

  it("should reject invalid status", () => {
    expect(() => AiVerdictSchema.parse({ status: "invalid", suggestion: "" })).toThrow();
  });

  it("should reject missing required fields", () => {
    expect(() => AiVerdictSchema.parse({ status: "passed" })).toThrow();
  });
});

describe("AiValidator", () => {
  describe("validate", () => {
    it("should parse raw JSON verdict from provider", async () => {
      const provider = createMockProvider(
        JSON.stringify({
          status: "passed",
          suggestion: "",
          explanation: "File was created successfully",
          confidence: "high",
          evidenceSummary: "File exists on disk",
          evidenceGaps: [],
        }),
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Create src/index.ts",
        executorOutput: "Created src/index.ts",
      });
      expect(result.status).toBe("passed");
      expect(result.suggestion).toBe("");
      expect(result.confidence).toBe("high");
    });

    it("should extract verdict from fenced JSON block", async () => {
      const provider = createMockProvider(
        'Some text\n```json\n{"status": "failed", "suggestion": "Missing main function", "explanation": "Required function not implemented", "confidence": "high", "evidenceSummary": "Missing key implementation", "evidenceGaps": ["main function"]}\n```\nmore text',
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Create src/index.ts",
        executorOutput: "output",
      });
      expect(result.status).toBe("failed");
      expect(result.suggestion).toBe("Missing main function");
      expect(result.confidence).toBe("high");
    });

    it("should extract verdict from balanced braces in text", async () => {
      const provider = createMockProvider(
        'Here is my review:\n{"status": "warning", "suggestion": "Add error handling", "explanation": "Implementation lacks error handling", "confidence": "medium", "evidenceSummary": "Partial implementation detected", "evidenceGaps": ["error handling"]}\nEnd',
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Create src/index.ts",
        executorOutput: "output",
      });
      expect(result.status).toBe("warning");
      expect(result.suggestion).toBe("Add error handling");
      expect(result.confidence).toBe("medium");
    });

    it("should return needs_review when no executor output available", async () => {
      const provider = createMockProvider(
        '{"status":"passed","suggestion":"","explanation":"ok","confidence":"high","evidenceSummary":"ok"}',
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Test task",
        executorOutput: "",
        executorStatus: "done",
        exitCode: 0,
      });
      expect(result.status).toBe("needs_review");
      expect(result.suggestion).toContain("No executor output");
    });

    it("should return needs_review when task done with zero evidence", async () => {
      const provider = createMockProvider(
        '{"status":"passed","suggestion":"","explanation":"ok","confidence":"high","evidenceSummary":"ok"}',
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Test task",
        executorOutput: "",
        executorStatus: "done",
        exitCode: 0,
      });
      expect(result.status).toBe("needs_review");
    });

    it("should return skipped when provider is unavailable", async () => {
      const config: FlowTaskConfig = {
        version: "1.0",
        projectMode: "development",
        defaultExecutor: "opencode",
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
          provider: "missing-provider",
          model: "mock-model",
          maxRetries: 1,
          fallbackToSimple: true,
        },
        ai: { providers: {} },
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
      const registry = new ProviderRegistry(config);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Test task",
        executorOutput: "some output",
      });
      expect(result.status).toBe("needs_review");
      expect(result.suggestion).toContain("AI provider unavailable");
    });

    it("should handle AI provider returning invalid JSON gracefully", async () => {
      const provider = createMockProvider("This is not JSON at all");
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Test task",
        executorOutput: "some output",
      });
      expect(result.status).toBe("needs_review");
      expect(result.suggestion).toContain("AI validation failed");
    });

    it("should pass all evidence fields to the provider", async () => {
      let capturedPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "All evidence reviewed",
              confidence: "high",
              evidenceSummary: "Evidence confirms completion",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Implement feature X",
        executorOutput: "Feature X implemented successfully",
        errorOutput: "no errors",
        expectedResult: "Feature X is working",
        acceptanceCriteria: ["Criterion 1", "Criterion 2"],
        executorStatus: "done",
        exitCode: 0,
        changedFiles: ["src/feature-x.ts", "tests/feature-x.test.ts"],
        artifacts: ["dist/feature-x.js"],
        commandResults: "Tests passed: 10/10\nLint passed: no errors",
        outputPlan: ["create src/feature-x.ts", "create tests/feature-x.test.ts"],
        outputPlanResults: [
          { action: "create", target: "src/feature-x.ts", produced: true, evidence: "file exists" },
          {
            action: "create",
            target: "tests/feature-x.test.ts",
            produced: true,
            evidence: "file exists",
          },
        ],
        validationMode: "always",
      });

      expect(capturedPrompt).toContain("Implement feature X");
      expect(capturedPrompt).toContain("Feature X is working");
      expect(capturedPrompt).toContain("Criterion 1");
      expect(capturedPrompt).toContain("src/feature-x.ts");
      expect(capturedPrompt).toContain("dist/feature-x.js");
      expect(capturedPrompt).toContain("Tests passed: 10/10");
      expect(capturedPrompt).toContain("Output Plan Results");
      expect(capturedPrompt).toContain("Evidence Summary");
    });
  });

  describe("appendSuggestionToContext", () => {
    it("should append suggestion section to context pack", () => {
      const provider = createMockProvider('{"status":"passed","suggestion":""}');
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);

      const context = "# FlowTask Context Pack\n\n## Instructions\n- Do the thing\n";
      const verdict: AiVerdict = {
        status: "failed",
        suggestion: "The file was not created. Please create src/output.ts.",
        explanation: "Required file is missing",
        confidence: "high",
        evidenceSummary: "File does not exist on disk",
        evidenceGaps: ["src/output.ts"],
      };
      const result = validator.appendSuggestionToContext(context, verdict);

      expect(result).toContain("## AI Validation Feedback");
      expect(result).toContain("FAILED");
      expect(result).toContain("The file was not created. Please create src/output.ts.");
      expect(result).toContain(context);
    });

    it("should handle passed verdict with empty suggestion", () => {
      const provider = createMockProvider('{"status":"passed","suggestion":""}');
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);

      const context = "# Context\n";
      const verdict: AiVerdict = {
        status: "passed",
        suggestion: "",
        explanation: "All checks passed",
        confidence: "high",
        evidenceSummary: "Evidence confirms completion",
        evidenceGaps: [],
      };
      const result = validator.appendSuggestionToContext(context, verdict);
      expect(result).toContain("## AI Validation Feedback");
    });
  });

  describe("appendSuggestionToContext with various verdict types", () => {
    const provider = createMockProvider('{"status":"passed","suggestion":""}');
    const registry = createMockRegistry(provider);
    const validator = new AiValidator(registry);

    it("should append needs_review verdict with evidence gaps", () => {
      const context = "# FlowTask Context Pack\n\n## Instructions\n- Do the thing\n";
      const verdict: AiVerdict = {
        status: "needs_review",
        suggestion: "Insufficient evidence to confirm completion",
        explanation: "Cannot determine completion from available evidence",
        confidence: "low",
        evidenceSummary: "Evidence is insufficient",
        evidenceGaps: ["missing output", "no files changed"],
      };
      const result = validator.appendSuggestionToContext(context, verdict);
      expect(result).toContain("NEEDS_REVIEW");
      expect(result).toContain("Insufficient evidence to confirm completion");
      expect(result).toContain("low");
      expect(result).toContain("Cannot determine completion");
      expect(result).toContain(context);
    });

    it("should append warning verdict with explanation", () => {
      const context = "# Context\n";
      const verdict: AiVerdict = {
        status: "warning",
        suggestion: "Minor detail missing",
        explanation: "Task mostly complete",
        confidence: "medium",
        evidenceSummary: "Partial completion",
        evidenceGaps: ["minor detail"],
      };
      const result = validator.appendSuggestionToContext(context, verdict);
      expect(result).toContain("WARNING");
      expect(result).toContain("Minor detail missing");
      expect(result).toContain("medium");
      expect(result).toContain("Task mostly complete");
    });

    it("should append needs_retry verdict with explanation", () => {
      const context = "# Context\n";
      const verdict: AiVerdict = {
        status: "needs_retry",
        suggestion: "Network timeout, retry may succeed",
        explanation: "Transient failure detected",
        confidence: "medium",
        evidenceSummary: "Evidence suggests transient issue",
        evidenceGaps: [],
      };
      const result = validator.appendSuggestionToContext(context, verdict);
      expect(result).toContain("NEEDS_RETRY");
      expect(result).toContain("Network timeout, retry may succeed");
      expect(result).toContain("Transient failure detected");
    });
  });

  describe("evidence summary includes strength", () => {
    it("should include evidence strength in prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "Evidence reviewed",
              confidence: "high",
              evidenceSummary: "Evidence confirmed",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test",
        executorOutput: "done",
        changedFiles: ["file.ts"],
        commandResults: "all good",
        acceptanceCriteria: ["criterion"],
        expectedResult: "expected outcome",
        outputPlanResults: [{ action: "create", target: "file.ts", produced: true }],
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("always");
      expect(capturedSystemPrompt).toContain("Evidence Evaluation Rules");
      expect(capturedSystemPrompt).toContain("Evidence Gap Analysis");
    });
  });

  describe("checkEvidenceSufficiency edge cases", () => {
    it("should return needs_review when no executor output and task is done", async () => {
      const provider = createMockProvider(
        '{"status":"passed","suggestion":"","explanation":"ok","confidence":"high","evidenceSummary":"ok"}',
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Test task",
        executorOutput: "",
        executorStatus: "done",
        exitCode: 0,
      });
      expect(result.status).toBe("needs_review");
      expect(result.evidenceGaps).toContain("executor output");
    });

    it("should skip pre-check when executor failed even without output", async () => {
      let calledProvider = false;
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(): Promise<AiProviderResponse> {
          calledProvider = true;
          return {
            text: JSON.stringify({
              status: "failed",
              suggestion: "Task failed",
              explanation: "Executor process failed",
              confidence: "high",
              evidenceSummary: "Evidence shows failure",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Test task",
        executorOutput: "",
        executorStatus: "failed",
        exitCode: 1,
      });
      expect(calledProvider).toBe(true);
      expect(result.status).toBe("failed");
    });

    it("should return needs_review when changed files exist but no executor output (pre-check fires)", async () => {
      let calledProvider = false;
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(): Promise<AiProviderResponse> {
          calledProvider = true;
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "File changes confirmed",
              confidence: "high",
              evidenceSummary: "Evidence shows files were changed",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Implement feature",
        executorOutput: "",
        executorStatus: "done",
        exitCode: 0,
        changedFiles: ["src/feature.ts"],
      });
      expect(calledProvider).toBe(false);
      expect(result.status).toBe("needs_review");
      expect(result.evidenceGaps).toContain("executor output");
    });

    it("should return needs_review when artifacts exist but no executor output (pre-check fires)", async () => {
      let calledProvider = false;
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(): Promise<AiProviderResponse> {
          calledProvider = true;
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "Artifacts confirmed",
              confidence: "high",
              evidenceSummary: "Evidence shows artifacts created",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Build artifact",
        executorOutput: "",
        executorStatus: "done",
        exitCode: 0,
        artifacts: ["dist/bundle.js"],
      });
      expect(calledProvider).toBe(false);
      expect(result.status).toBe("needs_review");
      expect(result.evidenceGaps).toContain("executor output");
    });

    it("should return needs_review when command results exist but no executor output (pre-check fires)", async () => {
      let calledProvider = false;
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(): Promise<AiProviderResponse> {
          calledProvider = true;
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "Command results confirmed",
              confidence: "high",
              evidenceSummary: "Evidence shows tests passed",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Run tests",
        executorOutput: "",
        executorStatus: "done",
        exitCode: 0,
        commandResults: "Tests passed: 10/10",
      });
      expect(calledProvider).toBe(false);
      expect(result.status).toBe("needs_review");
      expect(result.evidenceGaps).toContain("executor output");
    });
  });

  describe("mode influences system prompt", () => {
    it("should include mode-specific fallback guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test",
        executorOutput: "output",
        validationMode: "fallback",
      });
      expect(capturedSystemPrompt).toContain("Validation Mode: fallback");
      expect(capturedSystemPrompt).toContain("fill gaps that automated checks missed");
    });

    it("should include mode-specific high_risk_only guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test",
        executorOutput: "output",
        validationMode: "high_risk_only",
      });
      expect(capturedSystemPrompt).toContain("Validation Mode: high_risk_only");
      expect(capturedSystemPrompt).toContain("prefer");
      expect(capturedSystemPrompt).toContain("needs_review");
      expect(capturedSystemPrompt).toContain("passed");
    });

    it("should include mode-specific always guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test",
        executorOutput: "output",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Validation Mode: always");
      expect(capturedSystemPrompt).toContain("AI review runs on every task");
    });

    it("should include empty guidance for off mode in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test",
        executorOutput: "output",
        validationMode: "off",
      });
      expect(capturedSystemPrompt).toContain("Validation Mode: off");
      // "off" mode should not add behavioral guidance text
      expect(capturedSystemPrompt).not.toContain("AI review runs on every task");
      expect(capturedSystemPrompt).not.toContain("fill gaps that automated checks missed");
      expect(capturedSystemPrompt).not.toContain("prefer");
    });
  });

  describe("evidence summary in user prompt", () => {
    it("should include evidence summary section with strength in user prompt", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Implement feature X",
        executorOutput: "Feature X implemented",
        errorOutput: "no errors",
        logs: "[INFO] completed",
        changedFiles: ["src/feature-x.ts"],
        artifacts: ["dist/output.js"],
        commandResults: "Tests passed",
        acceptanceCriteria: ["Criterion 1"],
        expectedResult: "Feature X works",
        outputPlanResults: [
          { action: "create", target: "src/feature-x.ts", produced: true, evidence: "file exists" },
        ],
        previousValidationResults: "[✓] process: passed",
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Evidence Summary");
      expect(capturedUserPrompt).toContain("Has stdout/stderr output: yes");
      expect(capturedUserPrompt).toContain("Changed files count: 1");
      expect(capturedUserPrompt).toContain("Has command/test results: yes");
      expect(capturedUserPrompt).toContain("Acceptance criteria count: 1");
      expect(capturedUserPrompt).toContain("Has expected result: yes");
      expect(capturedUserPrompt).toContain("Output plan items produced: 1/1");
      expect(capturedUserPrompt).toContain("Evidence strength: strong");
    });
  });

  describe("evidence strength assessment through validate", () => {
    it("should classify strong evidence with complete evidence set", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Full evidence task",
        executorOutput: "output with details",
        errorOutput: "warning info",
        changedFiles: ["file1.ts", "file2.ts"],
        artifacts: ["dist/output.js"],
        commandResults: "All tests passed\nLint clean",
        acceptanceCriteria: ["criteria met"],
        expectedResult: "expected output produced",
        outputPlanResults: [
          { action: "create", target: "file1.ts", produced: true },
          { action: "modify", target: "file2.ts", produced: true },
        ],
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Evidence strength: strong");
    });

    it("should classify moderate evidence with partial evidence set", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Partial evidence task",
        executorOutput: "some output",
        changedFiles: ["file.ts"],
        commandResults: "some test results",
        acceptanceCriteria: ["criterion"],
        expectedResult: "expected outcome",
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Evidence strength: moderate");
    });

    it("should classify weak evidence with minimal data", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Minimal evidence task",
        executorOutput: "just output",
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Evidence strength: weak");
    });

    it("should classify none evidence when only task description exists", async () => {
      const provider = createMockProvider(
        '{"status":"needs_review","suggestion":"no evidence","explanation":"none","confidence":"low","evidenceSummary":"none"}',
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "No evidence task",
        executorOutput: "",
        executorStatus: "done",
        exitCode: 0,
        validationMode: "always",
      });
      expect(result.status).toBe("needs_review");
      expect(result.evidenceGaps).toContain("executor output");
    });

    it("should classify none evidence strength when executor failed with no output", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "failed",
              suggestion: "Task failed with no output",
              explanation: "Executor process failed with no evidence",
              confidence: "high",
              evidenceSummary: "No evidence available",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Failed task no output",
        executorOutput: "",
        executorStatus: "failed",
        exitCode: 1,
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Evidence strength: none");
    });
  });

  describe("detailed verdict explanations", () => {
    it("should return verdict with proper explanation and evidence gaps for a passed task", async () => {
      const provider = createMockProvider(
        JSON.stringify({
          status: "passed",
          suggestion: "",
          explanation: "All acceptance criteria were met and the expected file was created.",
          confidence: "high",
          evidenceSummary: "File exists with correct content and tests pass",
          evidenceGaps: [],
        }),
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Create src/index.ts with proper exports",
        executorOutput: "Created src/index.ts with default and named exports",
        changedFiles: ["src/index.ts"],
        acceptanceCriteria: ["File created with exports"],
        expectedResult: "src/index.ts exists with exports",
      });
      expect(result.status).toBe("passed");
      expect(result.suggestion).toBe("");
      expect(result.explanation).toContain("acceptance criteria");
      expect(result.evidenceGaps).toEqual([]);
    });

    it("should return verdict with evidence gaps for insufficient evidence", async () => {
      const provider = createMockProvider(
        JSON.stringify({
          status: "needs_review",
          suggestion: "Cannot confirm documentation was written without file content evidence",
          explanation: "Task required writing documentation but no file changes were detected",
          confidence: "low",
          evidenceSummary: "No files were changed or created",
          evidenceGaps: ["file changes", "documentation content"],
        }),
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Write API documentation",
        executorOutput: "Documentation written successfully",
        changedFiles: [],
        acceptanceCriteria: ["API docs written to docs/api.md"],
        expectedResult: "API documentation saved to docs/api.md",
      });
      expect(result.status).toBe("needs_review");
      expect(result.evidenceGaps.length).toBeGreaterThan(0);
      expect(result.suggestion).toContain("evidence");
    });

    it("should return verdict with high confidence when evidence is strong", async () => {
      const provider = createMockProvider(
        JSON.stringify({
          status: "passed",
          suggestion: "",
          explanation:
            "All 12 tests pass, lint is clean, type check passes, and all acceptance criteria are satisfied.",
          confidence: "high",
          evidenceSummary: "Strong evidence confirms task completion",
          evidenceGaps: [],
        }),
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Fix validation bug",
        executorOutput: "12 tests passed, lint clean, type check passed",
        changedFiles: ["src/validation/engine.ts"],
        commandResults: "Tests: 12 passed\nLint: clean\nTypeScript: ok",
        acceptanceCriteria: ["Bug is fixed", "Tests pass", "Lint passes"],
        expectedResult: "Validation engine correctly validates tasks",
      });
      expect(result.status).toBe("passed");
      expect(result.confidence).toBe("high");
    });

    it("should return verdict with medium confidence when evidence is partial", async () => {
      const provider = createMockProvider(
        JSON.stringify({
          status: "warning",
          suggestion: "Main functionality works but error handling is missing",
          explanation: "Feature X is implemented but does not handle edge cases",
          confidence: "medium",
          evidenceSummary: "Partial completion with gaps in error handling",
          evidenceGaps: ["error handling", "edge cases"],
        }),
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Implement feature X with error handling",
        executorOutput: "Feature X implemented",
        changedFiles: ["src/feature-x.ts"],
        acceptanceCriteria: ["Feature X works", "Error handling included"],
        expectedResult: "Feature X with complete error handling",
      });
      expect(result.status).toBe("warning");
      expect(result.suggestion).toContain("error handling");
      expect(result.evidenceGaps).toContain("error handling");
    });
  });

  describe("default validation mode", () => {
    it("should use fallback as default mode in system prompt when no mode specified", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test default mode",
        executorOutput: "output",
      });
      expect(capturedSystemPrompt).toContain("Validation Mode: fallback");
    });
  });

  describe("evidence assessment with mixed output plan results", () => {
    it("should assess moderate strength when output plan partially produced", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Mixed output plan task",
        executorOutput: "some output",
        changedFiles: ["file1.ts"],
        commandResults: "5 tests passed, 1 failed",
        outputPlanResults: [
          { action: "create", target: "file1.ts", produced: true, evidence: "exists" },
          { action: "create", target: "file2.ts", produced: false, evidence: "missing" },
          { action: "modify", target: "file3.ts", produced: true, evidence: "modified" },
        ],
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Output plan items produced: 2/3");
      expect(capturedUserPrompt).toContain("Evidence strength: moderate");
    });

    it("should assess weak strength when only executor output exists", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Minimal evidence task",
        executorOutput: "just some output text",
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Evidence strength: weak");
    });

    it("should assess strong strength when all evidence types present", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Full evidence task",
        executorOutput: "output with details",
        errorOutput: "warning info",
        changedFiles: ["file1.ts", "file2.ts"],
        artifacts: ["dist/output.js"],
        commandResults: "All tests passed\nLint clean",
        acceptanceCriteria: ["criteria met"],
        expectedResult: "expected output produced",
        outputPlanResults: [
          { action: "create", target: "file1.ts", produced: true },
          { action: "modify", target: "file2.ts", produced: true },
        ],
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Evidence strength: strong");
    });
  });

  describe("truncation behavior", () => {
    it("should truncate very long executor output in user prompt", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const longOutput = "line\n".repeat(10000);
      await validator.validate({
        taskDescription: "Truncation test task",
        executorOutput: longOutput,
        validationMode: "always",
      });
      expect(capturedUserPrompt.length).toBeLessThan(longOutput.length);
      expect(capturedUserPrompt).toContain("[... truncated");
    });

    it("should truncate very long error output in user prompt", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const longError = "error detail\n".repeat(5000);
      await validator.validate({
        taskDescription: "Error truncation test",
        executorOutput: "some output",
        errorOutput: longError,
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("[... truncated");
    });
  });

  describe("checkEvidenceSufficiency edge case: failed executor bypasses pre-check", () => {
    it("should call AI provider when executor status is failed even without any output", async () => {
      let calledProvider = false;
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(): Promise<AiProviderResponse> {
          calledProvider = true;
          return {
            text: JSON.stringify({
              status: "failed",
              suggestion: "Task failed",
              explanation: "Executor process failed",
              confidence: "high",
              evidenceSummary: "Evidence shows failure",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Failed task no output",
        executorOutput: "",
        executorStatus: "failed",
        exitCode: 1,
      });
      expect(calledProvider).toBe(true);
      expect(result.status).toBe("failed");
    });

    it("should return needs_review when executor status is done with zero exit code and empty output but no changed files or artifacts", async () => {
      const provider = createMockProvider(
        '{"status":"passed","suggestion":"","explanation":"ok","confidence":"high","evidenceSummary":"ok"}',
      );
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      const result = await validator.validate({
        taskDescription: "Zero evidence task",
        executorOutput: "",
        executorStatus: "done",
        exitCode: 0,
      });
      expect(result.status).toBe("needs_review");
      expect(result.evidenceGaps).toContain("executor output");
    });
  });

  describe("workflow type awareness", () => {
    it("should include workflow type in user prompt", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Implement feature X",
        executorOutput: "done",
        workflowType: "code",
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("## Workflow Type");
      expect(capturedUserPrompt).toContain("code");
    });

    it("should include code-specific guidance in system prompt for code tasks", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Implement feature X",
        executorOutput: "done",
        workflowType: "code",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Code Task");
      expect(capturedSystemPrompt).toContain("file evidence");
    });

    it("should include documentation-specific guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Write API documentation",
        executorOutput: "done",
        workflowType: "documentation",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Documentation Task");
      expect(capturedSystemPrompt).toContain("structured sections");
    });

    it("should include research-specific guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Research market trends",
        executorOutput: "done",
        workflowType: "research",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Research Task");
      expect(capturedSystemPrompt).toContain("cited sources");
    });

    it("should include data-specific guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Transform CSV data",
        executorOutput: "done",
        workflowType: "data",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Data Task");
      expect(capturedSystemPrompt).toContain("data files exist");
    });

    it("should include writing-specific guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Write blog post",
        executorOutput: "done",
        workflowType: "writing",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Writing Task");
      expect(capturedSystemPrompt).toContain("grammar and formatting");
    });

    it("should include design-specific guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Design landing page",
        executorOutput: "done",
        workflowType: "design",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Design Task");
      expect(capturedSystemPrompt).toContain("design artifacts");
    });

    it("should include checklist-specific guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "QA checklist",
        executorOutput: "done",
        workflowType: "checklist",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Checklist / QA Task");
      expect(capturedSystemPrompt).toContain("completion status");
    });

    it("should include business analysis guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Analyze business requirements",
        executorOutput: "done",
        workflowType: "business_analysis",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Business Analysis Task");
      expect(capturedSystemPrompt).toContain("requirement extraction");
    });

    it("should include mixed workflow guidance in system prompt", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Mixed code and docs task",
        executorOutput: "done",
        workflowType: "mixed",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Mixed Workflow");
      expect(capturedSystemPrompt).toContain("diverse evidence");
    });

    it("should include general guidance for unknown workflow type", async () => {
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "General task",
        executorOutput: "done",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: General");
      expect(capturedSystemPrompt).toContain("standard validation criteria");
    });
  });

  describe("previous validation results in prompt", () => {
    it("should include previous validation results in user prompt", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test task",
        executorOutput: "done",
        previousValidationResults:
          "[✓] process: passed — Process exited with code 0\n  Evidence: exit code 0\n[✓] acceptance_criteria: passed — All criteria met",
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("## Previous Validation Results");
      expect(capturedUserPrompt).toContain("Process exited with code 0");
      expect(capturedUserPrompt).toContain("All criteria met");
    });

    it("should indicate previous validation results in evidence summary", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test task",
        executorOutput: "done",
        previousValidationResults: "some results here",
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Has previous validation results: yes");
    });
  });

  describe("log output in prompt", () => {
    it("should include log output section in user prompt", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test task",
        executorOutput: "stdout output",
        logs: "[INFO] Task started\n[INFO] Task completed successfully",
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("## Log Output");
      expect(capturedUserPrompt).toContain("Task started");
      expect(capturedUserPrompt).toContain("Task completed successfully");
    });

    it("should indicate log output availability in evidence summary", async () => {
      let capturedUserPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "ok",
              confidence: "high",
              evidenceSummary: "ok",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Test task",
        executorOutput: "output",
        logs: "[INFO] done",
        validationMode: "always",
      });
      expect(capturedUserPrompt).toContain("Has log output: yes");
    });
  });

  describe("combined all evidence types", () => {
    it("should include all new evidence fields for a mixed workflow task", async () => {
      let capturedUserPrompt = "";
      let capturedSystemPrompt = "";
      const provider: AiProvider = {
        name: "mock-provider",
        type: "test",
        supportsJsonObject: true,
        supportsStreaming: false,
        async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
          capturedUserPrompt = request.userPrompt ?? "";
          capturedSystemPrompt = request.systemPrompt ?? "";
          return {
            text: JSON.stringify({
              status: "passed",
              suggestion: "",
              explanation: "All evidence confirmed",
              confidence: "high",
              evidenceSummary: "Strong evidence confirms completion",
              evidenceGaps: [],
            }),
            model: "mock-model",
            provider: "mock-provider",
          };
        },
      };
      const registry = createMockRegistry(provider);
      const validator = new AiValidator(registry);
      await validator.validate({
        taskDescription: "Mixed code and documentation task",
        executorOutput: "Created src/api.ts and wrote docs/api.md",
        errorOutput: "no errors",
        logs: "[INFO] Task completed in 5.2s",
        changedFiles: ["src/api.ts", "docs/api.md"],
        artifacts: ["dist/api.js"],
        commandResults: "Tests: 15 passed\nLint: clean",
        acceptanceCriteria: ["API implemented", "Documentation written"],
        expectedResult: "API and documentation complete",
        outputPlanResults: [
          { action: "create", target: "src/api.ts", produced: true, evidence: "file exists" },
          { action: "create", target: "docs/api.md", produced: true, evidence: "file exists" },
        ],
        previousValidationResults: "[✓] process: passed\n[✓] output_plan: passed",
        workflowType: "mixed",
        validationMode: "always",
      });
      expect(capturedSystemPrompt).toContain("Workflow Type: Mixed Workflow");
      expect(capturedUserPrompt).toContain("## Workflow Type");
      expect(capturedUserPrompt).toContain("## Log Output");
      expect(capturedUserPrompt).toContain("## Previous Validation Results");
      expect(capturedUserPrompt).toContain("Has log output: yes");
      expect(capturedUserPrompt).toContain("Has previous validation results: yes");
      expect(capturedUserPrompt).toContain("Workflow type: mixed");
      expect(capturedUserPrompt).toContain("Evidence strength: strong");
    });
  });
});
