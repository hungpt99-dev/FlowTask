import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ValidationEngine } from "../../src/validation/validation-engine.js";
import { UseCaseDetector } from "../../src/usecase/usecase-detector.js";
import { SimplePlanner } from "../../src/planner/simple-planner.js";
import { PlannerContextBuilder } from "../../src/context/planner-context-builder.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";
import { getTaskTemplate, getUseCaseName } from "../../src/usecase/task-templates.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { UseCaseType, UseCaseConfig } from "../../src/usecase/usecase-types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTextFile, ensureDir } from "../../src/utils/fs.js";
import { AcceptanceCriteriaValidator } from "../../src/validation/acceptance-criteria-validator.js";

const baseTask = {
  status: "running" as const,
  executor: "shell",
  dependsOn: [] as string[],
  retryCount: 0,
  maxRetries: 2,
  createdAt: now(),
  updatedAt: now(),
};

describe("Enhanced multi-use case validation engine", () => {
  const engine = new ValidationEngine();

  const USE_CASES: {
    type: UseCaseType;
    prompt: string;
    criteria: string[];
    output: string;
    expectedStatus: "passed" | "failed" | "warning";
  }[] = [
    {
      type: "coding",
      prompt: "Build a REST API",
      criteria: ["Code is implemented", "Tests pass", "Lint passes"],
      output: "Code is implemented and tests pass. Lint passes with 0 errors.",
      expectedStatus: "passed",
    },
    {
      type: "documentation",
      prompt: "Write README",
      criteria: ["Docs are complete", "API endpoints are documented"],
      output: "Docs are complete. API endpoints are documented.",
      expectedStatus: "passed",
    },
    {
      type: "debugging",
      prompt: "Fix login crash",
      criteria: ["Fix is applied correctly", "Root cause is identified"],
      output: "Root cause is identified and fix is applied correctly.",
      expectedStatus: "passed",
    },
    {
      type: "research",
      prompt: "Research auth methods",
      criteria: ["Research results are documented", "Sources are cited"],
      output: "Research results are documented in report.md. Sources are cited.",
      expectedStatus: "passed",
    },
    {
      type: "planning",
      prompt: "Plan migration",
      criteria: ["Detailed plan is created", "Task breakdown is complete"],
      output: "Detailed plan is created with task breakdown.",
      expectedStatus: "passed",
    },
    {
      type: "project-setup",
      prompt: "Set up monorepo",
      criteria: ["Project structure is created", "Dependencies are installed"],
      output: "Project structure is created. Dependencies are installed.",
      expectedStatus: "passed",
    },
    {
      type: "testing",
      prompt: "Write unit tests",
      criteria: ["All tests pass", "Test coverage is adequate"],
      output: "All tests pass. Test coverage is adequate at 85%.",
      expectedStatus: "passed",
    },
    {
      type: "devops",
      prompt: "Deploy to production",
      criteria: ["Deployment validation passes", "Configuration files created"],
      output: "Deployment validation passes. Configuration files created.",
      expectedStatus: "passed",
    },
    {
      type: "data-analysis",
      prompt: "Analyze user data",
      criteria: ["Data analysis is complete", "Visualizations are created"],
      output: "Data analysis is complete and visualizations are created.",
      expectedStatus: "passed",
    },
    {
      type: "ui-design",
      prompt: "Design dashboard",
      criteria: ["UI changes are implemented", "UI quality checks pass"],
      output: "UI changes are implemented. UI quality checks pass.",
      expectedStatus: "passed",
    },
    {
      type: "writing",
      prompt: "Write newsletter",
      criteria: ["Content is written", "Content is reviewed and finalized"],
      output: "Content is written. Content is reviewed and finalized.",
      expectedStatus: "passed",
    },
  ];

  for (const uc of USE_CASES) {
    it(`should validate ${uc.type} task acceptance criteria via engine`, async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: `task_${uc.type}`,
          runId: "run_use_case",
          title: `${uc.type} task`,
          acceptanceCriteria: uc.criteria,
        },
        executorResult: {
          status: "done",
          exitCode: 0,
          output: uc.output,
          startedAt: now(),
          finishedAt: now(),
        },
      });

      expect(result.status).toBe(uc.expectedStatus);
      const criteriaChecks = result.checks.filter((c) => c.type === "acceptance_criteria");
      expect(criteriaChecks.length).toBe(uc.criteria.length);
      for (const check of criteriaChecks) {
        expect(check.status).toBe("passed");
      }
    });

    it(`should fail ${uc.type} validation when process fails`, async () => {
      const result = await engine.validateTask({
        projectRoot: testDir,
        task: {
          ...baseTask,
          id: `task_fail_${uc.type}`,
          runId: "run_fail",
          title: `${uc.type} failing task`,
          acceptanceCriteria: uc.criteria,
        },
        executorResult: {
          status: "failed",
          exitCode: 1,
          output: "Process failed with an error",
          error: "Something went wrong",
          startedAt: now(),
          finishedAt: now(),
        },
      });

      expect(result.status).toBe("failed");
      const processCheck = result.checks.find((c) => c.type === "process");
      expect(processCheck?.status).toBe("failed");
    });
  }
});

