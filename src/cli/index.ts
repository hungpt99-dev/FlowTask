import { Command } from "commander";
import picocolors from "picocolors";
import path from "node:path";
import { execSync } from "node:child_process";
import { spawnWithPromise } from "../utils/process.js";
import { initCommand } from "./commands/init.command.js";
import { globalInstallFailedError, globalInstallSuccess } from "./errors.js";
import { runCommand } from "./commands/run.command.js";
import { statusCommand } from "./commands/status.command.js";
import { runsCommand } from "./commands/runs.command.js";
import { tasksCommand } from "./commands/tasks.command.js";
import { tasksEditCommand } from "./commands/tasks-edit.command.js";
import { tasksApproveCommand, tasksDenyCommand } from "./commands/tasks-approve.command.js";
import { logsCommand } from "./commands/logs.command.js";
import { resumeCommand } from "./commands/resume.command.js";
import { retryCommand } from "./commands/retry.command.js";
import { inspectCommand } from "./commands/inspect.command.js";
import { showCommand } from "./commands/show.command.js";
import { historyCommand } from "./commands/history.command.js";
import { duplicateCommand } from "./commands/duplicate.command.js";
import { diffCommand } from "./commands/diff.command.js";
import { exportCommand } from "./commands/export.command.js";
import { stopCommand } from "./commands/stop.command.js";
import { cancelCommand } from "./commands/cancel.command.js";
import { cleanCommand } from "./commands/clean.command.js";
import {
  doctorCommand,
  doctorProvidersCommand,
  doctorValidationCommand,
} from "./commands/doctor.command.js";
import { rulesCommand } from "./commands/rules.command.js";
import {
  listProvidersCommand,
  currentProviderCommand,
  testProviderCommand,
  removeProviderCommand,
  configureProviderCommand,
} from "./commands/providers.command.js";
import { setupAiCommand } from "./commands/setup.command.js";
import {
  configSetCommand,
  configGetCommand,
  configListCommand,
} from "./commands/config.command.js";
import { stepsCommand } from "./commands/steps.command.js";
import {
  workflowShowCommand,
  workflowDiffCommand,
  workflowApplyCommand,
  workflowAddCommand,
  workflowRemoveCommand,
  workflowReorderCommand,
  workflowEditCommand,
  workflowReplanCommand,
  workflowListCommand,
} from "./commands/workflow.command.js";
import {
  stepEditCommand,
  stepApproveCommand,
  stepDenyCommand,
  stepApproveAllCommand,
} from "./commands/step.command.js";
import { inputCommand } from "./commands/input.command.js";
import { watchCommand } from "./commands/watch.command.js";
import { killCommand } from "./commands/kill.command.js";
import {
  approveCommand,
  rejectCommand,
  continueCommand,
  overrideCommand,
} from "./commands/approve.command.js";
import {
  templatesListCommand,
  templatesShowCommand,
  templatesCategoriesCommand,
  templatesInferCommand,
} from "./commands/templates.command.js";
import { scanCommand } from "./commands/scan.command.js";
import { planCommand } from "./commands/plan.command.js";
import { artifactsCommand } from "./commands/artifacts.command.js";
import { validateCommand } from "./commands/validate.command.js";
import { pauseCommand } from "./commands/pause.command.js";
import { graphCommand } from "./commands/graph.command.js";
import { skipCommand } from "./commands/skip.command.js";
import { reportCommand } from "./commands/report.command.js";
import { configureAiCommand } from "./commands/configure.command.js";
import { healthCheckCommand } from "./commands/healthcheck.js";

const program = new Command();

program
  .name("flowtask")
  .description("AI workflow orchestrator. Give AI a task. Watch it run.")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize a FlowTask project in the current directory")
  .option("--name <name>", "Project name")
  .option("--mode <mode>", "Project mode: development | writing | research | general")
  .option("--force", "Force reinitialization")
  .option("--show-modes", "List available init modes and descriptions")
  .action((opts: { name?: string; mode?: string; force?: boolean; showModes?: boolean }) => {
    initCommand(opts);
  });

program
  .command("setup")
  .description("Configure AI provider setup")
  .argument("[type]", "Setup type: ai", "ai")
  .option("--provider <name>", "Provider name (openai, anthropic, gemini, etc.)")
  .option("--model <name>", "Default model for the provider")
  .option("--base-url <url>", "Provider base URL")
  .option("--api-key-env <env>", "Environment variable name for API key")
  .action(
    (
      _type: string,
      opts: { provider?: string; model?: string; baseUrl?: string; apiKeyEnv?: string },
    ) => {
      setupAiCommand(opts);
    },
  );

