import { describe, it, expect } from "vitest";
import { AiPlanOutputSchema } from "../../src/schemas/planner.schema.js";
import { PlannerRegistry } from "../../src/planner/planner-registry.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

describe("AI Planner", () => {
  it("should validate valid AI plan output", () => {
    const output = {
      title: "Implement login feature",
      summary: "Add user login with email and password",
      tasks: [
        {
          title: "Create login form",
          description: "Build the login form component",
          executor: "shell",
          acceptanceCriteria: ["Login form exists"],
        },
        {
          title: "Add validation",
          description: "Add form validation logic",
          executor: "shell",
          dependsOn: ["Create login form"],
          acceptanceCriteria: ["Validation logic exists"],
        },
      ],
    };
    const result = AiPlanOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("should reject AI plan output with missing acceptance criteria", () => {
    const output = {
      title: "Bad plan",
      summary: "This should fail",
      tasks: [
        {
          title: "Some task",
          description: "No acceptance criteria",
          executor: "shell",
          acceptanceCriteria: [],
        },
      ],
    };
    const result = AiPlanOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("should reject AI plan output with too many tasks", () => {
    const output = {
      title: "Too many tasks",
      summary: "This should fail",
      tasks: Array.from({ length: 51 }, (_, i) => ({
        title: `Task ${i}`,
        description: `Description ${i}`,
        executor: "shell",
        acceptanceCriteria: [`Criterion ${i}`],
      })),
    };
    const result = AiPlanOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("should reject invalid JSON-like output", () => {
    const result = AiPlanOutputSchema.safeParse("not even json");
    expect(result.success).toBe(false);
  });

  it("should use simple planner when no AI executor configured", () => {
    const config = {
      planner: { default: "auto", executor: "opencode", maxRetries: 1, fallbackToSimple: true },
      executors: {},
    } as unknown as FlowTaskConfig;

    const registry = new PlannerRegistry(config);
    const result = registry.getPlanner("auto");
    expect(result.mode).toBe("simple");
  });

  it("should use AI planner when executor is configured", () => {
    const config = {
      planner: { default: "auto", executor: "opencode", maxRetries: 1, fallbackToSimple: true },
      executors: {
        opencode: {
          type: "command",
          command: "opencode",
          args: ["run"],
          inputMode: "argument",
          timeoutMs: 30000,
        },
      },
    } as unknown as FlowTaskConfig;

    const registry = new PlannerRegistry(config);
    const result = registry.getPlanner("auto");
    expect(result.mode).toBe("ai");
  });
});