describe("Planner context builder with use case detection", () => {
  const config = generateDefaultConfig();
  const builder = new PlannerContextBuilder(config);

  const USE_CASES: { type: UseCaseType; prompt: string }[] = [
    { type: "coding", prompt: "Implement a new API endpoint for user profiles" },
    { type: "documentation", prompt: "Create API documentation for the payment integration" },
    { type: "debugging", prompt: "Fix the memory leak in the authentication module" },
    { type: "research", prompt: "Research authentication methods for microservices" },
    { type: "planning", prompt: "Plan the migration from monolith to microservices" },
    { type: "project-setup", prompt: "Set up a monorepo with Turborepo" },
    { type: "testing", prompt: "Write integration tests for the checkout flow" },
    { type: "devops", prompt: "Deploy the application to Kubernetes" },
    { type: "data-analysis", prompt: "Analyze user behavior data and create visualizations" },
    { type: "ui-design", prompt: "Design a new dashboard interface with accessibility" },
    { type: "writing", prompt: "Write an email newsletter for our product launch" },
  ];

  for (const uc of USE_CASES) {
    it(`should include ${uc.type} use case display name in planner context`, () => {
      const context = builder.build({
        prompt: uc.prompt,
        rulesContext: "Test rules",
        projectRoot: testDir,
        config,
        availableExecutors: ["shell", "opencode"],
      });

      const useCaseName = getUseCaseName(uc.type);
      expect(context).toContain(useCaseName);
      expect(context).toContain("Detected Use Case");
    });
  }

  it("should not include use case heading for general prompts", () => {
    const context = builder.build({
      prompt: "Help me with my project",
      rulesContext: "",
      projectRoot: testDir,
      config,
      availableExecutors: ["shell"],
    });
    expect(context).not.toContain("Detected Use Case");
  });

  it("should include the JSON schema in context", () => {
    const context = builder.build({
      prompt: "Build a feature",
      rulesContext: "",
      projectRoot: testDir,
      config,
      availableExecutors: ["shell"],
    });
    expect(context).toContain("Expected JSON Output Schema");
    expect(context).toContain("title");
    expect(context).toContain("summary");
    expect(context).toContain("acceptanceCriteria");
  });
});

