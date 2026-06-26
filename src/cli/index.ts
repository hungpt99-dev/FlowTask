#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.command.js";
import { runCommand } from "./commands/run.command.js";
import { statusCommand } from "./commands/status.command.js";
import { runsCommand } from "./commands/runs.command.js";
import { tasksCommand } from "./commands/tasks.command.js";
import { logsCommand } from "./commands/logs.command.js";
import { resumeCommand } from "./commands/resume.command.js";
import { retryCommand } from "./commands/retry.command.js";
import { inspectCommand } from "./commands/inspect.command.js";
import { stopCommand } from "./commands/stop.command.js";
import { cancelCommand } from "./commands/cancel.command.js";
import { cleanCommand } from "./commands/clean.command.js";
import { doctorCommand } from "./commands/doctor.command.js";
import { rulesCommand } from "./commands/rules.command.js";

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
  .option("--force", "Force reinitialization")
  .action(initCommand);

program
  .command("run")
  .description("Start a new run from a prompt")
  .argument("<prompt>", "The prompt describing the work to be done")
  .option("--executor <name>", "Executor to use (shell, opencode, claude, codex)", "shell")
  .option("--mode <mode>", "Run mode: auto | manual | plan-only | dry-run | debug", "auto")
  .option("--quality", "Run quality checks after completion")
  .option("--plan-only", "Only generate the plan, do not execute")
  .option("--dry-run", "Show what would happen without executing")
  .option("--debug", "Show detailed debug information")
  .option("--template <name>", "Template to use: feature | bugfix | docs")
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
  .command("logs")
  .description("Show logs for runs and tasks")
  .option("--follow", "Follow logs in real time")
  .option("--run <runId>", "Filter by run ID")
  .option("--task <taskId>", "Filter by task ID")
  .option("--validation", "Show validation logs only")
  .action(logsCommand);

program
  .command("resume")
  .description("Resume an interrupted run")
  .argument("[runId]", "Run ID to resume")
  .action(resumeCommand);

program
  .command("retry")
  .description("Retry a failed task")
  .argument("<taskId>", "Task ID to retry")
  .option("--run <runId>", "Run ID containing the task")
  .option("--force", "Force retry even if task was not failed")
  .action(retryCommand);

program
  .command("inspect")
  .description("Inspect a run's details, logs, and artifacts")
  .argument("<runId>", "Run ID to inspect")
  .action(inspectCommand);

program.command("stop").description("Stop the current running task").action(stopCommand);

program
  .command("cancel")
  .description("Cancel a run")
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
  .action(doctorCommand);

program
  .command("rules")
  .description("Manage FlowTask rule sources")
  .argument("[action]", "Action: list | scan | add | validate", "list")
  .argument("[path]", "Path to rule file (for add action)")
  .action(rulesCommand);

program.parse(process.argv);
