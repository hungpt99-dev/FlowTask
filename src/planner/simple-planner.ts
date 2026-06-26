import { type Planner, type PlannerInput, type PlannerResult } from "./planner.js";
import { generateRunId, generateTaskId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import { type Task } from "../schemas/task.schema.js";

export class SimplePlanner implements Planner {
  async createPlan(input: PlannerInput): Promise<PlannerResult> {
    const title = input.prompt.slice(0, 80).trim();
    const runId = generateRunId(title);
    const timestamp = now();

    const tasks: Task[] = [
      {
        id: generateTaskId(),
        runId,
        title: "Read project rules",
        description: "Load and review project-level rule files.",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["Rule files are loaded and reviewed"],
        validation: { requiredArtifacts: [] },
        retryCount: 0,
        maxRetries: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: generateTaskId(),
        runId,
        title: "Understand request",
        description: "Analyze the user prompt and identify key requirements.",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["Requirements are documented"],
        validation: { requiredArtifacts: [] },
        retryCount: 0,
        maxRetries: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: generateTaskId(),
        runId,
        title: "Inspect project",
        description: "Examine project structure, existing code, and dependencies.",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["Project structure is documented"],
        validation: { requiredArtifacts: [] },
        retryCount: 0,
        maxRetries: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: generateTaskId(),
        runId,
        title: "Create implementation plan",
        description: "Design the solution approach and outline required changes.",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["Implementation plan is documented"],
        validation: { commands: [] },
        retryCount: 0,
        maxRetries: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: generateTaskId(),
        runId,
        title: "Execute implementation",
        description: "Implement the solution based on the plan.",
        status: "pending",
        executor: input.projectRoot.includes("opencode") ? "opencode" : "shell",
        dependsOn: [],
        acceptanceCriteria: ["Implementation is complete according to plan"],
        validation: { commands: [], requiredArtifacts: [] },
        retryCount: 0,
        maxRetries: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: generateTaskId(),
        runId,
        title: "Run validation",
        description: "Execute quality checks and verify the implementation.",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["All defined quality checks pass"],
        validation: { commands: [] },
        retryCount: 0,
        maxRetries: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: generateTaskId(),
        runId,
        title: "Generate final report",
        description: "Document what was done, what changed, and next steps.",
        status: "pending",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: ["Final report is generated and saved"],
        validation: { requiredArtifacts: [] },
        retryCount: 0,
        maxRetries: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];

    for (let i = 1; i < tasks.length; i++) {
      const prev = tasks[i - 1]!;
      tasks[i] = { ...tasks[i]!, dependsOn: [prev.id] };
    }

    const planMarkdown = `# Plan\n\n${title}\n\n## Tasks\n\n${tasks.map((t, i) => `${i + 1}. ${t.title}${t.dependsOn.length ? ` (depends on: ${t.dependsOn.join(", ")})` : ""}`).join("\n")}\n\n## Rules Context\n\n${input.rulesContext.slice(0, 500)}`;

    return { title, planMarkdown, tasks };
  }
}
