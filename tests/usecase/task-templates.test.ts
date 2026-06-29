import { describe, it, expect } from "vitest";
import { getTaskTemplate, getUseCaseName } from "../../src/usecase/task-templates.js";
import type { UseCaseType } from "../../src/usecase/usecase-types.js";
import {
  OutputActionTypeSchema,
  OutputValidationMethodSchema,
} from "../../src/schemas/output-plan.schema.js";

describe("TaskTemplates", () => {
  it("should return a template for each use case type", () => {
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
      const template = getTaskTemplate(type);
      expect(template.useCase).toBe(type);
      expect(template.tasks.length).toBeGreaterThan(0);
    }
  });

  it("should return general template for unknown types", () => {
    const template = getTaskTemplate("general" as UseCaseType);
    expect(template.useCase).toBe("general");
  });

  it("should generate templates with proper task structure", () => {
    const template = getTaskTemplate("coding");
    for (const task of template.tasks) {
      expect(task.title.length).toBeGreaterThan(0);
      expect(task.description.length).toBeGreaterThan(0);
      expect(task.executor.length).toBeGreaterThan(0);
      expect(task.acceptanceCriteria.length).toBeGreaterThan(0);
    }
  });

  it("should provide unique names for each use case", () => {
    const names = new Set<string>();
    const types: UseCaseType[] = ["coding", "documentation", "debugging", "general"];
    for (const type of types) {
      const name = getUseCaseName(type);
      expect(name.length).toBeGreaterThan(0);
      names.add(name);
    }
    expect(names.size).toBe(types.length);
  });

  it("should include outputPlan in every task for the coding template", () => {
    const template = getTaskTemplate("coding");
    for (const task of template.tasks) {
      expect(task.outputPlan).toBeDefined();
    }
  });

  it("should include outputPlan in every task for the writing template", () => {
    const template = getTaskTemplate("writing");
    for (const task of template.tasks) {
      expect(task.outputPlan).toBeDefined();
    }
  });

  it("should include outputPlan in every task for the research template", () => {
    const template = getTaskTemplate("research");
    for (const task of template.tasks) {
      expect(task.outputPlan).toBeDefined();
    }
  });

  it("should include outputPlan in every task for the documentation template", () => {
    const template = getTaskTemplate("documentation");
    for (const task of template.tasks) {
      expect(task.outputPlan).toBeDefined();
    }
  });

  it("should include outputPlan in every task for all templates", () => {
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
      const template = getTaskTemplate(type);
      for (const task of template.tasks) {
        expect(task.outputPlan).toBeDefined();
      }
    }
  });

  it("should have valid outputPlan entries with correct action types and validation methods", () => {
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
      const template = getTaskTemplate(type);
      for (const task of template.tasks) {
        if (task.outputPlan && task.outputPlan.length > 0) {
          for (const item of task.outputPlan) {
            expect(OutputActionTypeSchema.safeParse(item.action).success).toBe(true);
            expect(item.target.length).toBeGreaterThan(0);
            expect(OutputValidationMethodSchema.safeParse(item.validationMethod).success).toBe(
              true,
            );
          }
        }
      }
    }
  });

  it("should specify expected files and artifacts in outputPlan for each template", () => {
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
      const template = getTaskTemplate(type);
      let hasOutputPlanEntries = false;
      for (const task of template.tasks) {
        if (task.outputPlan && task.outputPlan.length > 0) {
          hasOutputPlanEntries = true;
          for (const item of task.outputPlan) {
            expect(item.target).toBeTruthy();
            expect(item.description).toBeTruthy();
          }
        }
      }
      expect(hasOutputPlanEntries).toBe(true);
    }
  });
});
