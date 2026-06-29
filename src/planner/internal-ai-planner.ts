import path from "node:path";
import picocolors from "picocolors";
import { type Planner, type PlannerInput, type PlannerResult } from "./planner.js";
import { type AiPlannerOutput } from "../schemas/planner.schema.js";
import { generateRunId } from "../utils/ids.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { writeTextFile, ensureDir } from "../utils/fs.js";
import { ProviderRegistry } from "../ai/provider-registry.js";
import { processPlannerOutput } from "./process-planner-output.js";
import type { AiProviderStreamChunk } from "../ai/ai-provider.js";
import { getEventBus } from "../ui/event-bus.js";
import { UseCaseDetector } from "../usecase/usecase-detector.js";
import type { UseCaseDetection } from "../usecase/usecase-types.js";
import { getUseCaseName } from "../usecase/task-templates.js";
import { TaskContextBuilder } from "../context/task-context-builder.js";

const VALID_EXECUTORS = new Set(["shell", "manual", "opencode", "claude", "codex", "aider"]);

export interface PlannerProviderMetadata {
  provider: string;
  model: string;
  responseFormatRequested: string;
  responseFormatUsed: string;
  responseFormatFallback: boolean;
  streaming: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export class InternalAiPlanner implements Planner {
  private config: FlowTaskConfig;
  private providerRegistry: ProviderRegistry;
  private useCaseDetector: UseCaseDetector;

  constructor(config: FlowTaskConfig) {
    this.config = config;
    this.providerRegistry = new ProviderRegistry(config);
    this.useCaseDetector = new UseCaseDetector(config.useCase);
  }

  async createPlan(input: PlannerInput): Promise<PlannerResult> {
    const plannerConfig = this.config.planner!;
    const provider = this.providerRegistry.getProvider(plannerConfig.provider);
    const runId = input.runId;
    const enableStream = plannerConfig.stream ?? false;

    const useCase = input.useCase ?? this.useCaseDetector.detect(input.prompt);
    const useCaseInfo = {
      type: useCase.type,
      name: getUseCaseName(useCase.type),
      confidence: useCase.confidence,
    };

    if (useCase.type !== "general") {
      console.log(
        picocolors.dim(
          `  Detected use case: ${useCaseInfo.name} (${Math.round(useCaseInfo.confidence * 100)}% confidence)`,
        ),
      );
    }

    const inputWithUseCase: PlannerInput = { ...input, useCase };

    if (!input.projectFilesContext) {
      const contextBuilder = new TaskContextBuilder();
      const taskContext = await contextBuilder.build(input.projectRoot, input.prompt);
      inputWithUseCase.projectFilesContext = taskContext.contextPack;
      console.log(picocolors.dim(`  ${contextBuilder.formatSummary(taskContext)}`));
    }

    console.log(
      picocolors.cyan(
        `  Calling internal AI planner (provider: ${provider.name}, model: ${plannerConfig.model})...`,
      ),
    );

    if (enableStream && provider.supportsStreaming) {
      console.log(picocolors.dim("    Streaming enabled"));
    }

    const streamEnabled = enableStream && (provider.supportsStreaming ?? false);

    const attempt1 = await this.executePlanner(
      provider.name,
      inputWithUseCase,
      runId,
      1,
      streamEnabled,
    );

    try {
      return await this.processPlannerOutput(attempt1.output, input, runId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.savePlannerError(
        input.projectRoot,
        runId,
        errorMessage,
        attempt1.output,
        attempt1.metadata,
        1,
      );

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
        inputWithUseCase,
        runId,
        errorMessage,
        attempt1.output,
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
          repairOutput,
          {
            provider: "",
            model: "",
            responseFormatRequested: "",
            responseFormatUsed: "",
            responseFormatFallback: false,
            streaming: false,
          },
          2,
        );

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
    enableStream: boolean = false,
  ): Promise<{ output: string; metadata: PlannerProviderMetadata }> {
    const systemPrompt = this.buildSystemPrompt(input.useCase);
    const userPrompt = this.buildUserPrompt(input);
    const plannerConfig = this.config.planner!;
    const provider = this.providerRegistry.getProvider(plannerConfig.provider);
    const eventBus = getEventBus();

    let responseFormatFallback = false;
    let responseFormatUsed = "json_object";

    const baseRequest = {
      systemPrompt,
      userPrompt,
      temperature: plannerConfig.temperature ?? 0.1,
      maxTokens: plannerConfig.maxTokens ?? 16384,
      responseFormat: "json_object" as const,
      timeoutMs: plannerConfig.timeoutMs,
      stream: enableStream,
    };

    let responseText: string;
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

    if (enableStream && provider.supportsStreaming && provider.stream) {
      eventBus.emit({
        type: "ai_provider_stream_started",
        provider: provider.name,
        model: plannerConfig.model ?? "",
        runId,
        timestamp: new Date().toISOString(),
      });

      const streamChunks: string[] = [];

      const result = await provider.stream(baseRequest, async (chunk: AiProviderStreamChunk) => {
        if (chunk.textDelta) {
          streamChunks.push(chunk.textDelta);
          eventBus.emit({
            type: "ai_provider_stream_delta",
            provider: provider.name,
            model: plannerConfig.model ?? "",
            runId,
            textDelta: chunk.textDelta,
            timestamp: new Date().toISOString(),
          });
        }

        if (chunk.done) {
          eventBus.emit({
            type: "ai_provider_stream_completed",
            provider: provider.name,
            model: plannerConfig.model ?? "",
            runId,
            usage: chunk.usage,
            timestamp: new Date().toISOString(),
          });
        }
      });

      responseText = result.text;
      usage = result.usage;
    } else {
      let result;
      // Try with json_object response format, fall back without it
      try {
        result = await provider.generate(baseRequest);
      } catch {
        // Check if it's a response_format error
        const { generateWithResponseFormatFallback } =
          await import("../ai/response-format-fallback.js");
        const fallbackResult = await generateWithResponseFormatFallback(
          providerName,
          baseRequest,
          (req) => provider.generate(req),
        );
        result = fallbackResult.response;
        responseFormatFallback = fallbackResult.fallbackOccurred;
      }

      responseText = result.text;
      usage = result.usage;
      if (responseFormatFallback) {
        responseFormatUsed = "text";
      }
    }

    const output = responseText.trim();

    await this.saveRawOutput(
      input.projectRoot,
      runId,
      output,
      `internal-ai-planner-raw-attempt-${attemptNumber}.txt`,
    );

    // Save provider metadata
    const metadata: PlannerProviderMetadata = {
      provider: providerName,
      model: plannerConfig.model ?? "",
      responseFormatRequested: "json_object",
      responseFormatUsed,
      responseFormatFallback,
      streaming: enableStream,
      usage,
    };

    await this.saveProviderMetadata(input.projectRoot, runId, metadata);

    if (usage) {
      console.log(
        picocolors.dim(
          `    Tokens: ${usage.inputTokens ?? "?"} in / ${usage.outputTokens ?? "?"} out`,
        ),
      );
    }

    if (responseFormatFallback) {
      console.log(
        picocolors.yellow("    Response format json_object not supported, retried without it"),
      );
    }

    return { output, metadata };
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
      maxTokens: 16384,
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

  private buildSystemPrompt(useCase?: UseCaseDetection): string {
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
              description:
                "Exact blueprint: create src/auth/LoginForm.tsx with email/password fields and submit handler per the design spec",
              executor: "shell | opencode | claude",
              dependsOn: ["Title of previous task"],
              riskLevel: "safe | risky | dangerous | low | medium | high",
              acceptanceCriteria: ["Criterion 1"],
              commands: ["shell command (only if executor=shell)"],
              validation: {
                commands: ["pnpm test"],
                requireGitDiff: false,
              },
              expectedResult: "Describe what the expected outcome of this task looks like",
              outputPlan: [
                {
                  action: "create | modify | delete",
                  target: "path/to/output/file.md",
                  description: "Description of what this output is",
                  validationMethod:
                    "file_exists | file_diff | file_content | command_output | test | ai_review | manual",
                },
              ],
              taskType:
                "general | coding | documentation | research | data | writing | design | qa | release | operations | testing | analysis | review | approval | validation",
              actionType:
                "create | modify | delete | read | analyze | execute | validate | approve | review | transform | generate | investigate",
              inputContext:
                "What context information this task needs from previous steps (e.g., 'needs auth service output, validation results')",
              targetFiles: ["src/files/to/modify.ts", "docs/to/create.md"],
              targetArtifacts: ["report.md", "summary.txt"],
              evidence: ["src/file.ts was created", "command exited with 0", "test passed"],
              verificationCommand: "pnpm test -- --run",
              approvalRequired: false,
              retryPolicy: {
                maxRetries: 2,
                retryDelayMs: 1000,
                retryBackoff: "linear | exponential | fixed",
              },
              timeout: {
                durationMs: 60000,
                action: "fail | retry | cancel | skip",
              },
              finalOutputContribution:
                "This step produces the auth module which is the core of the feature",
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
    parts.push("- dependsOn may use previous task titles. FlowTask will normalize them.");
    parts.push(
      "- Each task should include expectedResult describing what the concrete outcome or evidence of completion will be.",
    );
    parts.push("- Do not create tasks that install dependencies unless explicitly required.");
    parts.push("- Do not create unsafe commands.");
    parts.push("- Do not mark the final validation task as an AI task.");
    parts.push("");
    parts.push(
      "- Each task should include an `outputPlan` array listing expected outputs (files, artifacts) with action type, target path, description, and validation method.",
    );
    parts.push(
      '- Use validationMethod "file_exists" for newly created files, "file_diff" for modified files, and "file_content" when specific file content must be checked.',
    );
    parts.push(
      "- For tasks that produce no files (e.g., running validation), set outputPlan to an empty array.",
    );
    parts.push(
      "- Do not use `requiredFiles` or `requiredContent`. These fields do not exist in the schema.",
    );
    parts.push("");
    parts.push("## Structured Step Metadata Rules");
    parts.push(
      "- Set `taskType` to classify the kind of work: coding, documentation, research, data, writing, design, qa, release, operations, testing, analysis, review, approval, validation, or general.",
    );
    parts.push(
      "- Set `actionType` to describe the primary action: create, modify, delete, read, analyze, execute, validate, approve, review, transform, generate, or investigate.",
    );
    parts.push(
      "- Use `inputContext` to describe what information this task needs from previous steps. This helps the executor understand prerequisites.",
    );
    parts.push(
      "- List concrete `targetFiles` that this task will create or modify. These should match the outputPlan entries.",
    );
    parts.push(
      "- List non-file `targetArtifacts` this task produces (reports, summaries, checklists, decisions).",
    );
    parts.push(
      "- Set `evidence` to list specific, verifiable proof that the task completed successfully (e.g., 'file exists', 'exit code 0', 'test passed').",
    );
    parts.push(
      '- Use `verificationCommand` for a single command that can verify task completion (e.g., "pnpm test" or "ls src/output.ts").',
    );
    parts.push(
      "- Set `approvalRequired: true` for risky operations that need human review before execution runs.",
    );
    parts.push(
      "- Configure `retryPolicy` for tasks that may need retries: set maxRetries, retryDelayMs, and retryBackoff (linear/exponential/fixed).",
    );
    parts.push(
      "- Configure `timeout` for tasks that should not run indefinitely: set durationMs and action (fail/retry/cancel/skip).",
    );
    parts.push(
      "- Use `finalOutputContribution` to describe how this task's output feeds into the overall workflow goal. This helps with final report generation.",
    );

    if (useCase && useCase.type !== "general") {
      const hint = this.getUseCaseHint(useCase.type);
      const plannerGuide = this.getUseCasePlannerGuide(useCase.type);
      parts.push("## Detected Use Case");
      parts.push(`This task is detected as **${getUseCaseName(useCase.type)}**.`);
      parts.push(hint);
      parts.push("");
      parts.push("## Use Case Planning Guide");
      parts.push(plannerGuide);
      parts.push("");
    }

    parts.push("## Detailed Blueprint Requirements");
    parts.push("Each task description MUST be a precise implementation blueprint:");
    parts.push("- Specify the EXACT files to create or modify (with relative paths).");
    parts.push("- Describe the EXACT logic, patterns, or content to produce.");
    parts.push("- Reference specific function names, class names, or module names when relevant.");
    parts.push("- For each file change, specify what to add, change, or remove.");
    parts.push(
      "- Do NOT write vague titles like 'Implement feature' — use e.g. 'Add UserService.login() in src/services/user-service.ts'.",
    );
    parts.push(
      "- Task titles must be specific and actionable — they should name the exact file, module, or function being worked on.",
    );
    parts.push(
      "- The executor follows the task description as a literal recipe — no re-analysis, no deviation.",
    );
    parts.push("- Include concrete examples of expected output where helpful.");
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

  private getUseCasePlannerGuide(useCase: string): string {
    const guides: Record<string, string> = {
      coding:
        "For coding tasks: break implementation into logical steps. Include tasks for reading project rules, understanding requirements, designing the solution, implementing code, adding tests, and running validation.",
      documentation:
        "For documentation tasks: focus on structure and clarity. Include tasks for reviewing existing docs, outlining content, writing, reviewing, and finalizing. Do NOT create coding tasks unless the prompt explicitly asks for code.",
      debugging:
        "For debugging tasks: focus on investigation before fixing. Include tasks for understanding the error, inspecting relevant code, identifying root cause, implementing a targeted fix, and verifying the fix works.",
      research:
        "For research tasks: focus on thorough investigation. Include tasks for defining research questions, gathering information from sources, analyzing findings, and documenting conclusions with supporting evidence. Do not invent facts.",
      planning:
        "For planning tasks: focus on analysis and structure. Include tasks for understanding goals, analyzing requirements, creating a detailed plan, and reviewing the plan for completeness.",
      "project-setup":
        "For setup tasks: focus on scaffolding and configuration. Include tasks for understanding requirements, creating project structure, configuring tools, and verifying the setup works correctly.",
      testing:
        "For testing tasks: focus on coverage and verification. Include tasks for understanding the code under test, designing test cases, implementing tests, running them, and fixing any discovered issues.",
      devops:
        "For DevOps tasks: focus on infrastructure and automation. Include tasks for understanding infrastructure needs, creating or updating configuration, applying changes, and validating with dry-runs.",
      "data-analysis":
        "For data analysis tasks: focus on the analytical process. Include tasks for understanding data requirements, gathering/loading data, processing and analyzing, creating visualizations, and documenting findings with methodology.",
      "ui-design":
        "For UI/UX tasks: focus on design and implementation. Include tasks for reviewing existing UI, designing components, implementing changes, and verifying quality/accessibility.",
      writing:
        "For writing/content tasks: focus on prose and structure. Include tasks for understanding the writing requirements, outlining content, researching if needed, writing drafts, and reviewing/editing for quality. Avoid coding tasks.",
      general: "",
    };
    return guides[useCase] ?? "";
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
    parts.push(
      "Do not use `requiredFiles` or `requiredContent`. These fields do not exist in the schema.",
    );
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
                requireGitDiff: true,
              },
              expectedResult: "string",
              outputPlan: [
                {
                  action: "create | modify | delete",
                  target: "path/to/output/file.md",
                  description: "string",
                  validationMethod:
                    "file_exists | file_diff | file_content | command_output | test | ai_review | manual",
                },
              ],
              taskType:
                "general | coding | documentation | research | data | writing | design | qa | release | operations | testing | analysis | review | approval | validation",
              actionType:
                "create | modify | delete | read | analyze | execute | validate | approve | review | transform | generate | investigate",
              inputContext: "string",
              targetFiles: ["string"],
              targetArtifacts: ["string"],
              evidence: ["string"],
              verificationCommand: "string",
              approvalRequired: false,
              retryPolicy: {
                maxRetries: 2,
                retryDelayMs: 1000,
                retryBackoff: "linear | exponential | fixed",
              },
              timeout: {
                durationMs: 60000,
                action: "fail | retry | cancel | skip",
              },
              finalOutputContribution: "string",
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

    const projectMode = this.config.projectMode ?? "development";
    parts.push("## Project Mode");
    parts.push(`This project is in **${projectMode}** mode.`);
    parts.push(this.getModeHint(projectMode));
    parts.push("");

    if (input.useCase && input.useCase.type !== "general") {
      const useCaseName = getUseCaseName(input.useCase.type);
      parts.push("## Detected AI Use Case");
      parts.push(`**${useCaseName}** (confidence: ${Math.round(input.useCase.confidence * 100)}%)`);
      parts.push(this.getUseCaseHint(input.useCase.type));
      parts.push("");
    }

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

    if (input.projectFilesContext) {
      parts.push(input.projectFilesContext);
      parts.push("");
    }

    parts.push("## Task Planning Rules");
    parts.push("- Break the work into logical sequential tasks.");
    parts.push("- Each task must have at least one acceptance criterion.");
    parts.push(
      "- Each task should include expectedResult describing the concrete outcome or evidence that will exist after the task completes.",
    );
    parts.push("- Dependencies reference the exact `title` of previous tasks.");
    parts.push("- Maximum 15 tasks per run.");
    parts.push('- If the user asks to "update README", create a task plan for updating README.');
    parts.push("  Do NOT write the README content. Create tasks for the executor.");
    parts.push("- Choose executor based on what the task needs.");
    parts.push('  "shell" for read-only/file operations, "opencode" or other for creative work.');
    parts.push("- Set commands only when executor is shell and the command is safe.");
    parts.push(
      "- Each task should include an `outputPlan` array listing expected outputs with action type (create/modify/delete), target path, description, and validation method.",
    );
    parts.push(
      '- Use validationMethod "file_exists" for newly created files, "file_diff" for modified files, "file_content" when specific content must be checked.',
    );
    parts.push("");
    parts.push("## Structured Step Metadata Rules");
    parts.push(
      "- Classify each task with `taskType`: coding, documentation, research, data, writing, design, qa, release, operations, testing, analysis, review, approval, validation, or general.",
    );
    parts.push(
      "- Classify each task with `actionType`: create, modify, delete, read, analyze, execute, validate, approve, review, transform, generate, or investigate.",
    );
    parts.push(
      "- Use `inputContext` to specify what data or context from prior steps this task depends on.",
    );
    parts.push("- List concrete `targetFiles` that will be created or modified.");
    parts.push(
      "- List non-file `targetArtifacts` this task produces (reports, summaries, checklists).",
    );
    parts.push(
      "- Set `evidence` to specific verifiable proof items (e.g., 'file exists', 'exit code 0').",
    );
    parts.push("- Use `verificationCommand` for a single verification command.");
    parts.push("- Set `approvalRequired: true` for risky steps needing human review.");
    parts.push("- Configure `retryPolicy` and `timeout` for tasks that need them.");
    parts.push(
      "- Use `finalOutputContribution` to describe how this task feeds into the overall workflow goal.",
    );
    parts.push("");
    parts.push("## Detailed Blueprint Requirements");
    parts.push("Each task description MUST be a precise implementation blueprint:");
    parts.push("- Specify the EXACT files to create or modify (with relative paths).");
    parts.push("- Describe the EXACT logic, patterns, or content to produce.");
    parts.push("- Reference specific function names, class names, or module names when relevant.");
    parts.push("- For each file change, specify what to add, change, or remove.");
    parts.push(
      "- Do NOT write vague titles like 'Implement feature' — use e.g. 'Add UserService.login() in src/services/user-service.ts'.",
    );
    parts.push(
      "- Task titles must be specific and actionable — they should name the exact file, module, or function being worked on.",
    );
    parts.push(
      "- The executor follows the task description as a literal recipe — no re-analysis, no deviation.",
    );
    parts.push("- Include concrete examples of expected output where helpful.");

    return parts.join("\n");
  }

  private async processPlannerOutput(
    rawOutput: string,
    input: PlannerInput,
    runId: string | undefined,
  ): Promise<PlannerResult> {
    return processPlannerOutput({
      rawOutput,
      input,
      runId: runId ?? generateRunId(input.prompt),
      validateExecutors: (data) => {
        this.validateShellTasks(data);
        this.validateExecutors(data);
      },
      resolveExecutor: (taskExecutor) => this.resolveExecutor(taskExecutor),
      getAvailableExecutors: () => [],
    });
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

  private async saveProviderMetadata(
    projectRoot: string,
    runId: string | undefined,
    metadata: PlannerProviderMetadata,
  ): Promise<void> {
    if (!runId) return;
    const outputsDir = path.join(projectRoot, ".flowtask", "runs", runId, "outputs");
    await ensureDir(outputsDir);
    const filePath = path.join(outputsDir, "internal-ai-planner-provider.json");
    await writeTextFile(filePath, JSON.stringify(metadata, null, 2));
  }

  private getModeHint(mode: string): string {
    switch (mode) {
      case "development":
        return "Coding assumptions are allowed. Use development validation when configured.";
      case "writing":
        return "Do NOT assume this is a coding task unless the user explicitly asks for code. Focus on document structure and clarity.";
      case "research":
        return "Do NOT invent facts. Separate facts from assumptions. Track sources.";
      case "general":
        return "Avoid developer-specific assumptions unless the prompt is clearly about code.";
      default:
        return "";
    }
  }

  private getUseCaseHint(useCase: string): string {
    const hints: Record<string, string> = {
      coding:
        "Focus on code quality, type safety, and following project conventions. Generate implementation tasks.",
      documentation:
        "Focus on clarity, completeness, and structure. Do not write code unless explicitly required.",
      debugging:
        "Focus on understanding the error, finding root cause, and applying targeted fixes.",
      research: "Do not invent facts. Separate facts from assumptions. Plan investigation tasks.",
      planning: "Focus on analysis and structure. Create tasks for documenting the plan.",
      "project-setup":
        "Focus on scaffolding, configuration, and tooling. Create tasks for each setup step.",
      testing:
        "Focus on test coverage, edge cases, and verification. Do not modify production code.",
      devops: "Focus on infrastructure, automation, and deployment configuration.",
      "data-analysis": "Focus on data processing, statistics, and clear visualizations.",
      "ui-design": "Focus on design systems, accessibility, responsiveness, and user experience.",
      writing: "Focus on clear prose, structure, and readability. Avoid code tasks.",
      general: "",
    };
    const hint = hints[useCase];
    return hint ? `Task focus hint: ${hint}` : "";
  }

  private async savePlannerError(
    projectRoot: string,
    runId: string | undefined,
    errorMessage: string,
    rawOutput: string,
    _metadata: PlannerProviderMetadata,
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