program
  .command("run", { isDefault: false })
  .description("Start a new run from a prompt")
  .allowUnknownOption(true)
  .argument("<prompt>", "The prompt describing the work to be done")
  .option("--executor <name>", "Executor to use (shell, opencode, claude, codex)")
  .option("--mode <mode>", "Run mode: auto | manual | plan-only | dry-run | debug", "auto")
  .option("--planner <mode>", "Planner mode: simple | ai | auto", "auto")
  .option("--planner-provider <name>", "AI planner provider (e.g. openai, anthropic, gemini)")
  .option(
    "--planner-model <name>",
    "AI planner model (e.g. gpt-4.1-mini, claude-3-5-sonnet-latest)",
  )
  .option("--planner-base-url <url>", "AI planner base URL override")
  .option("--planner-timeout <ms>", "AI planner timeout in milliseconds")
  .option("--planner-stream", "Enable AI planner streaming")
  .option("--no-planner-stream", "Disable AI planner streaming")
  .option("--ui", "Force rich terminal UI")
  .option("--no-ui", "Disable rich terminal UI")
  .option("--json", "Output machine-readable JSON events")
  .option("--quiet", "Show only important status and errors")
  .option("--verbose", "Show more detailed output")
  .option("--quality", "Run quality checks after completion")
  .option("--skip-validation", "Skip validation after each task execution")
  .option("--plan-only", "Only generate the plan, do not execute")
  .option("--dry-run", "Show what would happen without executing")
  .option("--debug", "Show detailed debug information")
  .option("--template <name>", "Template to use: feature | bugfix | docs")
  .option(
    "--approval-mode <mode>",
    "Approval mode: auto (auto-approve) | manual (prompt) | skip (skip all approvals)",
  )
  .action(runCommand);

program
  .command("status")
  .description("Show current project and run status")
  .argument("[runId]", "Run ID to show status for")
  .action((runId?: string) => {
    statusCommand(runId);
  });

program
  .command("runs")
  .description("List all runs in the project")
  .option("--status <status>", "Filter by status (comma-separated)")
  .option("--limit <number>", "Limit number of results", "20")
  .option("--offset <number>", "Skip N results", "0")
  .option("--mode <mode>", "Filter by mode (comma-separated)")
  .option("--query <query>", "Search by title or user goal")
  .action(runsCommand);

program
  .command("tasks")
  .description("List tasks")
  .option("--run <runId>", "Filter by run ID")
  .option("--all", "Show all tasks across all runs")
  .option("--status <status>", "Filter by status")
  .action(tasksCommand);

program
  .command("tasks-edit")
  .description(
    "Edit a task's details (title, description, executor, acceptance criteria, validation)",
  )
  .argument("<taskId>", "Task ID to edit")
  .option("--run <runId>", "Run ID containing the task")
  .option("--title <title>", "New task title")
  .option("--description <description>", "New task description")
  .option("--executor <name>", "New task executor (shell, opencode, claude, etc.)")
  .option(
    "--acceptance-criteria <criteria>",
    'Pipe-separated acceptance criteria (e.g., "AC1|AC2|AC3")',
  )
  .option(
    "--validation-commands <commands>",
    'Pipe-separated validation commands (e.g., "pnpm test|pnpm lint")',
  )
  .action(tasksEditCommand);

program
  .command("tasks-approve")
  .description("Approve a task that is waiting for approval")
  .argument("<taskId>", "Task ID to approve")
  .option("--run <runId>", "Run ID containing the task")
  .action(tasksApproveCommand);

program
  .command("tasks-deny")
  .description("Deny a task that is waiting for approval")
  .argument("<taskId>", "Task ID to deny")
  .option("--run <runId>", "Run ID containing the task")
  .action(tasksDenyCommand);

program
  .command("logs")
  .description("Show logs for runs and tasks")
  .argument("[runId]", "Run ID (optional, uses active run if omitted)")
  .option("--follow", "Follow logs in real time (tail -f style)")
  .option("--run <runId>", "Filter by run ID (alternative to positional arg)")
  .option("--task <taskId>", "Filter by task ID")
  .option("--validation", "Show validation logs only")
  .option("--runtime", "Show runtime logs only")
  .option("--tail <number>", "Number of lines to show from the end", "80")
  .action(
    (
      runId: string | undefined,
      opts: {
        follow?: boolean;
        run?: string;
        task?: string;
        validation?: boolean;
        runtime?: boolean;
        tail?: string;
      },
    ) => {
      logsCommand({ ...opts, run: runId ?? opts.run });
    },
  );

