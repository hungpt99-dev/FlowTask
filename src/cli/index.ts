import { Command } from "commander";
import { initCommand } from "./commands/init.command.js";
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

const program = new Command();

program
  .name("flowtask")
  .description(
    "Local-first AI task runtime CLI — turn prompts into visible, validated, resumable AI task flows",
  )
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
  .option("--plan-only", "Only generate the plan, do not execute")
  .option("--dry-run", "Show what would happen without executing")
  .option("--debug", "Show detailed debug information")
  .option("--template <name>", "Template to use: feature | bugfix | docs")
  .option(
    "--approval-mode <mode>",
    "Approval mode: auto (auto-approve) | manual (prompt) | skip (skip all approvals)",
  )
  .action(runCommand);

program.command("status").description("Show current project and run status").action(statusCommand);

program
  .command("runs")
  .description("List all runs in the project")
  .option("--status <status>", "Filter by status")
  .option("--limit <number>", "Limit number of results", "20")
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
  .option(
    "--required-files <files>",
    'Pipe-separated required files (e.g., "src/file1.ts|src/file2.ts")',
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
  .option("--follow", "Follow logs in real time (tail -f style)")
  .option("--run <runId>", "Filter by run ID")
  .option("--task <taskId>", "Filter by task ID")
  .option("--validation", "Show validation logs only")
  .option("--runtime", "Show runtime logs only")
  .option("--tail <number>", "Number of lines to show from the end", "80")
  .action(logsCommand);

program
  .command("resume")
  .description("Resume an interrupted run and continue execution")
  .argument("[runId]", "Run ID to resume")
  .option("--from <taskId>", "Continue from a specific task ID")
  .option("--skip-interrupted", "Skip interrupted tasks instead of retrying them")
  .option("--dry-run", "Show what would resume without executing")
  .action(resumeCommand);

program
  .command("retry")
  .description("Retry a failed task immediately")
  .argument("<taskId>", "Task ID to retry")
  .option("--run <runId>", "Run ID containing the task")
  .option("--continue", "Continue remaining pending tasks after retry")
  .option("--force", "Force retry even if maxRetries reached")
  .option("--dry-run", "Show retry plan without executing")
  .action(retryCommand);

program
  .command("inspect")
  .description("Inspect a run's details, logs, and artifacts")
  .argument("<runId>", "Run ID to inspect")
  .action(inspectCommand);

program
  .command("stop")
  .description("Stop the current running task and its executor process")
  .action(stopCommand);

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

let rawArgs = process.argv.slice(2);

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
