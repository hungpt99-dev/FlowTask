import { describe, it, expect } from "vitest";
import { ReportGenerator } from "../../src/core/report-generator.js";
import type { Run } from "../../src/schemas/run.schema.js";
import type { Task } from "../../src/schemas/task.schema.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    runId: "run-1",
    projectId: "proj-1",
    title: "Test run",
    status: "completed",
    mode: "auto",
    taskCount: 3,
    completedTaskCount: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T01:00:00.000Z",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "task-1",
    runId: "run-1",
    title: "Some task",
    description: "A description",
    status: "done",
    executor: "shell",
    dependsOn: [],
    acceptanceCriteria: [],
    retryCount: 0,
    maxRetries: 2,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:30:00.000Z",
    ...overrides,
  };
}

describe("ReportGenerator", () => {
  const gen = new ReportGenerator();

  it("generates a report with completed/failed/skipped breakdown", async () => {
    const tasks: Task[] = [
      makeTask({ id: "t1", title: "Task A", status: "done" }),
      makeTask({ id: "t2", title: "Task B", status: "failed" }),
      makeTask({ id: "t3", title: "Task C", status: "skipped" }),
    ];
    const report = await gen.generate(makeRun(), tasks);

    expect(report.prompt).toBe("Test run");
    expect(report.summary).toContain("1/3 tasks done");
    expect(report.completedTasks).toHaveLength(1);
    expect(report.completedTasks[0]!.title).toBe("Task A");
    expect(report.failedTasks).toHaveLength(1);
    expect(report.failedTasks[0]!.title).toBe("Task B");
    expect(report.skippedTasks).toHaveLength(1);
    expect(report.skippedTasks[0]!.title).toBe("Task C");
    expect(report.errors).toContain("Task failed: Task B");
  });

  it("handles empty task list", async () => {
    const report = await gen.generate(makeRun(), []);
    expect(report.completedTasks).toHaveLength(0);
    expect(report.failedTasks).toHaveLength(0);
    expect(report.skippedTasks).toHaveLength(0);
    expect(report.errors).toHaveLength(0);
    expect(report.summary).toContain("0/0 tasks done");
  });

  it("handles cancelled tasks as skipped", async () => {
    const tasks: Task[] = [makeTask({ id: "t1", title: "Cancelled", status: "cancelled" })];
    const report = await gen.generate(makeRun(), tasks);
    expect(report.skippedTasks).toHaveLength(1);
    expect(report.skippedTasks[0]!.title).toBe("Cancelled");
  });

  it("generates markdown with sections for non-empty data", async () => {
    const report = await gen.generate(makeRun({ title: "My prompt" }), [
      makeTask({ id: "t1", title: "Done task", status: "done" }),
      makeTask({ id: "t2", title: "Failed task", status: "failed" }),
    ]);
    report.changedFiles = ["src/index.ts"];
    report.manualNextSteps = ["Review the output"];

    const md = gen.generateMarkdown(report);

    expect(md).toContain("# Final Report");
    expect(md).toContain("My prompt");
    expect(md).toContain("## Completed Tasks");
    expect(md).toContain("Done task");
    expect(md).toContain("## Failed Tasks");
    expect(md).toContain("Failed task");
    expect(md).toContain("## Changed Files");
    expect(md).toContain("src/index.ts");
    expect(md).toContain("## Errors");
    expect(md).toContain("Task failed: Failed task");
    expect(md).toContain("## Manual Next Steps");
    expect(md).toContain("Review the output");
  });

  it("generates markdown without sections for empty data", async () => {
    const report = await gen.generate(makeRun(), [
      makeTask({ id: "t1", title: "Done", status: "done" }),
    ]);
    const md = gen.generateMarkdown(report);
    expect(md).toContain("# Final Report");
    expect(md).toContain("## Summary");
    expect(md).toContain("## Completed Tasks");
    expect(md).not.toContain("## Failed Tasks");
    expect(md).not.toContain("## Changed Files");
    expect(md).not.toContain("## Errors");
    expect(md).not.toContain("## Manual Next Steps");
  });
});