program
  .command("resume")
  .description("Resume an interrupted run and continue execution")
  .argument("[runId]", "Run ID to resume")
  .option("--from <taskId>", "Continue from a specific task ID")
  .option("--skip-interrupted", "Skip interrupted tasks instead of retrying them")
  .option("--skip-validation", "Skip validation after each task execution")
  .option("--dry-run", "Show what would resume without executing")
  .action(resumeCommand);

program
  .command("retry")
  .description("Retry a failed task, failed tasks in a run, or from a point in the workflow")
  .argument("<taskOrRunId>", "Task ID to retry (or run ID with --failed-only or --from)")
  .option("--run <runId>", "Run ID containing the task")
  .option("--continue", "Continue remaining pending tasks after retry")
  .option("--force", "Force retry even if maxRetries reached")
  .option("--dry-run", "Show retry plan without executing")
  .option("--failed-only", "Retry all failed and interrupted tasks in the run")
  .option("--from <taskId>", "Retry all tasks from this point forward")
  .option("--skip-validation", "Skip validation after each task execution")
  .option(
    "--instruction <text>",
    "Additional instruction to guide the retry execution (repeatable)",
    (val: string, prev: string | string[] | undefined) => {
      if (prev === undefined) return val;
      if (Array.isArray(prev)) return [...prev, val];
      return [prev, val];
    },
  )
  .action(retryCommand);

program
  .command("inspect")
  .description("Inspect a run's details, logs, and artifacts")
  .argument("<runId>", "Run ID to inspect")
  .action(inspectCommand);

program
  .command("show")
  .description("Show detailed run information including timeline, cost, and full history")
  .argument("<runId>", "Run ID to show")
  .option("--json", "Output as JSON")
  .option("--full", "Show full details without truncation")
  .action(showCommand);

program
  .command("history")
  .description("Search and filter run history")
  .option("--status <status>", "Filter by status (comma-separated)")
  .option("--limit <number>", "Limit results", "30")
  .option("--offset <number>", "Skip N results", "0")
  .option("--mode <mode>", "Filter by mode (comma-separated)")
  .option("--query <query>", "Search by title or user goal")
  .option("--created-after <date>", "Filter by created after (ISO date)")
  .option("--created-before <date>", "Filter by created before (ISO date)")
  .option("--has-errors", "Only show runs with errors")
  .option("--unfinished", "Only show unfinished runs")
  .option("--json", "Output as JSON")
  .action(historyCommand);

program
  .command("duplicate")
  .description("Duplicate an existing run with its task structure")
  .argument("<runId>", "Run ID to duplicate")
  .option("--title <title>", "New title for the duplicated run")
  .option("--no-tasks", "Do not copy tasks from the source run")
  .option("--dry-run", "Show what would be duplicated without executing")
  .action(duplicateCommand);

program
  .command("diff")
  .description("Show workflow diff (expected vs actual) or compare two runs")
  .argument("<runId>", "Run ID for workflow diff (or first run for comparison)")
  .argument("[compareRunId]", "Second run ID for run comparison")
  .option("--json", "Output as JSON")
  .option("--detailed", "Show detailed diffs")
  .option("--workflow", "Show workflow diff (expected vs actual) for a single run")
  .action(
    (
      runId: string,
      compareRunId: string | undefined,
      opts: { json?: boolean; detailed?: boolean; workflow?: boolean },
    ) => {
      diffCommand(runId, compareRunId, opts);
    },
  );

program
  .command("export")
  .description("Export run data to JSON or YAML")
  .argument("<runId>", "Run ID to export")
  .option("--format <format>", "Output format: json | yaml", "json")
  .option("--out <file>", "Save to file instead of stdout")
  .action(exportCommand);

program
  .command("stop")
  .description("Stop the current running task and its executor process")
  .action(stopCommand);

program
  .command("kill")
  .description("Kill a stuck or waiting process by run ID")
  .argument("<runId>", "Run ID of the process to kill")
  .action(killCommand);

