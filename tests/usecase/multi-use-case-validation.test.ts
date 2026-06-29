import { describe, it, expect } from "vitest";
import { SimplePlanner } from "../../src/planner/simple-planner.js";
import { AcceptanceCriteriaValidator } from "../../src/validation/acceptance-criteria-validator.js";
import { testDir } from "../setup.js";
import { now } from "../../src/utils/time.js";
import { UseCaseDetector } from "../../src/usecase/usecase-detector.js";
import { getTaskTemplate, getUseCaseName } from "../../src/usecase/task-templates.js";
import type { UseCaseType } from "../../src/usecase/usecase-types.js";

describe("Multi-use-case planner → validation flow", () => {
  const planner = new SimplePlanner();
  const criteriaValidator = new AcceptanceCriteriaValidator();

  const USE_CASES: {
    type: UseCaseType;
    prompt: string;
    expectedTitle: string;
    expectedTaskCount: number;
    validationOutput: string;
  }[] = [
    {
      type: "coding",
      prompt: "Implement a new API endpoint for user profiles",
      expectedTitle: "Software Development",
      expectedTaskCount: 8,
      validationOutput: "Implementation files are created or modified. Tests pass.",
    },
    {
      type: "documentation",
      prompt: "Create API documentation for the payment integration",
      expectedTitle: "Documentation",
      expectedTaskCount: 6,
      validationOutput: "Documentation content is complete and saved to docs/api.md",
    },
    {
      type: "debugging",
      prompt: "Fix the memory leak in the authentication module",
      expectedTitle: "Debugging",
      expectedTaskCount: 7,
      validationOutput: "Fix is applied correctly and tests pass after fix",
    },
    {
      type: "research",
      prompt: "Research authentication methods for our microservices system",
      expectedTitle: "Research",
      expectedTaskCount: 6,
      validationOutput: "Research results are documented in research-report.md",
    },
    {
      type: "planning",
      prompt: "Plan the migration approach from monolith to microservices",
      expectedTitle: "Planning",
      expectedTaskCount: 7,
      validationOutput: "Detailed plan is created with task breakdown",
    },
    {
      type: "project-setup",
      prompt: "Set up a monorepo with Turborepo and pnpm workspaces",
      expectedTitle: "Project Setup",
      expectedTaskCount: 7,
      validationOutput: "Project structure is created and tools configured",
    },
    {
      type: "testing",
      prompt: "Write integration tests for the checkout flow",
      expectedTitle: "Testing",
      expectedTaskCount: 7,
      validationOutput: "All tests pass. Test report is saved.",
    },
    {
      type: "devops",
      prompt: "Deploy the application to Kubernetes with Helm charts",
      expectedTitle: "DevOps",
      expectedTaskCount: 7,
      validationOutput: "Deployment validation passes. Configuration files created.",
    },
    {
      type: "data-analysis",
      prompt: "Analyze user behavior data and create visualizations",
      expectedTitle: "Data Analysis",
      expectedTaskCount: 7,
      validationOutput: "Data analysis is complete. Visualizations created.",
    },
    {
      type: "ui-design",
      prompt: "Design a new dashboard interface with accessibility in mind",
      expectedTitle: "UI/UX Design",
      expectedTaskCount: 7,
      validationOutput: "UI changes are implemented. UI quality checks pass.",
    },
    {
      type: "writing",
      prompt: "Write an email newsletter for our product launch",
      expectedTitle: "Writing",
      expectedTaskCount: 6,
      validationOutput: "Content is written and finalized for the newsletter.",
    },
    {
      type: "general",
      prompt: "Help me take a look at my project and give suggestions",
      expectedTitle: "General",
      expectedTaskCount: 7,
      validationOutput: "Implementation is complete. All quality checks pass.",
    },
  ];

  for (const uc of USE_CASES) {
    it(`should plan ${uc.type} use case with correct task count and structure`, async () => {
      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt: uc.prompt,
        rulesContext: "",
      });

      expect(result.tasks.length).toBe(uc.expectedTaskCount);
      expect(result.planMarkdown).toContain(uc.expectedTitle);
      expect(result.tasks[0]!.status).toBe("pending");

      for (const task of result.tasks) {
        expect(task.title).toBeTruthy();
        expect(task.description).toBeTruthy();
        expect(task.executor).toBe("shell");
        expect(task.acceptanceCriteria.length).toBeGreaterThan(0);
        expect(task.id).toBeTruthy();
        expect(task.runId).toBeTruthy();
      }
    });

    it(`should validate acceptance criteria for ${uc.type} use case`, async () => {
      const checks = await criteriaValidator.validate(
        [uc.validationOutput],
        {
          status: "done",
          exitCode: 0,
          output: uc.validationOutput,
          startedAt: now(),
          finishedAt: now(),
        },
        testDir,
      );

      expect(checks.length).toBeGreaterThan(0);
      expect(checks[0]?.type).toBe("acceptance_criteria");
      expect(checks[0]?.status).toBe("passed");
    });

    it(`should detect ${uc.type} from prompt via UseCaseDetector`, () => {
      const detector = new UseCaseDetector();
      const result = detector.detect(uc.prompt);
      expect(result.type).toBe(uc.type);
      if (uc.type === "general") {
        expect(result.confidence).toBe(0);
      } else {
        expect(result.confidence).toBeGreaterThan(0);
      }
    });
  }

  it("should generate unique task IDs across all use case plans", async () => {
    const allIds = new Set<string>();
    for (const uc of USE_CASES) {
      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt: uc.prompt,
        rulesContext: "",
      });
      for (const task of result.tasks) {
        expect(allIds.has(task.id)).toBe(false);
        allIds.add(task.id);
      }
    }
  });
});

