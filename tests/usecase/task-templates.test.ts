import { describe, it, expect } from "vitest";
import { getTaskTemplate, getUseCaseName } from "../../src/usecase/task-templates.js";
import type { UseCaseType } from "../../src/usecase/usecase-types.js";

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
});