program
  .command("watch")
  .description("Watch the status and recent output of an interactive process")
  .argument("<runId>", "Run ID to watch")
  .option("--follow", "Continuously follow session output in real time")
  .option("--poll-interval <ms>", "Poll interval in ms when following", "2000")
  .action(watchCommand);

program
  .command("input")
  .description("Send input to a waiting process in an interactive session")
  .argument("<runId>", "Run ID of the waiting process")
  .argument("[input]", "Input text to send")
  .option("--secure", "Do not log the input value")
  .action(async (runId: string, input: string | undefined, options: { secure?: boolean }) => {
    if (!input && process.stdin.isTTY) {
      const { createInterface } = await import("node:readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("Input: ", (answer: string) => {
        rl.close();
        inputCommand(runId, answer, options);
      });
      return;
    }
    inputCommand(runId, input ?? "", options);
  });

program
  .command("approve")
  .description("Approve an interactive prompt (sends 'y' to a waiting process)")
  .argument("<runId>", "Run ID of the waiting process")
  .option("--run <runId>", "Run ID (alternative position)")
  .action((runId: string, options: Record<string, unknown>) => {
    approveCommand(runId, options);
  });

program
  .command("reject")
  .description("Reject an interactive prompt (sends 'n' to a waiting process)")
  .argument("<runId>", "Run ID of the waiting process")
  .option("--run <runId>", "Run ID (alternative position)")
  .action((runId: string, options: Record<string, unknown>) => {
    rejectCommand(runId, options);
  });

program
  .command("continue")
  .description("Send empty input (enter) to a waiting process to continue")
  .argument("<runId>", "Run ID of the waiting process")
  .option("--run <runId>", "Run ID (alternative position)")
  .action((runId: string, options: Record<string, unknown>) => {
    continueCommand(runId, options);
  });

program
  .command("override")
  .description("Override an approval gate (force proceed despite risk)")
  .argument("<runId>", "Run ID of the blocked process")
  .option("--run <runId>", "Run ID (alternative position)")
  .action((runId: string, options: Record<string, unknown>) => {
    overrideCommand(runId, options);
  });

program
  .command("cancel")
  .description("Cancel a run and stop its executor process if running")
  .argument("<runId>", "Run ID to cancel")
  .action(cancelCommand);

program
  .command("clean")
  .description("Clean up old runs")
  .option("--older-than <duration>", "Delete runs older than (e.g., 30d)")
  .option("--status <status>", "Delete runs with specific status")
  .option("--dry-run", "Show what would be deleted without actually deleting")
  .action(cleanCommand);

program
  .command("scan")
  .description("Scan the workspace and build compact context")
  .option("--prompt <text>", "Optional prompt to guide what to scan for")
  .option("--output <path>", "Output directory for scan cache")
  .option("--json", "Output as JSON")
  .action((opts: { prompt?: string; output?: string; json?: boolean }) => {
    scanCommand(opts);
  });

program
  .command("plan")
  .description("Generate a workflow plan from a prompt without executing")
  .argument("<prompt>", "The prompt describing the work to be done")
  .option("--template <name>", "Template to guide planning")
  .option("--save", "Save the plan as a run for later execution")
  .option("--json", "Output as JSON")
  .option("--output <file>", "Save plan to file")
  .option("--planner <mode>", "Planner mode: simple | ai | auto", "auto")
  .action(
    (
      prompt: string,
      opts: {
        template?: string;
        save?: boolean;
        json?: boolean;
        output?: string;
        planner?: string;
      },
    ) => {
      planCommand(prompt, opts);
    },
  );

program
  .command("artifacts")
  .description("List artifacts produced by a run")
  .argument("[runId]", "Run ID to list artifacts for")
  .option("--task <taskId>", "Filter by task ID")
  .option("--type <type>", "Filter by artifact type")
  .option("--json", "Output as JSON")
  .option("--full", "Show full details")
  .action(
    (
      runId: string | undefined,
      opts: { task?: string; type?: string; json?: boolean; full?: boolean },
    ) => {
      artifactsCommand(runId ?? "", opts);
    },
  );

program
  .command("validate")
  .description("Validate a run's task results")
  .argument("[runId]", "Run ID to validate")
  .option("--task <taskId>", "Validate a specific task")
  .option("--step <stepId>", "Validate a specific step")
  .option("--verbose", "Show detailed check results")
  .action(
    (runId: string | undefined, opts: { task?: string; step?: string; verbose?: boolean }) => {
      validateCommand(runId ?? "", opts);
    },
  );