describe("Use-case template structure consistency", () => {
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
    it(`${type} template should have unique task titles`, () => {
      const template = getTaskTemplate(type);
      const titles = template.tasks.map((t) => t.title);
      const unique = new Set(titles);
      expect(unique.size).toBe(titles.length);
    });

    it(`${type} template should have non-empty descriptions for every task`, () => {
      const template = getTaskTemplate(type);
      for (const task of template.tasks) {
        expect(task.description.trim().length).toBeGreaterThan(0);
      }
    });

    it(`${type} template should have at least one acceptance criterion per task`, () => {
      const template = getTaskTemplate(type);
      for (const task of template.tasks) {
        expect(task.acceptanceCriteria.length).toBeGreaterThanOrEqual(1);
      }
    });

    it(`${type} template should end with a report or finalization task`, () => {
      const template = getTaskTemplate(type);
      const lastTask = template.tasks[template.tasks.length - 1]!;
      const reportKeywords = ["report", "finalize", "verify", "final"];
      const hasReportTask = reportKeywords.some((kw) => lastTask.title.toLowerCase().includes(kw));
      expect(hasReportTask).toBe(true);
    });
  }

  it("should provide unique display names for all use cases", () => {
    const names = new Set<string>();
    for (const type of ALL_TYPES) {
      const name = getUseCaseName(type);
      expect(name.length).toBeGreaterThan(0);
      names.add(name);
    }
    expect(names.size).toBe(ALL_TYPES.length);
  });
});

describe("Task dependency chains across use cases", () => {
  const planner = new SimplePlanner();

  const PROMPTS: { type: UseCaseType; prompt: string }[] = [
    { type: "coding", prompt: "Write a new authentication service" },
    { type: "devops", prompt: "Set up CI/CD pipeline" },
    { type: "writing", prompt: "Write technical documentation" },
    { type: "data-analysis", prompt: "Analyze customer churn data" },
    { type: "ui-design", prompt: "Redesign the settings panel" },
    { type: "testing", prompt: "Write end-to-end tests" },
  ];

  for (const { type, prompt } of PROMPTS) {
    it(`${type} tasks should form a valid sequential dependency chain`, async () => {
      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt,
        rulesContext: "",
      });

      expect(result.tasks[0]!.dependsOn).toEqual([]);
      for (let i = 1; i < result.tasks.length; i++) {
        expect(result.tasks[i]!.dependsOn).toContain(result.tasks[i - 1]!.id);
        expect(result.tasks[i]!.dependsOn.length).toBe(1);
      }
    });
  }
});

describe("Validation engine integration with use case templates", () => {
  const criteriaValidator = new AcceptanceCriteriaValidator();

  it("should verify coding task criteria with file evidence", async () => {
    const template = getTaskTemplate("coding");
    const codeTask = template.tasks.find((t) => t.title.toLowerCase().includes("implement code"));
    expect(codeTask).toBeDefined();

    const checks = await criteriaValidator.validate(
      codeTask!.acceptanceCriteria,
      {
        status: "done",
        exitCode: 0,
        output: "Implementation files are created or modified",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );

    expect(checks.length).toBe(codeTask!.acceptanceCriteria.length);
  });

  it("should verify writing task criteria with content evidence", async () => {
    const template = getTaskTemplate("writing");
    const writeTask = template.tasks.find((t) => t.title.toLowerCase().includes("write content"));
    expect(writeTask).toBeDefined();

    const checks = await criteriaValidator.validate(
      writeTask!.acceptanceCriteria,
      {
        status: "done",
        exitCode: 0,
        output: "Content is written and finalized",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );

    expect(checks.length).toBe(writeTask!.acceptanceCriteria.length);
  });

  it("should handle mixed pass/warning results across different criteria types", async () => {
    const criteria = [
      "Process completed successfully",
      "This very specific non-matching criterion that will never appear in output",
    ];

    const checks = await criteriaValidator.validate(
      criteria,
      {
        status: "done",
        exitCode: 0,
        output: "Process completed successfully and all tests pass",
        startedAt: now(),
        finishedAt: now(),
      },
      testDir,
    );

    expect(checks).toHaveLength(2);
    const passed = checks.filter((c) => c.status === "passed");
    const warnings = checks.filter((c) => c.status === "warning");
    expect(passed.length).toBe(1);
    expect(warnings.length).toBe(1);
  });
});
