import { spawn } from "node:child_process";
import path from "node:path";
import picocolors from "picocolors";
import { type Planner, type PlannerInput, type PlannerResult } from "./planner.js";
import { type AiPlannerOutput, AiPlannerOutputSchema } from "../schemas/planner.schema.js";
import { generateRunId, generateTaskId } from "../utils/ids.js";
import { now } from "../utils/time.js";
import { type Task } from "../schemas/task.schema.js";
import { PlannerContextBuilder } from "../context/planner-context-builder.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { buildCommandArgs } from "../executor/build-command-args.js";
import { writeTextFile, ensureDir } from "../utils/fs.js";
import { extractJsonObject } from "../utils/json-extractor.js";
import { UseCaseDetector } from "../usecase/usecase-detector.js";
import type { UseCaseDetection } from "../usecase/usecase-types.js";
import { getUseCaseName } from "../usecase/task-templates.js";

const VALID_EXECUTORS = new Set(["shell", "manual"]);

export class AiPlanner implements Planner {
  private config: FlowTaskConfig;
  private useCaseDetector: UseCaseDetector;

  constructor(config: FlowTaskConfig) {
    this.config = config;
    this.useCaseDetector = new UseCaseDetector(config.useCase);
  }

  async createPlan(input: PlannerInput): Promise<PlannerResult> {
    const executorName = this.config.planner?.executor ?? this.config.defaultExecutor;
    const executorConfig = this.config.executors?.[executorName];

    if (!executorConfig) {
      throw new Error(
        `AI planner executor "${executorName}" not configured in executors. Run "flowtask doctor" to check executor availability.`,
      );
    }

    const command = executorConfig.command;
    if (!command) {
      throw new Error(`AI planner executor "${executorName}" has no command configured`);
    }

    const prompt = input.prompt;
    const rulesContext = input.rulesContext;
    const availableExecutors = input.availableExecutors ?? Object.keys(this.config.executors ?? {});
    const runId = input.runId;

    const attempt1 = await this.executePlanner(
      executorName,
      executorConfig,
      command,
      input,
      prompt,
      rulesContext,
      availableExecutors,
      runId,
      1,
    );

    try {
      return await this.processPlannerOutput(attempt1, input, runId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      const errorFilePath = await this.savePlannerError(
        input.projectRoot,
        runId,
        errorMessage,
        attempt1.rawOutput,
        1,
      );

      if (errorFilePath) {
        console.log(picocolors.dim(`    Saved error details to: .flowtask/runs/${runId}/outputs/`));
      }

      const repairOutput = await this.executeRepairPlanner(
        executorName,
        executorConfig,
        command,
        input,
        prompt,
        rulesContext,
        availableExecutors,
        runId,
        errorMessage,
        attempt1.rawOutput,
      );

      try {
        return await this.processPlannerOutput(repairOutput, input, runId);
      } catch (repairErr) {
        const repairErrorMessage =
          repairErr instanceof Error ? repairErr.message : String(repairErr);

        await this.savePlannerError(
          input.projectRoot,
          runId,
          repairErrorMessage,
          repairOutput.rawOutput,
          2,
        );

        throw new Error(
          `AI planner returned invalid JSON after repair attempt. Last error: ${repairErrorMessage}`,
        );
      }
    }
  }

  private async executePlanner(
    executorName: string,
    executorConfig: { args?: string[]; inputMode?: string; timeoutMs?: number; fileArg?: string },
    command: string,
    input: PlannerInput,
    prompt: string,
    rulesContext: string,
    availableExecutors: string[],
    runId: string | undefined,
    attemptNumber: number,
  ): Promise<{ rawOutput: string; stdout: string }> {
    const contextBuilder = new PlannerContextBuilder(this.config);
    const context = contextBuilder.build({
      prompt,
      rulesContext,
      projectRoot: input.projectRoot,
      config: this.config,
      availableExecutors,
    });

    const inputMode = (executorConfig.inputMode as "stdin" | "argument" | "file") ?? "stdin";
    const args = executorConfig.args ?? [];
    const timeoutMs = executorConfig.timeoutMs ?? 1800000;

    const contextDir = path.join(input.projectRoot, ".flowtask", "planner-context");
    await ensureDir(contextDir);
    const contextPackPath = path.join(contextDir, `planner-context.${Date.now()}.md`);
    await writeTextFile(contextPackPath, context);

    const { args: finalArgs, stdin } = buildCommandArgs({
      args,
      inputMode,
      contextPackContent: context,
      contextPackPath,
      fileArg: executorConfig.fileArg,
    });

    console.log(picocolors.cyan(`    Calling AI planner (attempt ${attemptNumber})...`));

    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];

    try {
      const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(command, finalArgs, {
            cwd: input.projectRoot,
            env: { ...process.env, FLOWTASK_CONTEXT_PACK: context },
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
            timeout: timeoutMs,
          });

          if (stdin !== undefined) {
            child.stdin?.write(stdin);
            child.stdin?.end();
          } else {
            child.stdin?.end();
          }

          child.stdout?.on("data", (data: Buffer) => {
            const text = data.toString();
            process.stdout.write(text);
            stdoutBuffer.push(text);
          });

          child.stderr?.on("data", (data: Buffer) => {
            const text = data.toString();
            process.stderr.write(text);
            stderrBuffer.push(text);
          });

          child.on("close", (exitCode) => {
            resolve({
              exitCode,
              stdout: stdoutBuffer.join(""),
              stderr: stderrBuffer.join(""),
            });
          });

          child.on("error", (err) => {
            reject(err);
          });
        },
      );