program
  .command("pause")
  .description("Pause a running workflow")
  .argument("[runId]", "Run ID to pause")
  .option("--reason <text>", "Reason for pausing")
  .action((runId: string | undefined, opts: { reason?: string }) => {
    pauseCommand(runId ?? "", opts);
  });

program
  .command("graph")
  .description("Show workflow graph visualization")
  .argument("[runId]", "Run ID to visualize")
  .option("--json", "Output as JSON")
  .action((runId: string | undefined, opts: { json?: boolean }) => {
    graphCommand(runId ?? "", opts);
  });

program
  .command("skip")
  .description("Skip a step in a task")
  .argument("<stepId>", "Step ID to skip")
  .argument("[runId]", "Run ID containing the step (optional, uses active run)")
  .option("--run <runId>", "Run ID containing the step (alternative to positional arg)")
  .option("--task <taskId>", "Task ID containing the step")
  .option("--reason <text>", "Reason for skipping")
  .action(
    (
      stepId: string,
      runId: string | undefined,
      opts: { run?: string; task?: string; reason?: string },
    ) => {
      skipCommand(stepId, { ...opts, run: runId ?? opts.run });
    },
  );

program
  .command("report")
  .description("Generate a comprehensive final report for a run")
  .argument("<runId>", "Run ID to generate report for")
  .option("--json", "Output as JSON")
  .option("--output <file>", "Save report to file")
  .action(reportCommand);

const templateCommand = new Command("templates")
  .description("List, show, and infer workflow templates")
  .addCommand(
    new Command("list")
      .description("List available workflow templates")
      .argument("[filter]", "Optional filter by name, category, or workflow type")
      .action(async (filter?: string) => {
        await templatesListCommand(filter);
      }),
  )
  .addCommand(
    new Command("show")
      .description("Show template details")
      .argument("<templateId>", "Template ID to show")
      .action(async (templateId: string) => {
        await templatesShowCommand(templateId);
      }),
  )
  .addCommand(
    new Command("categories").description("List template categories").action(async () => {
      await templatesCategoriesCommand();
    }),
  )
  .addCommand(
    new Command("infer")
      .description("Infer which template best matches a prompt")
      .argument("<prompt>", "Prompt to analyze")
      .action(async (prompt: string) => {
        await templatesInferCommand(prompt);
      }),
  );

program.addCommand(templateCommand);

program
  .command("doctor")
  .description("Check system health and project configuration")
  .option("--providers", "Only check AI provider status")
  .argument("[topic]", "Topic to check: validation", undefined)
  .action((topic: string | undefined, opts: { providers?: boolean }) => {
    if (topic === "validation") {
      return doctorValidationCommand();
    }
    if (opts.providers) {
      return doctorProvidersCommand();
    }
    return doctorCommand();
  });

program
  .command("healthcheck")
  .description("Check runtime health status (node, config, providers, logs)")
  .option("--json", "Output as JSON")
  .option("--log", "Save results to run logs")
  .action(async (opts: { json?: boolean; log?: boolean }) => {
    await healthCheckCommand(opts);
  });

program
  .command("providers")
  .description("Manage AI providers")
  .addCommand(
    new Command("list").description("List configured AI providers").action(listProvidersCommand),
  )
  .addCommand(
    new Command("current").description("Show current AI provider").action(currentProviderCommand),
  )
  .addCommand(
    new Command("test")
      .description("Test current AI provider connection")
      .action(testProviderCommand),
  )
  .addCommand(
    new Command("configure")
      .description("Configure AI provider interactively")
      .action(configureProviderCommand),
  )
  .addCommand(
    new Command("remove")
      .description("Remove an AI provider configuration")
      .argument("[name]", "Provider name to remove")
      .action(removeProviderCommand),
  )
  .addCommand(
    new Command("doctor").description("Check AI provider health").action(doctorProvidersCommand),
  );

program
  .command("rules")
  .description("Manage FlowTask rule sources")
  .argument("[action]", "Action: list | scan | add | validate", "list")
  .argument("[path]", "Path to rule file (for add action)")
  .action(rulesCommand);

program
  .command("steps")
  .description("List steps for a task")
  .argument("<taskId>", "Task ID to list steps for")
  .option("--run <runId>", "Run ID containing the task")
  .option("--status <status>", "Filter by step status")
  .action(stepsCommand);

