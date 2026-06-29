import { describe, it, expect, beforeEach } from "vitest";
import { TemplateRegistry, inferTemplateId } from "../../src/templates/template-registry.js";
import { WorkflowTemplateSchema } from "../../src/schemas/template.schema.js";

describe("TemplateRegistry", () => {
  let registry: TemplateRegistry;

  beforeEach(() => {
    registry = new TemplateRegistry();
    registry.clearCache();
  });

  it("should load all template JSON files", async () => {
    const templates = await registry.loadAll();
    expect(templates.length).toBeGreaterThanOrEqual(22);
  });

  it("should return valid workflow templates", async () => {
    const templates = await registry.loadAll();
    for (const t of templates) {
      const result = WorkflowTemplateSchema.safeParse(t);
      expect(result.success).toBe(true);
    }
  });

  it("should get a specific template by ID", async () => {
    const template = await registry.getTemplate("general-task");
    expect(template).toBeDefined();
    expect(template!.id).toBe("general-task");
    expect(template!.steps.length).toBeGreaterThan(0);
  });

  it("should get a template by workflow type", async () => {
    const template = await registry.getTemplateByWorkflowType("code-feature");
    expect(template).toBeDefined();
    expect(template!.workflowType).toBe("code-feature");
  });

  it("should return undefined for unknown template ID", async () => {
    const template = await registry.getTemplate("non-existent-template");
    expect(template).toBeUndefined();
  });

  it("should find templates by category", async () => {
    const templates = await registry.findTemplates({ category: "code" });
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.category).toBe("code");
    }
  });

  it("should find templates by tag", async () => {
    const templates = await registry.findTemplates({ tag: "code" });
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.tags).toContain("code");
    }
  });

  it("should find templates by workflow type", async () => {
    const templates = await registry.findTemplates({ workflowType: "bug-fix" });
    expect(templates.length).toBe(1);
    expect(templates[0]!.id).toBe("bug-fix");
  });

  it("should list all categories", async () => {
    const categories = await registry.listCategories();
    expect(categories).toContain("code");
    expect(categories).toContain("content");
    expect(categories).toContain("analysis");
    expect(categories).toContain("data");
    expect(categories).toContain("operations");
    expect(categories).toContain("general");
    expect(categories).toContain("quality");
    expect(categories).toContain("creative");
  });

  it("should list all workflow types", async () => {
    const types = await registry.listWorkflowTypes();
    expect(types).toContain("general-task");
    expect(types).toContain("code-feature");
    expect(types).toContain("bug-fix");
    expect(types).toContain("refactor");
    expect(types).toContain("test-generation");
    expect(types).toContain("documentation");
    expect(types).toContain("research");
  });

  it("should get template names summary", async () => {
    const names = await registry.getTemplateNames();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(n.id).toBeTruthy();
      expect(n.name).toBeTruthy();
      expect(n.category).toBeTruthy();
      expect(n.typicalSteps).toBeGreaterThan(0);
    }
  });

  it("should have general-task template with 7 steps", async () => {
    const template = await registry.getTemplate("general-task");
    expect(template).toBeDefined();
    expect(template!.steps.length).toBe(7);
  });

  it("should have code-feature template with 8 steps", async () => {
    const template = await registry.getTemplate("code-feature");
    expect(template).toBeDefined();
    expect(template!.steps.length).toBe(8);
  });

  it("should have bug-fix template with root cause analysis", async () => {
    const template = await registry.getTemplate("bug-fix");
    expect(template).toBeDefined();
    const stepTitles = template!.steps.map((s) => s.title);
    expect(stepTitles.some((t) => t.toLowerCase().includes("root cause"))).toBe(true);
  });

  it("should have refactor template with impact analysis", async () => {
    const template = await registry.getTemplate("refactor");
    expect(template).toBeDefined();
    const stepTitles = template!.steps.map((s) => s.title);
    expect(stepTitles.some((t) => t.toLowerCase().includes("impact"))).toBe(true);
  });

  it("should have release-checklist template requiring approval", async () => {
    const template = await registry.getTemplate("release-checklist");
    expect(template).toBeDefined();
    const approvalSteps = template!.steps.filter((s) => s.approvalRequired);
    expect(approvalSteps.length).toBeGreaterThan(0);
    expect(template!.defaultMode).toBe("manual");
  });

  it("should have mixed template with 8 steps", async () => {
    const template = await registry.getTemplate("mixed");
    expect(template).toBeDefined();
    expect(template!.steps.length).toBe(8);
  });

  it("should have operations template with dangerous risk level", async () => {
    const template = await registry.getTemplate("operations");
    expect(template).toBeDefined();
    const dangerousSteps = template!.steps.filter((s) => s.riskLevel === "dangerous");
    expect(dangerousSteps.length).toBeGreaterThan(0);
  });

  it("should have data analysis template with visualization step", async () => {
    const template = await registry.getTemplate("data-analysis");
    expect(template).toBeDefined();
    const stepTitles = template!.steps.map((s) => s.title);
    expect(stepTitles.some((t) => t.toLowerCase().includes("visual"))).toBe(true);
  });

  it("should cache templates after first load", async () => {
    const first = await registry.loadAll();
    const second = await registry.loadAll();
    expect(first).toBe(second);
  });

  it("should clear cache on demand", async () => {
    await registry.loadAll();
    registry.clearCache();
    const templates = await registry.loadAll();
    expect(templates.length).toBeGreaterThan(0);
  });

  it("should count templates", async () => {
    const count = await registry.count();
    expect(count).toBeGreaterThanOrEqual(22);
  });

  it("should have all steps with acceptance criteria", async () => {
    const templates = await registry.loadAll();
    for (const t of templates) {
      for (const step of t.steps) {
        expect(step.acceptanceCriteria.length).toBeGreaterThan(0);
      }
    }
  });

  it("should have all steps with title and description", async () => {
    const templates = await registry.loadAll();
    for (const t of templates) {
      for (const step of t.steps) {
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.description.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("inferTemplateId", () => {
  it("should infer general-task for generic prompts", () => {
    expect(inferTemplateId("do something")).toBe("general-task");
    expect(inferTemplateId("help me with a task")).toBe("general-task");
  });

  it("should infer bug-fix for bug-related prompts", () => {
    expect(inferTemplateId("fix the login bug")).toBe("bug-fix");
    expect(inferTemplateId("debug the crash")).toBe("bug-fix");
    expect(inferTemplateId("fix error in payment")).toBe("bug-fix");
  });

  it("should infer code-feature for code prompts", () => {
    expect(inferTemplateId("implement search feature")).toBe("code-feature");
    expect(inferTemplateId("add functionality")).toBe("code-feature");
  });

  it("should infer refactor for refactoring prompts", () => {
    expect(inferTemplateId("refactor the auth module")).toBe("refactor");
    expect(inferTemplateId("restructure the codebase")).toBe("refactor");
  });

  it("should infer documentation for doc prompts", () => {
    expect(inferTemplateId("write documentation")).toBe("documentation");
    expect(inferTemplateId("update the readme")).toBe("documentation");
  });

  it("should infer research for research prompts", () => {
    expect(inferTemplateId("research best practices")).toBe("research");
    expect(inferTemplateId("investigate options")).toBe("research");
  });

  it("should infer data-analysis for data prompts", () => {
    expect(inferTemplateId("analyze the sales data")).toBe("data-analysis");
    expect(inferTemplateId("create a chart")).toBe("data-analysis");
  });

  it("should infer test-generation for test prompts", () => {
    expect(inferTemplateId("write unit tests")).toBe("test-generation");
    expect(inferTemplateId("add integration tests")).toBe("test-generation");
  });

  it("should infer design for design prompts", () => {
    expect(inferTemplateId("design the UI")).toBe("design");
    expect(inferTemplateId("create a mockup")).toBe("design");
  });

  it("should infer release-checklist for release prompts", () => {
    expect(inferTemplateId("prepare release")).toBe("release-checklist");
    expect(inferTemplateId("deploy version 2")).toBe("release-checklist");
  });

  it("should infer operations for operations prompts", () => {
    expect(inferTemplateId("run ops task")).toBe("operations");
    expect(inferTemplateId("monitor infrastructure")).toBe("operations");
  });

  it("should infer translation for translation prompts", () => {
    expect(inferTemplateId("translate to French")).toBe("translation");
    expect(inferTemplateId("localize the app")).toBe("translation");
  });

  it("should infer meeting-summary for meeting prompts", () => {
    expect(inferTemplateId("summarize meeting notes")).toBe("meeting-summary");
  });

  it("should infer prompt-engineering for prompt design prompts", () => {
    expect(inferTemplateId("design a prompt")).toBe("prompt-engineering");
  });

  it("should infer business-analysis for BA prompts", () => {
    expect(inferTemplateId("perform business analysis")).toBe("business-analysis");
  });

  it("should infer product-planning for product prompts", () => {
    expect(inferTemplateId("create product roadmap")).toBe("product-planning");
  });

  it("should infer data-cleanup for data cleanup prompts", () => {
    expect(inferTemplateId("clean the data")).toBe("data-cleanup");
  });

  it("should infer report-generation for report prompts", () => {
    expect(inferTemplateId("generate a report")).toBe("report-generation");
  });

  it("should infer requirement-analysis for requirement prompts", () => {
    expect(inferTemplateId("analyze requirements")).toBe("requirement-analysis");
  });

  it("should infer qa-checklist for QA prompts", () => {
    expect(inferTemplateId("create QA checklist")).toBe("qa-checklist");
  });

  it("should infer writing for writing prompts", () => {
    expect(inferTemplateId("write a blog post")).toBe("writing");
  });

  it("should infer mixed for complex prompts", () => {
    expect(inferTemplateId("end to end implementation")).toBe("mixed");
    expect(inferTemplateId("multi step project")).toBe("mixed");
  });
});

describe("SimplePlanner template integration", () => {
  it("should create a plan from a template via SimplePlanner", async () => {
    const { SimplePlanner } = await import("../../src/planner/simple-planner.js");
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: "/test",
      prompt: "Create a login feature",
      rulesContext: "",
      template: "code-feature",
    });

    expect(result.title).toBeTruthy();
    expect(result.planMarkdown).toBeTruthy();
    expect(result.tasks.length).toBeGreaterThan(0);

    for (const task of result.tasks) {
      expect(task.id).toBeTruthy();
      expect(task.runId).toBeTruthy();
      expect(task.title).toBeTruthy();
      expect(task.status).toBe("pending");
      expect(task.acceptanceCriteria.length).toBeGreaterThan(0);
    }
  });

  it("should infer template from prompt when none specified", async () => {
    const { SimplePlanner } = await import("../../src/planner/simple-planner.js");
    const planner = new SimplePlanner();

    const result = await planner.createPlan({
      projectRoot: "/test",
      prompt: "fix the login bug",
      rulesContext: "",
    });

    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.planMarkdown).toContain("Bug Fix");
  });

  it("should use default general template for unrecognized prompts", async () => {
    const { SimplePlanner } = await import("../../src/planner/simple-planner.js");
    const planner = new SimplePlanner();

    const result = await planner.createPlan({
      projectRoot: "/test",
      prompt: "xyzzy obscure task",
      rulesContext: "",
    });

    expect(result.tasks.length).toBe(7);
    expect(result.planMarkdown).toContain("General Task");
  });

  it("should set task metadata from template", async () => {
    const { SimplePlanner } = await import("../../src/planner/simple-planner.js");
    const planner = new SimplePlanner();

    const result = await planner.createPlan({
      projectRoot: "/test",
      prompt: "Implement a search feature",
      rulesContext: "",
      template: "code-feature",
    });

    const firstTask = result.tasks[0]!;
    expect(firstTask.metadata).toBeDefined();
    expect(firstTask.metadata!["templateId"]).toBe("code-feature");
    expect(firstTask.metadata!["taskType"]).toBeTruthy();
  });
});