      if (result.exitCode !== 0) {
        throw new Error(
          `AI planner executor "${executorName}" exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim().slice(0, 200)}`,
        );
      }

      const output = result.stdout.trim();
      if (!output) {
        throw new Error("AI planner produced empty output");
      }

      await this.saveRawOutput(
        input.projectRoot,
        runId,
        output,
        `ai-planner-raw-attempt-${attemptNumber}.txt`,
      );

      return { rawOutput: output, stdout: result.stdout };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`AI planner execution failed: ${message}`);
    }
  }

  private async executeRepairPlanner(
    executorName: string,
    executorConfig: { args?: string[]; inputMode?: string; timeoutMs?: number; fileArg?: string },
    command: string,
    input: PlannerInput,
    prompt: string,
    rulesContext: string,
    availableExecutors: string[],
    runId: string | undefined,
    errorMessage: string,
    previousOutput: string,
  ): Promise<{ rawOutput: string; stdout: string }> {
    console.log(picocolors.yellow("\n  AI planner returned non-JSON output."));
    if (runId) {
      console.log(
        picocolors.dim(
          `    Saved raw output to: .flowtask/runs/${runId}/outputs/ai-planner-raw-attempt-1.txt`,
        ),
      );
    }
    console.log(picocolors.cyan("  Retrying AI planner with JSON repair prompt...\n"));

    const useCase = input.useCase ?? this.useCaseDetector.detect(prompt);

    const repairContext = this.buildRepairContext(
      prompt,
      rulesContext,
      input.projectRoot,
      availableExecutors,
      errorMessage,
      previousOutput,
      useCase,
    );

    const inputMode = (executorConfig.inputMode as "stdin" | "argument" | "file") ?? "stdin";
    const args = executorConfig.args ?? [];
    const timeoutMs = executorConfig.timeoutMs ?? 1800000;

    const contextDir = path.join(input.projectRoot, ".flowtask", "planner-context");
    await ensureDir(contextDir);
    const contextPackPath = path.join(contextDir, `planner-context-repair.${Date.now()}.md`);
    await writeTextFile(contextPackPath, repairContext);

    const { args: finalArgs, stdin } = buildCommandArgs({
      args,
      inputMode,
      contextPackContent: repairContext,
      contextPackPath,
      fileArg: executorConfig.fileArg,
    });

    const stdoutBuffer: string[] = [];
    const stderrBuffer: string[] = [];

    try {
      const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(command, finalArgs, {
            cwd: input.projectRoot,
            env: { ...process.env, FLOWTASK_CONTEXT_PACK: repairContext },
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
            timeout: timeoutMs,
          });

          if (stdin !== undefined) {
            child.stdin?.write(stdin);
            child.stdin?.end();
          } else {
            child.stdin?.end();
          }

          child.stdout?.on("data", (data: Buffer) => {
            const text = data.toString();
            process.stdout.write(text);
            stdoutBuffer.push(text);
          });

          child.stderr?.on("data", (data: Buffer) => {
            const text = data.toString();
            process.stderr.write(text);
            stderrBuffer.push(text);
          });

          child.on("close", (exitCode) => {
            resolve({
              exitCode,
              stdout: stdoutBuffer.join(""),
              stderr: stderrBuffer.join(""),
            });
          });

          child.on("error", (err) => {
            reject(err);
          });
        },
      );

      if (result.exitCode !== 0) {
        throw new Error(
          `AI planner repair exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim().slice(0, 200)}`,
        );
      }

      const output = result.stdout.trim();
      if (!output) {
        throw new Error("AI planner repair produced empty output");
      }

      await this.saveRawOutput(input.projectRoot, runId, output, "ai-planner-raw-attempt-2.txt");

      return { rawOutput: output, stdout: result.stdout };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`AI planner repair failed: ${message}`);
    }
  }

  private buildRepairContext(
    prompt: string,
    rulesContext: string,
    projectRoot: string,
    availableExecutors: string[],
    errorMessage: string,
    previousOutput: string,
    useCase?: UseCaseDetection,
  ): string {
    const parts: string[] = [];

    parts.push("# FlowTask Planner Repair Context\n\n");
    parts.push("Your previous output was invalid.\n\n");
    parts.push("## Error\n");
    parts.push(`${errorMessage}\n\n`);
    parts.push("## Previous Output\n");
    parts.push("```\n");
    parts.push(previousOutput.slice(0, 2000));
    parts.push("\n```\n\n");
    parts.push("## Correction Instructions\n");
    parts.push("Return ONLY corrected valid JSON matching the FlowTask planner schema.\n");
    parts.push("Do not explain.\n");
    parts.push("Do not use markdown.\n");
    parts.push("Do not wrap in ```json.\n");
    parts.push("Do not wrap in ```.\n");
    parts.push("Do not include any prose before or after JSON.\n");
    parts.push("The first character must be `{`.\n");
    parts.push("The last character must be `}`.\n\n");
    parts.push("## Original Prompt\n");
    parts.push(`${prompt}\n\n`);

    if (useCase && useCase.type !== "general") {
      const useCaseName = getUseCaseName(useCase.type);
      parts.push("## Detected Use Case\n");
      parts.push(`${useCaseName} (confidence: ${Math.round(useCase.confidence * 100)}%)\n`);
      parts.push(this.getRepairUseCaseHint(useCase.type));
      parts.push("\n");
    }

    parts.push("## Rules Context (abbreviated)\n");
    parts.push(`${rulesContext.slice(0, 1000)}\n\n`);
    parts.push("## Available Executors\n");
    parts.push(`${availableExecutors.join(", ")}\n`);

    return parts.join("\n");
  }

  private getRepairUseCaseHint(useCase: string): string {
    const hints: Record<string, string> = {
      coding:
        "Focus on generating implementation-focused tasks. Each task should reflect a step in software development.",
      documentation:
        "Focus on documentation structure. Create tasks for outlining, writing, and reviewing documentation. Avoid coding tasks unless explicitly requested.",
      debugging:
        "Focus on investigation-first plans. Create tasks for understanding the error before implementing a fix.",
      research:
        "Focus on investigation tasks. Create tasks for gathering information, analyzing sources, and documenting findings. Do not invent facts.",
      planning:
        "Focus on analysis and structure. Create tasks for requirements analysis, plan creation, and review.",
      "project-setup": "Focus on scaffolding. Create tasks for each configuration step.",
      testing:
        "Focus on test coverage. Create tasks for test design, implementation, and execution.",
      devops:
        "Focus on infrastructure and automation. Create tasks for configuration, deployment, and validation.",
      "data-analysis":
        "Focus on the analytical workflow. Create tasks for data gathering, processing, analysis, visualization, and reporting.",
      "ui-design":
        "Focus on design and implementation. Create tasks for reviewing existing UI, designing, implementing, and verifying quality.",
      writing:
        "Focus on content creation. Create tasks for outlining, writing, editing, and finalizing content. Avoid coding tasks.",
      general: "",
    };
    return hints[useCase] ?? "";
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
    const filePath = path.join(outputsDir, `ai-planner-error-attempt-${attemptNumber}.txt`);
    const content = `Error: ${errorMessage}\n\nRaw output:\n${rawOutput}\n`;
    await writeTextFile(filePath, content);
    return filePath;
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

  private async processPlannerOutput(
    executorResult: { rawOutput: string; stdout: string },
    input: PlannerInput,
    runId: string | undefined,
  ): Promise<PlannerResult> {
    const rawOutput = executorResult.rawOutput;

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

    this.validateExecutors(data, availableExecutors(input));

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
            `AI plan task "${aiTask.title}" depends on unknown task "${dep}". Each dependency must reference the exact "title" of a previous task in the plan.`,
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

  private validateExecutors(data: AiPlannerOutput, availableExecutors: string[]): void {
    const executorSet = new Set(availableExecutors);
    for (const task of data.tasks) {
      if (!VALID_EXECUTORS.has(task.executor) && !executorSet.has(task.executor)) {
        throw new Error(
          `AI plan task "${task.title}" uses unknown executor "${task.executor}". Valid executors: ${availableExecutors.join(", ")}`,
        );
      }
    }
  }

  private resolveExecutor(taskExecutor: string): string {
    if (taskExecutor === "ai") {
      return this.config.defaultExecutor;
    }
    if (
      VALID_EXECUTORS.has(taskExecutor) ||
      (this.config.executors && taskExecutor in this.config.executors)
    ) {
      return taskExecutor;
    }
    return this.config.defaultExecutor;
  }
}

function availableExecutors(input: PlannerInput): string[] {
  return input.availableExecutors ?? [];
}