const stepCommand = new Command("step")
  .description("Manage steps (edit, approve, deny)")
  .addCommand(
    new Command("edit")
      .description("Edit a step's details")
      .argument("<stepId>", "Step ID to edit")
      .option("--run <runId>", "Run ID containing the step")
      .option("--title <title>", "New step title")
      .option("--description <description>", "New step description")
      .option("--command <command>", "New step command")
      .option("--type <type>", "New step type (command, read, write, edit, shell, approval)")
      .action(stepEditCommand),
  )
  .addCommand(
    new Command("approve")
      .description("Approve a step pending approval")
      .argument("<stepId>", "Step ID to approve")
      .option("--run <runId>", "Run ID containing the step")
      .action(stepApproveCommand),
  )
  .addCommand(
    new Command("deny")
      .description("Deny a step pending approval")
      .argument("<stepId>", "Step ID to deny")
      .option("--run <runId>", "Run ID containing the step")
      .action(stepDenyCommand),
  )
  .addCommand(
    new Command("approve-all")
      .description("Approve all steps pending approval in a run")
      .option("--run <runId>", "Run ID containing the steps")
      .action(stepApproveAllCommand),
  );

program.addCommand(stepCommand);

const workflowCommand = new Command("workflow")
  .description("View, edit, reorder, and manage task workflows")
  .addCommand(
    new Command("show")
      .description("Export current workflow as YAML/JSON")
      .argument("[runId]", "Run ID (default: active run)")
      .option("--out <file>", "Save to file instead of stdout")
      .option("--json", "Output as JSON instead of YAML")
      .option("--skip-completed", "Exclude completed/skipped tasks")
      .action(workflowShowCommand),
  )
  .addCommand(
    new Command("list")
      .description("View tasks in the workflow with status and progress")
      .argument("[runId]", "Run ID (default: active run)")
      .option("--status <status>", "Filter by task status (pending, running, done, failed, etc.)")
      .option("--tree", "Show dependency tree view (experimental)")
      .action(workflowListCommand),
  )
  .addCommand(
    new Command("diff")
      .description("Show diff between current workflow and a file")
      .argument("[runId]", "Run ID (default: active run)")
      .argument("[file]", "Workflow file to compare against")
      .option("--summary-only", "Just show counts")
      .action(workflowDiffCommand),
  )
  .addCommand(
    new Command("apply")
      .description("Apply changes from a workflow file")
      .argument("[runId]", "Run ID (default: active run)")
      .argument("[file]", "Workflow file to apply")
      .option("--dry-run", "Show what would change without applying")
      .option("--no-confirm", "Skip confirmation prompt")
      .option("--force", "Allow modifying running/completed tasks")
      .option("--strict", "Fail on any validation warning")
      .action(workflowApplyCommand),
  )
  .addCommand(
    new Command("add")
      .description("Add a new task to the workflow")
      .argument("[runId]", "Run ID (default: active run)")
      .option("--title <title>", "Task title")
      .option("--description <description>", "Task description")
      .option("--executor <name>", "Task executor (shell, opencode, etc.)")
      .option("--after <taskId>", "Place after this task")
      .option("--criteria <criteria>", 'Pipe-separated acceptance criteria (e.g., "AC1|AC2")')
      .option("--max-retries <number>", "Max retries")
      .action(workflowAddCommand),
  )
  .addCommand(
    new Command("remove")
      .description("Remove a task from the workflow")
      .argument("[runId]", "Run ID (default: active run)")
      .argument("[taskId]", "Task ID to remove")
      .option("--delete", "Actually delete instead of skipping")
      .option("--force", "Remove even if other tasks depend on it")
      .action(workflowRemoveCommand),
  )
  .addCommand(
    new Command("reorder")
      .description("Reorder tasks in a workflow")
      .argument("[runId]", "Run ID (default: active run)")
      .argument("[orderedIds...]", "Explicit task ID order")
      .action(workflowReorderCommand),
  )
  .addCommand(
    new Command("edit")
      .description("Open the workflow in your default editor")
      .argument("[runId]", "Run ID (default: active run)")
      .option("--dry-run", "Show what would change without applying")
      .option("--no-confirm", "Skip confirmation prompt")
      .option("--interactive", "Use interactive TUI mode instead of editor")
      .action(workflowEditCommand),
  )
  .addCommand(
    new Command("replan")
      .description("Replan workflow using AI planner")
      .argument("[runId]", "Run ID (default: active run)")
      .option(
        "--strategy <strategy>",
        "Merge strategy: keep-completed | keep-all | replace-all",
        "keep-completed",
      )
      .option("--provider <name>", "AI provider to use")
      .option("--model <name>", "AI model to use")
      .option("--dry-run", "Show what would change without applying")
      .option("--no-confirm", "Skip confirmation prompt")
      .action(workflowReplanCommand),
  );

