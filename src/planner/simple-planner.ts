import { type Planner, type PlannerInput, type PlannerResult } from "./planner.js";
import { generateRunId, generateTaskId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import { type Task } from "../schemas/task.schema.js";
import { UseCaseDetector } from "../usecase/usecase-detector.js";
import { getTaskTemplate, getUseCaseName } from "../usecase/task-templates.js";

export class SimplePlanner implements Planner {
  private detector: UseCaseDetector;

  constructor() {
    this.detector = new UseCaseDetector();
  }

  async createPlan(input: PlannerInput): Promise<PlannerResult> {
    const title = input.prompt.slice(0, 80).trim();
    const runId = generateRunId(title);
    const timestamp = now();

    const useCase = input.useCase ?? this.detector.detect(input.prompt);
    const template = getTaskTemplate(useCase.type);

    const tasks: Task[] = template.tasks.map((t) => ({
      id: generateTaskId(),
      runId,
      title: t.title,
      description: t.description,
      status: "pending" as const,
      executor: t.executor,
      dependsOn: [],
      acceptanceCriteria: t.acceptanceCriteria,
      validation: { commands: [], requiredArtifacts: [] },
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

    for (let i = 1; i < tasks.length; i++) {
      const prev = tasks[i - 1]!;
      tasks[i] = { ...tasks[i]!, dependsOn: [prev.id] };
    }

    const useCaseName = getUseCaseName(useCase.type);
    const planMarkdown = [
      `# Plan: ${title}`,
      "",
      `**Use Case:** ${useCaseName} (confidence: ${Math.round(useCase.confidence * 100)}%)`,
      "",
      "## Tasks",
      "",
      ...tasks.map(
        (t, i) =>
          `${i + 1}. ${t.title}${t.dependsOn.length ? ` (depends on: ${t.dependsOn.join(", ")})` : ""}`,
      ),
      "",
      "## Rules Context",
      "",
      input.rulesContext.slice(0, 500),
    ].join("\n");

    return { title, planMarkdown, tasks };
  }
}