describe("UseCaseDetector edge cases", () => {
  const detector = new UseCaseDetector();

  it("should detect multiple matching use cases and pick highest confidence", () => {
    const result = detector.detect("Fix a bug in the deployment pipeline and add tests");
    expect(["debugging", "devops", "testing"]).toContain(result.type);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.matchedPatterns.length).toBeGreaterThan(1);
  });

  it("should return general for low-confidence prompts", () => {
    const highThreshold: UseCaseConfig = {
      enabled: true,
      customPatterns: [],
      confidenceThreshold: 0.9,
    };
    const strictDetector = new UseCaseDetector(highThreshold);
    const result = strictDetector.detect("Write some code please");
    expect(result.type).toBe("general");
    expect(result.confidence).toBe(0);
  });

  it("should respect custom confidence threshold", () => {
    const lowThreshold: UseCaseConfig = {
      enabled: true,
      customPatterns: [],
      confidenceThreshold: 0.1,
    };
    const lenientDetector = new UseCaseDetector(lowThreshold);
    const result = lenientDetector.detect("investigate and research options");
    expect(result.type).toBe("research");
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);
  });

  it("should include all matched patterns in result", () => {
    const result = detector.detect("Implement the feature and build a new API endpoint");
    expect(result.matchedPatterns.length).toBeGreaterThanOrEqual(2);
    expect(result.type).toBe("coding");
  });

  it("should merge custom patterns with defaults", () => {
    const config: UseCaseConfig = {
      enabled: true,
      customPatterns: [{ type: "coding", patterns: ["\\bmy-custom-action\\b"] }],
      confidenceThreshold: 0.3,
    };
    const customDetector = new UseCaseDetector(config);
    const result = customDetector.detect("Run my-custom-action for the project");
    expect(result.type).toBe("coding");
  });

  it("should add custom patterns to existing type when type already exists", () => {
    const config: UseCaseConfig = {
      enabled: true,
      customPatterns: [{ type: "debugging", patterns: ["\\bmy-custom-debug-pattern\\b"] }],
      confidenceThreshold: 0.3,
    };
    const customDetector = new UseCaseDetector(config);
    const result = customDetector.detect("Found a my-custom-debug-pattern that needs fixing");
    expect(result.type).toBe("debugging");
  });

  it("should provide use case hints for all types", () => {
    const types: UseCaseType[] = [
      "coding",
      "documentation",
      "debugging",
      "research",
      "planning",
      "project-setup",
      "testing",
      "devops",
      "data-analysis",
      "ui-design",
      "writing",
      "general",
    ];
    for (const type of types) {
      const hint = detector.getUseCaseHint(type);
      expect(hint.length).toBeGreaterThan(0);
      expect(hint).toContain("This is a");
    }
  });

  it("should detect coding from aggregate patterns like frontend and backend", () => {
    const result = detector.detect(
      "Build a full-stack app with frontend in React and backend in Node",
    );
    expect(result.type).toBe("coding");
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it("should detect data analysis from machine learning prompts", () => {
    const result = detector.detect("Train a machine learning model on the customer dataset");
    expect(result.type).toBe("data-analysis");
  });

  it("should detect writing from content creation prompts", () => {
    const result = detector.detect("Create a blog post about DevOps best practices");
    expect(result.type).toBe("writing");
  });

  it("should detect general for very short prompts", () => {
    const result = detector.detect("Hi");
    expect(result.type).toBe("general");
  });
});

describe("SimplePlanner with use case detection integration", () => {
  const planner = new SimplePlanner();

  it("should use provided use case detection instead of re-detecting", async () => {
    const detection = {
      type: "documentation" as UseCaseType,
      confidence: 0.95,
      matchedPatterns: ["document"],
    };
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Fix the bug in the payment module",
      rulesContext: "",
      useCase: detection,
    });

    expect(result.planMarkdown).toContain("Documentation");
    expect(result.planMarkdown).toContain("95%");
  });

  it("should auto-detect use case when not provided", async () => {
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Fix the bug in the payment module",
      rulesContext: "",
    });

    expect(result.planMarkdown).toContain("Debugging");
  });

  it("should include use case confidence in plan markdown", async () => {
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Deploy the application to Kubernetes",
      rulesContext: "",
    });

    expect(result.planMarkdown).toContain("DevOps");
    expect(result.planMarkdown).toContain("%");
  });

  it("should generate unique task IDs", async () => {
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Do something",
      rulesContext: "",
    });

    const ids = result.tasks.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe("Use case template acceptance criteria coverage", () => {
  const ALL_TYPES: UseCaseType[] = [
    "coding",
    "documentation",
    "debugging",
    "research",
    "planning",
    "project-setup",
    "testing",
    "devops",
    "data-analysis",
    "ui-design",
    "writing",
    "general",
  ];

  for (const type of ALL_TYPES) {
    it(`${type} template should have all tasks with meaningful acceptance criteria`, () => {
      const template = getTaskTemplate(type);
      for (const task of template.tasks) {
        expect(task.acceptanceCriteria.length).toBeGreaterThan(0);
        for (const criterion of task.acceptanceCriteria) {
          expect(criterion.trim().length).toBeGreaterThan(5);
        }
      }
    });
  }

  it("every use case should end with a report/finalization task", () => {
    for (const type of ALL_TYPES) {
      const template = getTaskTemplate(type);
      const lastTask = template.tasks[template.tasks.length - 1]!;
      const reportKeywords = ["report", "finalize", "verify", "final"];
      const hasReport = reportKeywords.some((kw) => lastTask.title.toLowerCase().includes(kw));
      expect(hasReport).toBe(true);
    }
  });

  it("all templates should start with reading project rules", () => {
    for (const type of ALL_TYPES) {
      const template = getTaskTemplate(type);
      const firstTask = template.tasks[0]!;
      expect(firstTask.title.toLowerCase()).toContain("read project");
    }
  });
});