program.addCommand(workflowCommand);

const configCommand = new Command("config")
  .description("Manage FlowTask configuration")
  .addCommand(
    new Command("get")
      .description("Show current configuration values")
      .argument("[key]", "Config key to show")
      .action(configGetCommand),
  )
  .addCommand(
    new Command("set")
      .description("Set a configuration value")
      .argument("<key>", "Config key to set")
      .argument("<value>", "Value to set")
      .action(configSetCommand),
  )
  .addCommand(
    new Command("list").description("List all configurable settings").action(configListCommand),
  );

program.addCommand(configCommand);

const configureCommand = new Command("configure")
  .description("Configure FlowTask settings interactively")
  .addCommand(
    new Command("ai")
      .description("Configure AI providers interactively")
      .action(configureAiCommand),
  );

program.addCommand(configureCommand);

let rawArgs = process.argv.slice(2);

// Handle --global flag for global installation
const globalFlagIndex = rawArgs.indexOf("--global");
if (globalFlagIndex !== -1) {
  rawArgs.splice(globalFlagIndex, 1);

  const rootPath = process.cwd();

  const isGloballyInstalled = await (async () => {
    try {
      execSync("command -v flowtask", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();

  if (isGloballyInstalled) {
    console.log(picocolors.green("✓ FlowTask is already installed globally"));
    console.log(picocolors.dim("  Run `flowtask --help` to get started"));
    console.log(picocolors.dim("  Run `flowtask doctor` to check your environment setup"));
  } else {
    const { fileExists } = await import("../utils/fs.js");
    const hasPnpm = await (async () => {
      try {
        execSync("command -v pnpm", { stdio: "pipe" });
        return true;
      } catch {
        return false;
      }
    })();
    const hasPnpmLock = await fileExists(path.join(rootPath, "pnpm-lock.yaml"));
    const pm = hasPnpm && hasPnpmLock ? "pnpm" : "npm";

    console.log(picocolors.cyan("\nInstalling FlowTask globally..."));
    console.log(picocolors.dim(`  Package manager: ${pm}`));
    console.log(picocolors.dim(`  Project root: ${rootPath}`));
    console.log("");

    const pmToUse = pm;
    const pnpmCmd = `${pmToUse} add -g .`;
    const npmCmd = "npm install -g .";

    try {
      execSync(pnpmCmd, { cwd: rootPath, stdio: "pipe", timeout: 60000 });
      console.log(globalInstallSuccess(pmToUse));
    } catch (pnpmErr) {
      if (pmToUse === "pnpm") {
        console.log(
          picocolors.yellow(
            `  pnpm install failed, falling back to npm (${pnpmErr instanceof Error ? pnpmErr.message : String(pnpmErr)})`,
          ),
        );
        try {
          execSync(npmCmd, { cwd: rootPath, stdio: "pipe", timeout: 60000 });
          console.log(globalInstallSuccess("npm"));
        } catch (npmErr) {
          console.log(
            globalInstallFailedError(
              `pnpm and npm both failed. Last error: ${npmErr instanceof Error ? npmErr.message : String(npmErr)}`,
            ),
          );
          process.exit(1);
        }
      } else {
        console.log(
          globalInstallFailedError(
            `npm install failed: ${pnpmErr instanceof Error ? pnpmErr.message : String(pnpmErr)}`,
          ),
        );
        process.exit(1);
      }
    }
  }

  if (rawArgs.length === 0) {
    process.exit(0);
  }
}

if (rawArgs.length === 0 && process.stdin.isTTY) {
  program.help();
} else {
  if (rawArgs[0] === "run" && rawArgs.length > 1 && rawArgs[1]?.startsWith("-")) {
    const stdin = await new Promise<string>((resolve) => {
      let data = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk: string) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data.trim()));
    });
    if (stdin) {
      rawArgs = ["run", stdin, ...rawArgs.slice(1)];
    }
  }
  program.parse(rawArgs, { from: "user" });
}
