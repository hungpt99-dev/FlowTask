import { extractJsonObject } from "../utils/json-extractor.js";
import { AiPlannerOutputSchema, type AiPlannerOutput } from "../schemas/planner.schema.js";
import { generateTaskId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import { writeTextFile, ensureDir } from "../utils/fs.js";
import path from "node:path";
import type { PlannerInput, PlannerResult } from "./planner.js";
import type { Task } from "../schemas/task.schema.js";

export interface ProcessPlannerOutputOptions {
  rawOutput: string;
  input: PlannerInput;
  runId?: string;
  validateExecutors: (data: AiPlannerOutput, availableExecutors: string[]) => void;
  resolveExecutor: (taskExecutor: string) => string;
  getAvailableExecutors: (input: PlannerInput) => string[];
}

export async function processPlannerOutput(
  options: ProcessPlannerOutputOptions,
): Promise<PlannerResult> {
  const { rawOutput, input, runId, validateExecutors, resolveExecutor, getAvailableExecutors } =
    options;

  const extraction = extractJsonObject(rawOutput);
  const parsed = JSON.parse(extraction.jsonText) as unknown;
  const schemaResult = AiPlannerOutputSchema.safeParse(parsed);

  if (!schemaResult.success) {
    const errors = schemaResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const errorText = `AI plan output validation failed: ${errors}`;

    if (runId) {
      const errorDir = path.join(input.projectRoot, ".flowtask", "runs", runId, "outputs");
      await ensureDir(errorDir);
      await writeTextFile(
        path.join(errorDir, "ai-planner-validation-error.txt"),
        `${errorText}\n\nRaw output:\n${rawOutput}\n\nExtracted JSON:\n${extraction.jsonText}`,
      );
    }

    throw new Error(errorText);
  }

  const data: AiPlannerOutput = schemaResult.data;
  validateExecutors(data, getAvailableExecutors(input));

  const runIdFinal = runId ?? `run_${Date.now()}`;
  const timestamp = now();
  const title = data.title || input.prompt.slice(0, 80).trim();

  const taskMap = new Map<string, string>();
  const tasks: Task[] = [];

  for (const aiTask of data.tasks) {
    const taskId = generateTaskId();
    taskMap.set(aiTask.title, taskId);

    const depTaskIds: string[] = (aiTask.dependsOn ?? []).map((dep) => {
      const id = taskMap.get(dep);
      if (!id) {
        throw new Error(
          `AI plan task "${aiTask.title}" depends on unknown task "${dep}". Each dependency must reference the exact "title" of a previous task in the plan.`,
        );
      }
      return id;
    });

    tasks.push({
      id: taskId,
      runId: runIdFinal,
      title: aiTask.title,
      description: aiTask.description,
      status: "pending",
      executor: resolveExecutor(aiTask.executor),
      dependsOn: depTaskIds,
      acceptanceCriteria: aiTask.acceptanceCriteria,
      validation: {
        commands: aiTask.validation?.commands ?? [],
        requiredFiles: aiTask.validation?.requiredFiles ?? [],
        requiredArtifacts: aiTask.validation?.requiredArtifacts ?? [],
        requireGitDiff: aiTask.validation?.requireGitDiff ?? false,
      },
      expectedResult: aiTask.expectedResult,
      outputPlan: aiTask.outputPlan,
      retryCount: 0,
      maxRetries: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const planMarkdown = `# Plan: ${title}\n\n## Summary\n\n${data.summary}\n\n## Tasks\n\n${tasks.map((t, i) => `${i + 1}. ${t.title}${t.dependsOn.length ? ` (depends on: ${t.dependsOn.map((d) => tasks.find((x) => x.id === d)?.title ?? d).join(", ")})` : ""}`).join("\n")}`;

  return { title, planMarkdown, tasks };
}
