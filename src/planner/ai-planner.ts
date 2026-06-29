import { spawn } from "node:child_process";
import path from "node:path";
import picocolors from "picocolors";
import { type Planner, type PlannerInput, type PlannerResult } from "./planner.js";
import { type AiPlannerOutput } from "../schemas/planner.schema.js";
import { generateRunId } from "../utils/ids.js";
import { PlannerContextBuilder } from "../context/planner-context-builder.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { buildCommandArgs } from "../executor/build-command-args.js";
import { writeTextFile, ensureDir } from "../utils/fs.js";
import { UseCaseDetector } from "../usecase/usecase-detector.js";
import type { UseCaseDetection } from "../usecase/usecase-types.js";
import { getUseCaseName } from "../usecase/task-templates.js";
import { processPlannerOutput } from "./process-planner-output.js";

const VALID_EXECUTORS = new Set(["shell", "manual", "opencode", "claude", "codex", "aider"]);

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

    console.log(picocolors.cyan(`    Calling AI planner (attempt ${attemptNumber})...`));

    const result = await this.executeSpawn(
      command,
      executorConfig.args ?? [],
      input,
      context,
      runId,
      `AI planner executor "${executorName}"`,
    );

    await this.saveRawOutput(
      input.projectRoot,
      runId,
      result.rawOutput,
      `ai-planner-raw-attempt-${attemptNumber}.txt`,
    );

    return result;
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

    const result = await this.executeSpawn(
      command,
      executorConfig.args ?? [],
      input,
      repairContext,
      runId,
      "AI planner repair",
    );

    await this.saveRawOutput(
      input.projectRoot,
      runId,
      result.rawOutput,
      "ai-planner-raw-attempt-2.txt",
    );

    return result;
  }

  private async executeSpawn(
    command: string,
    args: string[],
    input: PlannerInput,
    context: string,
    runId: string | undefined,
    label: string,
  ): Promise<{ rawOutput: string; stdout: string }> {
    const { args: finalArgs, stdin } = buildCommandArgs({
      args,
      inputMode: "stdin",
      contextPackContent: context,
      contextPackPath: "",
      fileArg: undefined,
    });

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
            timeout: 1800000,
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
            resolve({ exitCode, stdout: stdoutBuffer.join(""), stderr: stderrBuffer.join("") });
          });

          child.on("error", (err) => {
            reject(err);
          });
        },
      );

      if (result.exitCode !== 0) {
        throw new Error(
          `${label} exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim().slice(0, 200)}`,
        );
      }

      const output = result.stdout.trim();
      if (!output) {
        throw new Error(`${label} produced empty output`);
      }

      return { rawOutput: output, stdout: result.stdout };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${label} failed: ${message}`);
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
    parts.push("The last character must be `}`.\n");
    parts.push(
      "Do not use `requiredFiles` or `requiredContent`. These fields do not exist in the schema.\n\n",
    );
    parts.push("## Expected JSON Output Schema\n");
    parts.push("```json\n");
    parts.push(`{
  "title": "Short run title",
  "summary": "One-line summary of the plan",
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description of what to do",
      "executor": "shell",
      "dependsOn": ["Exact title of previous task"],
      "riskLevel": "safe",
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "validation": {
        "commands": ["pnpm test"],
        "requireGitDiff": false
      },
      "expectedResult": "Describe what the expected outcome of this task looks like",
      "outputPlan": [
        {
          "action": "create",
          "target": "src/generated/output.ts",
          "description": "Generated output file with implementation",
          "validationMethod": "file_exists"
        },
        {
          "action": "modify",
          "target": "src/existing-file.ts",
          "description": "Modified existing file",
          "validationMethod": "file_diff"
        }
      ]
    }
  ]
}\n`);
    parts.push("```\n\n");
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
    _runId: string | undefined,
  ): Promise<PlannerResult> {
    return processPlannerOutput({
      rawOutput: executorResult.rawOutput,
      input,
      runId: generateRunId(input.prompt),
      validateExecutors: (data, available) => this.validateExecutors(data, available),
      resolveExecutor: (taskExecutor) => this.resolveExecutor(taskExecutor),
      getAvailableExecutors: (inp) => availableExecutors(inp),
    });
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
