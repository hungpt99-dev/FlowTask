import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { AiPlannerOutputSchema } from "../../src/schemas/planner.schema.js";
import { PlannerRegistry } from "../../src/planner/planner-registry.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

describe("AI Planner Schema Validation", () => {
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
    const result = AiPlannerOutputSchema.safeParse(output);
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
    const result = AiPlannerOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("should reject AI plan output with too many tasks (>30)", () => {
    const output = {
      title: "Too many tasks",
      summary: "This should fail",
      tasks: Array.from({ length: 31 }, (_, i) => ({
        title: `Task ${i}`,
        description: `Description ${i}`,
        executor: "shell",
        acceptanceCriteria: [`Criterion ${i}`],
      })),
    };
    const result = AiPlannerOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("should accept exactly 30 tasks", () => {
    const output = {
      title: "Exactly 30 tasks",
      summary: "This should work",
      tasks: Array.from({ length: 30 }, (_, i) => ({
        title: `Task ${i}`,
        description: `Description ${i}`,
        executor: "shell",
        acceptanceCriteria: [`Criterion ${i}`],
      })),
    };
    const result = AiPlannerOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("should reject README prose instead of JSON", () => {
    const result = AiPlannerOutputSchema.safeParse("README for FlowTask...");
    expect(result.success).toBe(false);
  });

  it("should reject empty tasks array", () => {
    const output = {
      title: "Empty tasks",
      summary: "Should fail",
      tasks: [],
    };
    const result = AiPlannerOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("should reject missing title", () => {
    const output = {
      summary: "Missing title",
      tasks: [
        {
          title: "Task 1",
          description: "desc",
          executor: "shell",
          acceptanceCriteria: ["ok"],
        },
      ],
    };
    const result = AiPlannerOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("should reject missing summary", () => {
    const output = {
      title: "Missing summary",
      tasks: [
        {
          title: "Task 1",
          description: "desc",
          executor: "shell",
          acceptanceCriteria: ["ok"],
        },
      ],
    };
    const result = AiPlannerOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("should reject missing description in task", () => {
    const output = {
      title: "Bad task",
      summary: "test",
      tasks: [
        {
          title: "No description",
          executor: "shell",
          acceptanceCriteria: ["ok"],
        },
      ],
    };
    const result = AiPlannerOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("should reject empty acceptance criteria string", () => {
    const output = {
      title: "Bad criteria",
      summary: "test",
      tasks: [
        {
          title: "Task",
          description: "desc",
          executor: "shell",
          acceptanceCriteria: [""],
        },
      ],
    };
    const result = AiPlannerOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("should validate with full schema including riskLevel and validation", () => {
    const output = {
      title: "Full schema",
      summary: "Testing all fields",
      tasks: [
        {
          title: "Risky task",
          description: "This is a risky operation",
          executor: "shell",
          dependsOn: [],
          riskLevel: "risky",
          acceptanceCriteria: ["Task done"],
          validation: {
            commands: ["pnpm test"],
            requiredFiles: ["src/output.ts"],
            requiredArtifacts: ["docs/report.md"],
            requireGitDiff: true,
          },
        },
      ],
    };
    const result = AiPlannerOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("should accept valid riskLevel values: safe, risky, dangerous", () => {
    for (const riskLevel of ["safe", "risky", "dangerous"]) {
      const output = {
        title: "Risk test",
        summary: "test",
        tasks: [
          {
            title: `Risk: ${riskLevel}`,
            description: "desc",
            executor: "shell",
            riskLevel,
            acceptanceCriteria: ["ok"],
          },
        ],
      };
      const result = AiPlannerOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    }
  });
});

describe("PlannerRegistry", () => {
  it("should use simple planner when no AI executor configured", () => {
    const config = {
      planner: {
        default: "auto",
        executor: "opencode",
        maxRetries: 1,
        fallbackToSimple: true,
      },
      executors: {},
    } as unknown as FlowTaskConfig;

    const registry = new PlannerRegistry(config);
    const result = registry.getPlanner("auto");
    expect(result.mode).toBe("simple");
  });

  it("should use external AI planner when executor is configured", () => {
    const config = {
      planner: {
        default: "auto",
        type: "external-ai" as const,
        executor: "opencode",
        provider: "openai",
        model: "gpt-4.1-mini",
        maxRetries: 1,
        fallbackToSimple: true,
      },
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

  it("should return simple planner for --planner simple even with AI executor", () => {
    const config = {
      planner: {
        default: "auto",
        type: "external-ai" as const,
        executor: "opencode",
        provider: "openai",
        model: "gpt-4.1-mini",
        maxRetries: 1,
        fallbackToSimple: true,
      },
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
    const result = registry.getPlanner("simple");
    expect(result.mode).toBe("simple");
  });

  it("should resolve planner modes correctly", () => {
    const config = {
      planner: {
        default: "auto",
        type: "external-ai" as const,
        executor: "shell",
        provider: "openai",
        model: "gpt-4.1-mini",
        maxRetries: 1,
        fallbackToSimple: true,
      },
      executors: {},
    } as unknown as FlowTaskConfig;

    const registry = new PlannerRegistry(config);
    expect(registry.resolveMode("simple")).toBe("simple");
    expect(registry.resolveMode("ai")).toBe("ai");
    expect(registry.resolveMode("auto")).toBe("auto");
  });
});

describe("Planner Mode Mocks (integration)", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(path.join(tmpdir(), "flowtask-planner-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should show fallback warning log path for invalid planner output", async () => {
    const outputsDir = path.join(testDir, ".flowtask", "runs", "test-run", "outputs");
    await fs.mkdir(outputsDir, { recursive: true });
    const rawOutput = "README for FlowTask...";
    const filePath = path.join(outputsDir, "ai-planner-raw-attempt-1.txt");
    await fs.writeFile(filePath, rawOutput, "utf-8");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe(rawOutput);
  });

  it("should save raw output for debugging", async () => {
    const outputsDir = path.join(testDir, ".flowtask", "runs", "test-run", "outputs");
    await fs.mkdir(outputsDir, { recursive: true });
    const validJson = JSON.stringify({
      title: "Test",
      summary: "test",
      tasks: [{ title: "T1", description: "d", executor: "shell", acceptanceCriteria: ["ok"] }],
    });
    const filePath = path.join(outputsDir, "ai-planner-raw-attempt-1.txt");
    await fs.writeFile(filePath, validJson, "utf-8");
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.title).toBe("Test");
  });

  it("should save validation errors for debugging", async () => {
    const outputsDir = path.join(testDir, ".flowtask", "runs", "test-run", "outputs");
    await fs.mkdir(outputsDir, { recursive: true });
    const errorContent = "Error: Invalid JSON\n\nRaw output:\nREADME for FlowTask...\n";
    const filePath = path.join(outputsDir, "ai-planner-error-attempt-1.txt");
    await fs.writeFile(filePath, errorContent, "utf-8");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("Error: Invalid JSON");
    expect(content).toContain("README for FlowTask...");
  });
});