describe("Acceptance criteria validation across use case types", () => {
  const validator = new AcceptanceCriteriaValidator();

  it("should pass criteria with test keywords when process passes", async () => {
    const checks = await validator.validate(
      ["All tests pass", "Lint check passes", "Typecheck passes"],
      {
        status: "done",
        exitCode: 0,
        output: "Build completed",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks.length).toBe(3);
    for (const check of checks) {
      expect(check.status).toBe("passed");
    }
  });

  it("should pass criteria with matching output text", async () => {
    const checks = await validator.validate(
      ["Report is generated and saved to output.md", "All tests pass"],
      {
        status: "done",
        exitCode: 0,
        output: "Report is generated and saved to output.md. All tests pass.",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks.length).toBe(2);
    for (const check of checks) {
      expect(check.status).toBe("passed");
    }
  });

  it("should handle writing-specific criteria", async () => {
    const checks = await validator.validate(
      ["Content is written and finalized for the newsletter"],
      {
        status: "done",
        exitCode: 0,
        output: "Content is written and finalized for the newsletter",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks[0]?.status).toBe("passed");
  });

  it("should handle data analysis specific criteria", async () => {
    const checks = await validator.validate(
      ["Data analysis is complete and visualizations are created"],
      {
        status: "done",
        exitCode: 0,
        output: "Data analysis is complete and visualizations are created",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks[0]?.status).toBe("passed");
  });

  it("should handle ui design specific criteria", async () => {
    const checks = await validator.validate(
      ["UI changes are implemented and quality checks pass"],
      {
        status: "done",
        exitCode: 0,
        output: "UI changes are implemented and quality checks pass",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );
    expect(checks[0]?.status).toBe("passed");
  });
});

describe("UseCaseDetector configuration edge cases", () => {
  it("should handle empty custom patterns", () => {
    const config: UseCaseConfig = {
      enabled: true,
      customPatterns: [],
      confidenceThreshold: 0.3,
    };
    const detector = new UseCaseDetector(config);
    const result = detector.detect("Implement a new feature");
    expect(result.type).toBe("coding");
  });

  it("should handle null config gracefully", () => {
    const detector = new UseCaseDetector(undefined);
    const result = detector.detect("Research the best database options");
    expect(result.type).toBe("research");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should prefer more specific use case over general", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Write a blog post about coding best practices");
    expect(result.type).toBe("writing");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should detect planning from design prompts", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Design the architecture for our new system");
    expect(result.type).toBe("planning");
  });

  it("should detect ui-design from interface prompts", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Create a responsive layout with CSS grid and flexbox");
    expect(result.type).toBe("ui-design");
  });
});

describe("Validation engine with process-only checks across use cases", () => {
  const engine = new ValidationEngine();

  it("should pass process-only check for planning use case", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_planning",
        runId: "run_planning",
        title: "Create plan",
        acceptanceCriteria: [],
      },
      executorResult: {
        status: "done",
        exitCode: 0,
        output: "Plan created successfully",
        startedAt: now(),
        finishedAt: now(),
      },
    });
    expect(result.status).toBe("passed");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.type).toBe("process");
  });

  it("should fail process-only check for research use case", async () => {
    const result = await engine.validateTask({
      projectRoot: testDir,
      task: {
        ...baseTask,
        id: "task_research",
        runId: "run_research",
        title: "Conduct research",
        acceptanceCriteria: [],
      },
      executorResult: {
        status: "failed",
        exitCode: 1,
        output: "Research failed",
        error: "Could not find sources",
        startedAt: now(),
        finishedAt: now(),
      },
    });
    expect(result.status).toBe("failed");
    expect(result.checks[0]?.type).toBe("process");
    expect(result.checks[0]?.status).toBe("failed");
  });
});
