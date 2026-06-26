import path from "node:path";
import picocolors from "picocolors";
import { type Planner, type PlannerInput, type PlannerResult } from "./planner.js";
import {
  type AiPlannerOutput,
  AiPlannerOutputSchema,
  validateArtifactPaths,
} from "../schemas/planner.schema.js";
import { generateRunId, generateTaskId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import { type Task } from "../schemas/task.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { writeTextFile, ensureDir } from "../utils/fs.js";
import { extractJsonObject } from "../utils/json-extractor.js";
import { ProviderRegistry } from "../ai/provider-registry.js";

const VALID_EXECUTORS = new Set(["shell", "manual"]);

export class InternalAiPlanner implements Planner {
  private config: FlowTaskConfig;
  private providerRegistry: ProviderRegistry;

  constructor(config: FlowTaskConfig) {
    this.config = config;
    this.providerRegistry = new ProviderRegistry(config);
  }

  async createPlan(input: PlannerInput): Promise<PlannerResult> {
    const plannerConfig = this.config.planner!;
    const provider = this.providerRegistry.getProvider(plannerConfig.provider);
    const runId = input.runId;

    console.log(
      picocolors.cyan(
        `  Calling internal AI planner (provider: ${provider.name}, model: ${plannerConfig.model})...`,
      ),
    );

    const attempt1 = await this.executePlanner(provider.name, input, runId, 1);

    try {
      return await this.processPlannerOutput(attempt1, input, runId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.savePlannerError(input.projectRoot, runId, errorMessage, attempt1, 1);

      console.log(picocolors.yellow("\n  Internal AI planner returned non-JSON output."));
      if (runId) {
        console.log(
          picocolors.dim(
            `    Saved raw output to: .flowtask/runs/${runId}/outputs/internal-ai-planner-raw-attempt-1.txt`,
          ),
        );
      }
      console.log(picocolors.cyan("  Retrying internal AI planner with JSON repair prompt...\n"));

      const repairOutput = await this.executeRepairPlanner(
        provider.name,
        input,
        runId,
        errorMessage,
        attempt1,
      );

      try {
        return await this.processPlannerOutput(repairOutput, input, runId);
      } catch (repairErr) {
        const repairErrorMessage =
          repairErr instanceof Error ? repairErr.message : String(repairErr);

        await this.savePlannerError(input.projectRoot, runId, repairErrorMessage, repairOutput, 2);

        throw new Error(
          `Internal AI planner returned invalid JSON after repair. Last error: ${repairErrorMessage}`,
        );
      }
    }
  }

  private async executePlanner(
    providerName: string,
    input: PlannerInput,
    runId: string | undefined,
    attemptNumber: number,
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);

    const plannerConfig = this.config.planner!;
    const provider = this.providerRegistry.getProvider(plannerConfig.provider);

    const response = await provider.generate({
      systemPrompt,
      userPrompt,
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: "json_object",
    });

    const output = response.text.trim();

    await this.saveRawOutput(
      input.projectRoot,
      runId,
      output,
      `internal-ai-planner-raw-attempt-${attemptNumber}.txt`,
    );

    if (response.usage) {
      console.log(
        picocolors.dim(
          `    Tokens: ${response.usage.inputTokens ?? "?"} in / ${response.usage.outputTokens ?? "?"} out`,
        ),
      );
    }

    return output;
  }

  private async executeRepairPlanner(
    providerName: string,
    input: PlannerInput,
    runId: string | undefined,
    errorMessage: string,
    previousOutput: string,
  ): Promise<string> {
    const systemPrompt = this.buildRepairSystemPrompt(errorMessage, previousOutput);
    const userPrompt = this.buildUserPrompt(input);

    const plannerConfig = this.config.planner!;
    const provider = this.providerRegistry.getProvider(plannerConfig.provider);

    const response = await provider.generate({
      systemPrompt,
      userPrompt,
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: "json_object",
    });

    const output = response.text.trim();

    await this.saveRawOutput(
      input.projectRoot,
      runId,
      output,
      "internal-ai-planner-raw-attempt-2.txt",
    );

    return output;
  }

  private buildSystemPrompt(): string {
    const parts: string[] = [];

    parts.push("You are the FlowTask internal AI planner.");
    parts.push("");
    parts.push("Your only job is to create a JSON task plan.");
    parts.push("");
    parts.push("You are not the executor.");
    parts.push("You do not edit files.");
    parts.push("You do not write README content.");
    parts.push("You do not implement the user request.");
    parts.push("You only return a task plan that FlowTask will execute later.");
    parts.push("");
    parts.push("Return ONLY valid JSON.");
    parts.push("No markdown.");
    parts.push("No code fences.");
    parts.push("No comments.");
    parts.push("No prose before JSON.");
    parts.push("No prose after JSON.");
    parts.push("");
    parts.push("The first character must be `{`.");
    parts.push("The last character must be `}`.");
    parts.push("");
    parts.push("## JSON Schema");
    parts.push("```json");
    parts.push(
      JSON.stringify(
        {
          title: "Short run title",
          summary: "One-line summary",
          tasks: [
            {
              title: "Task title",
              description: "What to do",
              executor: "shell | opencode | claude",
              dependsOn: ["Title of previous task"],
              riskLevel: "safe | risky | dangerous | low | medium | high",
              acceptanceCriteria: ["Criterion 1"],
              commands: ["shell command (only if executor=shell)"],
              validation: {
                commands: ["pnpm test"],
                requiredFiles: ["src/file.ts"],
                requiredArtifacts: ["artifacts/task_001/report.md"],
                requireGitDiff: false,
              },
            },
          ],
        },
        null,
        2,
      ),
    );
    parts.push("```");
    parts.push("");
    parts.push("## Task Planning Rules");
    parts.push('- Use executor "shell" only when the task has shell commands.');
    parts.push(
      '- Use executor "ai" or the configured default executor for analysis, writing, editing, coding, and refactoring.',
    );
    parts.push(
      "- requiredArtifacts must be relative file paths with a file extension like .md, .json, .txt, .log.",
    );
    parts.push("- dependsOn may use previous task titles. FlowTask will normalize them.");
    parts.push("- Do not create tasks that install dependencies unless explicitly required.");
    parts.push("- Do not create unsafe commands.");
    parts.push("- Do not mark the final validation task as an AI task.");
    parts.push("");
    parts.push("## Important Role Separation");
    parts.push("- Planner creates a JSON task plan only.");
    parts.push("- Planner does not implement the user request.");
    parts.push("- Planner does not edit files.");
    parts.push("- Planner does not write README content or any other file content.");
    parts.push("- Planner does not solve the task.");
    parts.push("- Planner only returns tasks that FlowTask will execute later.");

    return parts.join("\n");
  }

  private buildRepairSystemPrompt(errorMessage: string, previousOutput: string): string {
    const parts: string[] = [];

    parts.push("You are the FlowTask internal AI planner.");
    parts.push("");
    parts.push("Your previous output was invalid.");
    parts.push("");
    parts.push("## Error");
    parts.push(errorMessage);
    parts.push("");
    parts.push("## Previous Output (truncated)");
    parts.push("```");
    parts.push(previousOutput.slice(0, 2000));
    parts.push("```");
    parts.push("");
    parts.push("## Correction Instructions");
    parts.push("Return ONLY corrected valid JSON matching the FlowTask planner schema.");
    parts.push("Do not explain.");
    parts.push("Do not use markdown.");
    parts.push("Do not wrap in ```json.");
    parts.push("Do not include any prose before or after JSON.");
    parts.push("The first character must be `{`.");
    parts.push("The last character must be `}`.");
    parts.push("");
    parts.push("## JSON Schema");
    parts.push("```json");
    parts.push(
      JSON.stringify(
        {
          title: "string",
          summary: "string",
          tasks: [
            {
              title: "string",
              description: "string",
              executor: "string",
              dependsOn: ["string"],
              riskLevel: "safe | risky | dangerous | low | medium | high",
              acceptanceCriteria: ["string"],
              commands: ["string"],
              validation: {
                commands: ["string"],
                requiredFiles: ["string"],
                requiredArtifacts: ["string"],
                requireGitDiff: true,
              },
            },
          ],
        },
        null,
        2,
      ),
    );
    parts.push("```");

    return parts.join("\n");
  }

  private buildUserPrompt(input: PlannerInput): string {
    const parts: string[] = [];

    parts.push("## Original User Prompt");
    parts.push(input.prompt);
    parts.push("");

    const availableExecutors = input.availableExecutors ?? Object.keys(this.config.executors ?? {});
    parts.push("## Available Executors");
    parts.push(availableExecutors.join(", "));
    parts.push("");
    parts.push(`## Default Executor: ${this.config.defaultExecutor}`);
    parts.push("");

    if (input.rulesContext) {
      parts.push("## Rules Context");
      parts.push(input.rulesContext.slice(0, 4000));
      parts.push("");
    }

    parts.push("## Task Planning Rules");
    parts.push("- Break the work into logical sequential tasks.");
    parts.push("- Each task must have at least one acceptance criterion.");
    parts.push("- Dependencies reference the exact `title` of previous tasks.");
    parts.push("- Maximum 15 tasks per run.");
    parts.push('- If the user asks to "update README", create a task plan for updating README.');
    parts.push("  Do NOT write the README content. Create tasks for the executor.");
    parts.push("- Choose executor based on what the task needs.");
    parts.push('  "shell" for read-only/file operations, "opencode" or other for creative work.');
    parts.push("- Set commands only when executor is shell and the command is safe.");
    parts.push("- requiredArtifacts must be relative file paths with file extensions.");

    return parts.join("\n");
  }

  private async processPlannerOutput(
    rawOutput: string,
    input: PlannerInput,
    runId: string | undefined,
  ): Promise<PlannerResult> {
    const extraction = extractJsonObject(rawOutput);

    const parsed = JSON.parse(extraction.jsonText) as unknown;
    const schemaResult = AiPlannerOutputSchema.safeParse(parsed);

    if (!schemaResult.success) {
      const errors = schemaResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      const errorText = `Internal AI plan output validation failed: ${errors}`;

      if (runId) {
        const errorDir = path.join(input.projectRoot, ".flowtask", "runs", runId, "outputs");
        await ensureDir(errorDir);
        await writeTextFile(
          path.join(errorDir, "internal-ai-planner-validation-error.txt"),
          `${errorText}\n\nRaw output:\n${rawOutput}\n\nExtracted JSON:\n${extraction.jsonText}`,
        );
      }

      throw new Error(errorText);
    }

    const data: AiPlannerOutput = schemaResult.data;

    this.validateShellTasks(data);
    this.validateArtifacts(data);
    this.validateExecutors(data);

    const runIdFinal = generateRunId(input.prompt);
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
            `Internal AI plan task "${aiTask.title}" depends on unknown task "${dep}". Each dependency must reference the exact "title" of a previous task in the plan.`,
          );
        }
        return id;
      });

      const resolvedExecutor = this.resolveExecutor(aiTask.executor);

      tasks.push({
        id: taskId,
        runId: runIdFinal,
        title: aiTask.title,
        description: aiTask.description,
        status: "pending",
        executor: resolvedExecutor,
        dependsOn: depTaskIds,
        acceptanceCriteria: aiTask.acceptanceCriteria,
        validation: {
          commands: aiTask.validation?.commands ?? [],
          requiredFiles: aiTask.validation?.requiredFiles ?? [],
          requiredArtifacts: aiTask.validation?.requiredArtifacts ?? [],
          requireGitDiff: aiTask.validation?.requireGitDiff ?? false,
        },
        retryCount: 0,
        maxRetries: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    const planMarkdown = `# Plan: ${title}\n\n## Summary\n\n${data.summary}\n\n## Tasks\n\n${tasks.map((t, i) => `${i + 1}. ${t.title}${t.dependsOn.length ? ` (depends on: ${t.dependsOn.map((d) => tasks.find((x) => x.id === d)?.title ?? d).join(", ")})` : ""}`).join("\n")}`;

    return { title, planMarkdown, tasks };
  }

  private validateShellTasks(data: AiPlannerOutput): void {
    for (const task of data.tasks) {
      if (task.executor === "shell") {
        const hasCommands =
          (task.commands && task.commands.length > 0) ||
          (task.validation?.commands && task.validation.commands.length > 0);
        if (!hasCommands) {
          throw new Error(
            `Internal AI plan task "${task.title}" uses executor "shell" but has no commands defined. Shell tasks must have non-empty commands.`,
          );
        }
      }
    }
  }

  private validateArtifacts(data: AiPlannerOutput): void {
    for (const task of data.tasks) {
      const paths = task.validation?.requiredArtifacts ?? [];
      const invalid = validateArtifactPaths(paths);
      if (invalid.length > 0) {
        const joined = invalid.map((p) => `"${p}"`).join(", ");
        throw new Error(
          `Internal AI plan task "${task.title}" has invalid requiredArtifacts: ${joined}. Artifacts must be relative file paths with file extensions (e.g., "artifacts/task_001/report.md").`,
        );
      }
    }
  }

  private validateExecutors(data: AiPlannerOutput): void {
    const configExecutors = Object.keys(this.config.executors ?? {});
    const allValid = new Set([...VALID_EXECUTORS, ...configExecutors, "ai"]);

    for (const task of data.tasks) {
      if (!allValid.has(task.executor)) {
        throw new Error(
          `Internal AI plan task "${task.title}" uses unknown executor "${task.executor}". Valid executors: ${Array.from(allValid).join(", ")}. Do not fallback to shell for unknown executors.`,
        );
      }
    }
  }

  private resolveExecutor(taskExecutor: string): string {
    if (taskExecutor === "ai") {
      return this.config.defaultExecutor;
    }
    const configExecutors = Object.keys(this.config.executors ?? {});
    if (VALID_EXECUTORS.has(taskExecutor) || configExecutors.includes(taskExecutor)) {
      return taskExecutor;
    }
    throw new Error(
      `Cannot resolve executor "${taskExecutor}". Valid executors: ${["ai", ...VALID_EXECUTORS, ...configExecutors].join(", ")}.`,
    );
  }

  private async saveRawOutput(
    projectRoot: string,
    runId: string | undefined,
    output: string,
    filename: string,
  ): Promise<string | undefined> {
    if (!runId) return undefined;
    const outputsDir = path.join(projectRoot, ".flowtask", "runs", runId, "outputs");
    await ensureDir(outputsDir);
    const filePath = path.join(outputsDir, filename);
    await writeTextFile(filePath, output);
    return filePath;
  }

  private async savePlannerError(
    projectRoot: string,
    runId: string | undefined,
    errorMessage: string,
    rawOutput: string,
    attemptNumber: number,
  ): Promise<string | undefined> {
    if (!runId) return undefined;
    const outputsDir = path.join(projectRoot, ".flowtask", "runs", runId, "outputs");
    await ensureDir(outputsDir);
    const filePath = path.join(
      outputsDir,
      `internal-ai-planner-error-attempt-${attemptNumber}.txt`,
    );
    const content = `Error: ${errorMessage}\n\nRaw output:\n${rawOutput}\n`;
    await writeTextFile(filePath, content);
    return filePath;
  }
}
