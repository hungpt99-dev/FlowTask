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

  it("should generate exactly 7 default tasks", async () => {
    const planner = new SimplePlanner();
    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt: "Fix login bug",
      rulesContext: "",
    });

    expect(result.tasks).toHaveLength(7);
    expect(result.tasks[0]!.title).toContain("Read project rules");
    expect(result.tasks[6]!.title).toContain("Generate final report");
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
});
