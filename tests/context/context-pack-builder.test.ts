import { describe, it, expect } from "vitest";
import { ContextPackBuilder } from "../../src/context/context-pack-builder.js";
import { now } from "../../src/utils/time.js";

describe("ContextPackBuilder", () => {
  it("should build a context pack for a task", () => {
    const builder = new ContextPackBuilder();
    const prompt = "Implement login feature";
    const rulesContext = "Use TypeScript strict mode.";
    const timestamp = now();

    const pack = builder.build({
      prompt,
      rulesContext,
      run: {
        runId: "run_001",
        projectId: "test",
        title: "Implement login",
        status: "running",
        mode: "auto",
        taskCount: 3,
        completedTaskCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      task: {
        id: "task_002",
        runId: "run_001",
        title: "Create login form",
        description: "Build the login form component",
        status: "running",
        executor: "shell",
        dependsOn: ["task_001"],
        acceptanceCriteria: ["Login form exists", "Form validates input"],
        retryCount: 0,
        maxRetries: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      completedTasks: [],
      isRetry: false,
    });

    expect(pack.markdown).toContain("# FlowTask Context Pack");
    expect(pack.markdown).toContain("Implement login feature");
    expect(pack.markdown).toContain("Create login form");
    expect(pack.markdown).toContain("Use TypeScript strict mode");
    expect(pack.markdown).toContain("Login form exists");
    expect(pack.markdown).toContain("Form validates input");
  });

  it("should include retry context when retrying", () => {
    const builder = new ContextPackBuilder();
    const pack = builder.build({
      prompt: "Fix login bug",
      rulesContext: "Use strict TypeScript.",
      run: {
        runId: "run_002",
        projectId: "test",
        title: "Fix login",
        status: "running",
        mode: "auto",
        taskCount: 1,
        completedTaskCount: 0,
        createdAt: now(),
        updatedAt: now(),
      },
      task: {
        id: "task_001",
        runId: "run_002",
        title: "Fix bug",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["Bug is fixed"],
        retryCount: 1,
        maxRetries: 2,
        createdAt: now(),
        updatedAt: now(),
      },
      completedTasks: [],
      isRetry: true,
      errorLog: "TypeError: cannot read property",
    });

    expect(pack.markdown).toContain("Retry Context");
    expect(pack.markdown).toContain("TypeError: cannot read property");
  });

  it("should include completed tasks", () => {
    const builder = new ContextPackBuilder();
    const pack = builder.build({
      prompt: "Refactor module",
      rulesContext: "Keep backward compatibility",
      run: {
        runId: "run_003",
        projectId: "test",
        title: "Refactor",
        status: "running",
        mode: "auto",
        taskCount: 3,
        completedTaskCount: 1,
        createdAt: now(),
        updatedAt: now(),
      },
      task: {
        id: "task_002",
        runId: "run_003",
        title: "Second task",
        status: "running",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now(),
        updatedAt: now(),
      },
      completedTasks: [
        {
          id: "task_001",
          runId: "run_003",
          title: "First task",
          status: "done",
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now(),
          updatedAt: now(),
        },
      ],
      isRetry: false,
    });

    expect(pack.markdown).toContain("First task");
    expect(pack.markdown).toContain("Previous Completed Tasks");
  });
});
