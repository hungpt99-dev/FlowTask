# CLI Command Reference

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** users

## Global Options

--help, --version, --debug

## Project Commands

| Command              | Description                                                            |
| -------------------- | ---------------------------------------------------------------------- |
| `init`               | Initialize a FlowTask project                                          |
| `init --mode <mode>` | Initialize with project mode (development, writing, research, general) |
| `setup`              | Configure AI provider interactively                                    |
| `status`             | Show current project and run status                                    |
| `doctor`             | Check system health and project configuration                          |

## Run Commands

| Command                                  | Description                         |
| ---------------------------------------- | ----------------------------------- |
| `run <prompt>`                           | Start a new run from a prompt       |
| `run --planner simple\|ai\|auto`         | Override planner mode               |
| `run --planner-provider <name>`          | Specify AI provider for planning    |
| `run --planner-model <model>`            | Specify model for planning          |
| `run --executor <name>`                  | Specify executor                    |
| `run --mode auto\|manual`                | Run mode                            |
| `run --plan-only`                        | Generate plan without executing     |
| `run --dry-run`                          | Show what would happen              |
| `run --debug`                            | Show detailed state                 |
| `run --approval-mode auto\|manual\|skip` | Approval mode                       |
| `resume`                                 | Auto-continue from interruption     |
| `resume <runId>`                         | Resume a specific run               |
| `resume <runId> --from <taskId>`         | Continue from a specific task       |
| `resume <runId> --dry-run`               | Show resume plan                    |
| `retry <taskId>`                         | Retry a failed task                 |
| `retry <taskId> --continue`              | Retry then continue remaining tasks |
| `retry <taskId> --force`                 | Bypass maxRetries check             |
| `retry <taskId> --dry-run`               | Show retry plan                     |
| `stop`                                   | Stop the current running task       |
| `cancel <runId>`                         | Cancel a run                        |
| `clean`                                  | Clean up old runs                   |
| `clean --older-than 30d`                 | Clean runs older than N days        |
| `clean --dry-run`                        | Show what would be cleaned          |

## Task Commands

| Command                                                | Description           |
| ------------------------------------------------------ | --------------------- |
| `tasks`                                                | List tasks            |
| `tasks-edit <taskId>`                                  | Edit a task's details |
| `tasks-edit <taskId> --title "New title"`              | Edit title            |
| `tasks-edit <taskId> --description "..."`              | Edit description      |
| `tasks-edit <taskId> --executor opencode`              | Change executor       |
| `tasks-edit <taskId> --acceptance-criteria "AC1\|AC2"` | Update criteria       |
| `tasks-approve <taskId>`                               | Approve a task        |
| `tasks-deny <taskId>`                                  | Deny a task           |

## Workflow Commands

| Command                         | Description                         |
| ------------------------------- | ----------------------------------- |
| `workflow list`                 | View tasks with status and progress |
| `workflow show`                 | Export workflow as YAML             |
| `workflow show --json`          | Export as JSON                      |
| `workflow diff <runId> <file>`  | Show diff between workflow and file |
| `workflow apply <runId> <file>` | Apply changes from file             |
| `workflow add`                  | Add a new task                      |
| `workflow remove <taskId>`      | Remove a task                       |
| `workflow reorder <ids...>`     | Reorder tasks                       |
| `workflow edit`                 | Open in $EDITOR                     |
| `workflow replan`               | Replan with AI                      |

## Step Commands

| Command                                    | Description               |
| ------------------------------------------ | ------------------------- |
| `steps <taskId>`                           | List all steps for a task |
| `steps <taskId> --status pending_approval` | Filter by status          |
| `step edit <stepId> --title "New title"`   | Edit step                 |
| `step edit <stepId> --command "..."`       | Edit command              |
| `step approve <stepId>`                    | Approve a step            |
| `step deny <stepId>`                       | Deny a step               |
| `step approve-all`                         | Approve all pending steps |

## Provider Commands

| Command                   | Description               |
| ------------------------- | ------------------------- |
| `providers list`          | List configured providers |
| `providers current`       | Show current provider     |
| `providers test`          | Test provider connection  |
| `providers configure`     | Interactive configuration |
| `providers remove <name>` | Remove a provider         |
| `providers doctor`        | Check provider health     |

## Config Commands

| Command                    | Description                    |
| -------------------------- | ------------------------------ |
| `config list`              | List all configurable settings |
| `config get`               | Show all config values         |
| `config get <key>`         | Show specific value            |
| `config set <key> <value>` | Set a config value             |

## Rules Commands

| Command            | Description                |
| ------------------ | -------------------------- |
| `rules list`       | List configured rules      |
| `rules scan`       | Scan for common rule files |
| `rules add <path>` | Add rule path to config    |
| `rules validate`   | Validate rule paths        |

## Logs Commands

| Command                         | Description                   |
| ------------------------------- | ----------------------------- |
| `logs`                          | Show logs                     |
| `logs --follow`                 | Stream logs in real time      |
| `logs --follow --tail <N>`      | Show last N lines then follow |
| `logs --follow --task <taskId>` | Follow specific task log      |
| `logs --follow --validation`    | Follow validation logs        |

## Inspect

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `inspect <runId>` | Inspect run details, logs, and artifacts |
