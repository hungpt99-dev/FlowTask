import { describe, it, expect } from "vitest";
import { SimplePlanner } from "../../src/planner/simple-planner.js";
import { testDir } from "../setup.js";

describe("SimplePlanner", () => {
  it("should create a plan from a prompt", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Implement login feature",
      rulesContext: "",
    });

    expect(result.title).toBe("Implement login feature");
    expect(result.planMarkdown).toContain("# Plan");
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.tasks[0]?.status).toBe("pending");
  });

  it("should detect use case from prompt and generate appropriate tasks", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Fix login bug",
      rulesContext: "",
    });

    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.tasks[0]!.title).toContain("Read project rules");
  });

  it("should route to coding template for implementation prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Implement a REST API for user management",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(8);
    expect(result.tasks[4]!.title).toContain("Implement code changes");
    expect(result.tasks[5]!.title).toContain("Add tests");
  });

  it("should route to debugging template for bug fix prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Fix the crash when submitting the form",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(7);
    expect(result.tasks[1]!.title).toContain("Understand the error");
    expect(result.tasks[3]!.title).toContain("Identify root cause");
  });

  it("should route to documentation template for doc prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Write API documentation for the auth module",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(6);
    expect(result.tasks[3]!.title).toContain("Create documentation outline");
    expect(result.tasks[4]!.title).toContain("Write documentation");
  });

  it("should route to testing template for test prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Write unit tests for the payment service",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(7);
    expect(result.tasks[2]!.title).toContain("Design test strategy");
    expect(result.tasks[3]!.title).toContain("Implement test cases");
  });

  it("should route to research template for research prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Research the best authentication library for Node.js",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(6);
    expect(result.tasks[1]!.title).toContain("Define research questions");
  });

  it("should route to planning template for planning prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Plan the architecture for the new payment system",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(5);
    expect(result.tasks[3]!.title).toContain("Create detailed plan");
  });

  it("should route to devops template for deployment prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Deploy the application to production with Docker and set up CI/CD",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(6);
    expect(result.tasks[2]!.title).toContain("Create or update configuration");
    expect(result.tasks[3]!.title).toContain("DevOps changes");
  });

  it("should route to data-analysis template for data prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Analyze the sales data and create a correlation report",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(6);
    expect(result.tasks[1]!.title).toContain("data requirements");
    expect(result.tasks[3]!.title).toContain("Analyze and process data");
  });

  it("should route to ui-design template for UI prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Design a responsive UI with a new component library",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(7);
    expect(result.tasks[3]!.title).toContain("Design UI components");
    expect(result.tasks[5]!.title).toContain("Verify UI quality");
  });

  it("should route to writing template for content creation prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Write a blog post about our new feature release for the company blog",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(5);
    expect(result.tasks[1]!.title).toContain("writing requirements");
    expect(result.tasks[3]!.title).toContain("Write content");
  });

  it("should route to project-setup template for setup prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Set up a new project with Next.js and Tailwind",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(6);
    expect(result.tasks[2]!.title).toContain("Create project structure");
    expect(result.tasks[3]!.title).toContain("Configure tools and dependencies");
  });

  it("should use general template for ambiguous prompts", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Hello world",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(7);
    expect(result.tasks[4]!.title).toContain("Execute implementation");
  });

  it("should accept explicit use case detection override", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Do some work",
      rulesContext: "",
      useCase: { type: "coding", confidence: 0.9, matchedPatterns: [] },
    });

    expect(result.tasks.length).toBe(8);
    expect(result.tasks[4]!.title).toContain("Implement code changes");
  });

  it("should generate tasks with unique IDs", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Fix login bug",
      rulesContext: "",
    });

    const taskIds = result.tasks.map((t) => t.id);
    const uniqueIds = new Set(taskIds);
    expect(uniqueIds.size).toBe(taskIds.length);
  });

  it("should set sequential dependencies between tasks", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Add logging",
      rulesContext: "",
    });

    expect(result.tasks[0]!.dependsOn).toEqual([]);
    for (let i = 1; i < result.tasks.length; i++) {
      expect(result.tasks[i]!.dependsOn).toContain(result.tasks[i - 1]!.id);
    }
  });

  it("should truncate long prompts for title", async () => {
    const planner = new SimplePlanner();
    const longPrompt = "a".repeat(200);
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: longPrompt,
      rulesContext: "",
    });
    expect(result.title.length).toBeLessThanOrEqual(80);
  });

  it("should include use case info in plan markdown", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Fix the login bug in the authentication module",
      rulesContext: "",
    });

    expect(result.planMarkdown).toContain("Use Case");
    expect(result.planMarkdown).toContain("Debugging");
  });
});
