import { type Planner, type PlannerInput, type PlannerResult } from "./planner.js";
import { generateRunId, generateTaskId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import { type Task } from "../schemas/task.schema.js";
import { UseCaseDetector } from "../usecase/usecase-detector.js";
import { getUseCaseName } from "../usecase/task-templates.js";
import { TemplateRegistry, inferTemplateId } from "../templates/template-registry.js";

export class SimplePlanner implements Planner {
  private detector: UseCaseDetector;
  private templateRegistry: TemplateRegistry;

  constructor() {
    this.detector = new UseCaseDetector();
    this.templateRegistry = new TemplateRegistry();
  }

  async createPlan(input: PlannerInput): Promise<PlannerResult> {
    const title = input.prompt.slice(0, 80).trim();
    const runId = generateRunId(title);
    const timestamp = now();

    const useCase = input.useCase ?? this.detector.detect(input.prompt);
    const templateId = input.template ?? inferTemplateId(input.prompt);
    const templates = await this.templateRegistry.loadAll();

    let template = templates.find((t) => t.id === templateId);
    if (!template) {
      template = templates.find((t) => t.workflowType === "general-task");
    }

    if (!template) {
      throw new Error(`No template found for "${templateId}" and no fallback template available`);
    }

    const tasks: Task[] = [];

    for (const step of template.steps) {
      if (!step.acceptanceCriteria || step.acceptanceCriteria.length === 0) {
        throw new Error(
          `Step "${step.title}" in template "${template.name}" has no acceptance criteria defined. Each step must have at least one acceptance criterion.`,
        );
      }

      const task: Task = {
        id: generateTaskId(),
        runId,
        title: step.title,
        description: step.description,
        status: "pending" as const,
        executor: step.executor,
        dependsOn: [],
        acceptanceCriteria: step.acceptanceCriteria,
        validation: {
          commands: step.verificationCommand ? [step.verificationCommand] : [],
          requiredArtifacts: step.targetArtifacts,
        },
        expectedResult: step.expectedResult,
        outputPlan: step.outputPlan,
        retryCount: 0,
        maxRetries: step.retryPolicy?.maxRetries ?? 2,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: {
          taskType: step.taskType,
          actionType: step.actionType,
          inputContext: step.inputContext,
          targetFiles: step.targetFiles,
          targetArtifacts: step.targetArtifacts,
          evidence: step.evidence,
          verificationCommand: step.verificationCommand,
          approvalRequired: step.approvalRequired,
          riskLevel: step.riskLevel,
          timeout: step.timeout,
          finalOutputContribution: step.finalOutputContribution,
          templateId: template.id,
          templateVersion: template.version,
        },
      };

      tasks.push(task);
    }

    for (let i = 0; i < tasks.length; i++) {
      const step = template.steps[i];
      if (step && step.dependsOn && step.dependsOn.length > 0) {
        const depIds: string[] = [];
        for (const depTitle of step.dependsOn) {
          const depIndex = template.steps.findIndex((s) => s.id === depTitle);
          if (depIndex >= 0 && depIndex < i) {
            depIds.push(tasks[depIndex]!.id);
          }
        }
        if (depIds.length > 0) {
          tasks[i] = { ...tasks[i]!, dependsOn: depIds };
        }
      }
    }

    for (let i = 1; i < tasks.length; i++) {
      if (tasks[i]!.dependsOn.length === 0) {
        const prev = tasks[i - 1]!;
        tasks[i] = { ...tasks[i]!, dependsOn: [prev.id] };
      }
    }

    const useCaseName = getUseCaseName(useCase.type);
    const planMarkdown = [
      `# Plan: ${title}`,
      "",
      `**Template:** ${template.name} (v${template.version})`,
      `**Use Case:** ${useCaseName} (confidence: ${Math.round(useCase.confidence * 100)}%)`,
      `**Workflow Type:** ${template.workflowType}`,
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
