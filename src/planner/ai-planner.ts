import { type Planner, type PlannerInput, type PlannerResult } from "./planner.js";
import { type AiPlanOutput, AiPlanOutputSchema } from "../schemas/planner.schema.js";
import { generateRunId, generateTaskId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import { type Task } from "../schemas/task.schema.js";
import { spawnWithPromise } from "../utils/process.js";
import { getShell, getShellCommandFlag } from "../utils/shell.js";
import { PlannerContextBuilder } from "../context/planner-context-builder.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";

export class AiPlanner implements Planner {
  private config: FlowTaskConfig;

  constructor(config: FlowTaskConfig) {
    this.config = config;
  }

  async createPlan(input: PlannerInput): Promise<PlannerResult> {
    const executorName = this.config.planner?.executor ?? this.config.defaultExecutor;
    const executorConfig = this.config.executors?.[executorName];

    if (!executorConfig) {
      throw new Error(`AI planner executor "${executorName}" not configured in executors`);
    }

    const command = executorConfig.command;
    if (!command) {
      throw new Error(`AI planner executor "${executorName}" has no command configured`);
    }

    const contextBuilder = new PlannerContextBuilder();
    const context = contextBuilder.build({
      prompt: input.prompt,
      rulesContext: input.rulesContext,
      projectRoot: input.projectRoot,
      config: this.config,
      availableExecutors: Object.keys(this.config.executors ?? {}),
    });

    const aiArgs = executorConfig.args ?? [];
    let finalCommand: string;
    const inputMode = executorConfig.inputMode ?? "argument";

    if (inputMode === "stdin") {
      finalCommand = `${command} ${aiArgs.join(" ")}`;
    } else {
      const escapedContext = context.replace(/"/g, '\\"');
      finalCommand = `${command} ${aiArgs.join(" ")} "${escapedContext}"`;
    }

    const result = await spawnWithPromise(getShell(), [getShellCommandFlag(), finalCommand], {
      timeout: 120000,
    });

    if (result.exitCode !== 0) {
      throw new Error(`AI planner executor exited with code ${result.exitCode}: ${result.stderr}`);
    }

    const output = result.stdout.trim();
    if (!output) {
      throw new Error("AI planner produced empty output");
    }

    const parsed = this.parseAndValidateOutput(output);

    const runId = generateRunId(input.prompt);
    const timestamp = now();

    const taskMap = new Map<string, string>();
    const tasks: Task[] = [];

    for (const aiTask of parsed.tasks) {
      const taskId = generateTaskId();
      taskMap.set(aiTask.title, taskId);

      const depTaskIds: string[] = (aiTask.dependsOn ?? []).map((title) => {
        const id = taskMap.get(title);
        if (!id) {
          throw new Error(`AI plan task "${aiTask.title}" depends on unknown task "${title}"`);
        }
        return id;
      });

      tasks.push({
        id: taskId,
        runId,
        title: aiTask.title,
        description: aiTask.description,
        status: "pending",
        executor: executorConfig.type === "command" ? executorName : "shell",
        dependsOn: depTaskIds,
        acceptanceCriteria: aiTask.acceptanceCriteria,
        validation: aiTask.validation,
        retryCount: 0,
        maxRetries: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    const title = parsed.title || input.prompt.slice(0, 80).trim();
    const planMarkdown = `# Plan: ${title}\n\n## Summary\n\n${parsed.summary}\n\n## Tasks\n\n${tasks.map((t, i) => `${i + 1}. ${t.title}${t.dependsOn.length ? ` (depends on: ${t.dependsOn.map((d) => tasks.find((x) => x.id === d)?.title ?? d).join(", ")})` : ""}`).join("\n")}`;

    return { title, planMarkdown, tasks };
  }

  private parseAndValidateOutput(output: string): AiPlanOutput {
    let json = output;

    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      json = fenceMatch[1]!.trim();
    }

    const parsed = JSON.parse(json) as unknown;
    const result = AiPlanOutputSchema.safeParse(parsed);

    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`AI plan output validation failed: ${errors}`);
    }

    return result.data;
  }
}
