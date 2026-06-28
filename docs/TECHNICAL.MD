# FlowTask

## Full Technical Design Document

Version: 1.0
Product Type: Local-first AI task runtime CLI
Chosen Stack: TypeScript + Node.js
Main Goal: Turn a user prompt into a structured, rule-driven, validated, resumable AI task flow.

---

# 1. Technical Summary

FlowTask is a local-first CLI runtime for AI-assisted work.

It receives a user prompt, reads project rules, creates a run, generates tasks, calls an external AI CLI tool to execute each task, streams logs in real time, validates the result with evidence, stores artifacts, saves state continuously, and supports resume/retry when work is interrupted or fails.

Core flow:

```text
User Prompt
  -> Load Rules
  -> Create Run
  -> Generate Tasks
  -> Build Context Pack
  -> Call AI CLI Executor
  -> Stream Logs
  -> Validate Result
  -> Retry / Continue / Stop
  -> Final Report
```

FlowTask does not directly code in the MVP.

FlowTask is the orchestrator.

AI CLI tools are the executors.

Examples of AI CLI executors:

```text
OpenCode
Claude Code
Codex CLI
Gemini CLI
Aider
Custom command
Shell script
```

---

# 2. Core Technical Principle

The most important principle:

```text
AI CLI does the work.
FlowTask controls and validates the work.
```

FlowTask manages:

```text
project
runs
tasks
rules
state
logs
artifacts
validation
resume
retry
final report
```

AI CLI tools handle:

```text
coding
editing files
writing docs
debugging
analysis
test fixing
implementation
```

---

# 3. Why TypeScript + Node.js

FlowTask should be built first with TypeScript + Node.js.

Reason:

```text
FlowTask is an orchestrator, not a performance-heavy engine.
```

It mainly needs to:

```text
read config files
read markdown rule files
create task files
call external AI CLI tools
stream stdout/stderr
write logs
save JSON state
run validation commands
generate reports
```

TypeScript is the best fit for the MVP because it is:

```text
fast to build
easy to modify
good for CLI tools
good for JSON and Markdown
good for child process orchestration
friendly for AI coding agents
cross-platform enough for macOS, Windows, and Linux
```

Rust can be considered later only if FlowTask needs:

```text
single native binary
lower memory usage
faster startup
stronger native distribution
```

For v1, choose:

```text
TypeScript + Node.js
```

---

# 4. Technical Goals

## 4.1 Local-First

All data should be stored locally inside the project.

Default folder:

```text
.flowtask/
```

No database is required for MVP. However, the implementation uses SQLite via `better-sqlite3` for efficient event storage, run history, and artifact tracking alongside the file-based state. The database is optional and auto-created at `.flowtask/flowtask.db`.

---

## 4.2 Observable

The user must always see what is happening.

FlowTask should show:

```text
current project
current run
current task
current executor
current command
AI CLI output
validation output
retry count
failure reason
```

---

## 4.3 Resumable

If FlowTask, the terminal, or the AI CLI crashes, the user should be able to resume from saved state.

Resume must depend on local files, not memory.

---

## 4.4 Rule-Driven

FlowTask should read project rule files before generating tasks and before executing tasks.

Rules control:

```text
planning
task generation
execution behavior
safety
validation
reporting
```

---

## 4.5 Evidence-Based Validation

FlowTask should never trust only this:

```text
AI says done.
```

A task is done only when evidence proves it.

Evidence includes:

```text
exit code
file exists
artifact exists
tests pass
typecheck passes
lint passes
git diff exists
manual approval
acceptance criteria pass
```

---

## 4.6 Provider-Neutral

FlowTask should not be locked to one AI provider.

It should support external AI CLI tools through executor adapters.

---

# 5. Recommended Tech Stack

## 5.1 Language

```text
TypeScript
```

---

## 5.2 Runtime

```text
Node.js
```

Recommended Node version:

```text
Node.js 22 LTS or newer
```

Node 24 is also fine if the user already uses it.

---

## 5.3 Package Manager

```text
pnpm
```

---

## 5.4 CLI Framework

Recommended:

```text
commander
```

Alternative:

```text
cac
```

Use `commander` for MVP because it is stable, simple, and widely used.

---

## 5.5 Schema Validation

Use:

```text
zod
```

Validate:

```text
config.json
project.json
state.json
run.json
tasks.json
events
rule config
planner output
executor result
validation result
```

---

## 5.6 Logging

Use:

```text
Custom LogManager with SecretRedactor integration
```

Logs are written as human-readable text with timestamps. In-memory lines use a ring buffer — when the limit (`maxInMemoryLines`) is reached, the oldest lines are evicted.

Two log types:

```text
runtime logs for execution tracking
task logs for per-task output
```

---

## 5.7 Testing

Use:

```text
vitest
```

---

## 5.8 Build Tool

Use:

```text
tsup
```

---

## 5.9 Terminal UI

Use:

```text
picocolors
enquirer
```

With custom renderers for rich, plain, and JSON output modes. Terminal UI is kept simple and modular.

---

# 6. High-Level Architecture

```text
CLI
 |
 v
Command Handler
 |
 v
FlowTask Runtime
 |
 +-- Project Manager
 +-- Config Loader
 +-- Database Manager (SQLite)
 +-- Rule Loader
 +-- Run Manager
 +-- Run Lifecycle
 +-- Planner
 +-- Planner Registry
 +-- Context Pack Builder
 +-- Executor Registry
 +-- Log Manager
 +-- Validation Engine
 +-- Validation Runner
 +-- Retry Manager
 +-- State Manager
 +-- Event Store
 +-- Artifact Manager
 +-- Step Manager
 +-- Workflow Manager
 +-- Workflow Replanner
 +-- Safety Checker
 +-- Approval Manager
 +-- Secret Redactor
 +-- Git Service
 +-- Quality Gate
 +-- Checkpoint Service
 +-- Process Manager
 +-- Report Generator
 +-- Use Case Detector
 +-- AI Provider Service
 +-- Provider Registry
```

---

# 7. Core Domain Model

## 7.1 Project

A project is a long-lived workspace.

Usually one project equals one repository.

Example:

```json
{
  "projectId": "guest-scan",
  "name": "Guest Scan",
  "rootPath": "/Users/harry/projects/guest-scan",
  "createdAt": "2026-06-26T10:00:00.000Z",
  "updatedAt": "2026-06-26T10:00:00.000Z"
}
```

---

## 7.2 Run

A run is one execution created from one user prompt.

Example:

```json
{
  "runId": "run_20260626_103000_implement_ocr_module",
  "projectId": "guest-scan",
  "title": "Implement OCR module",
  "status": "running",
  "mode": "auto",
  "promptPath": "prompt.md",
  "planPath": "plan.md",
  "taskCount": 8,
  "completedTaskCount": 3,
  "createdAt": "2026-06-26T10:30:00.000Z",
  "updatedAt": "2026-06-26T10:45:00.000Z"
}
```

---

## 7.3 Task

A task is one meaningful unit of work inside a run.

Example:

```json
{
  "id": "task_005",
  "runId": "run_20260626_103000_implement_ocr_module",
  "title": "Implement OCR service",
  "description": "Create OCR service, types, parser, and validation logic.",
  "status": "running",
  "executor": "opencode",
  "dependsOn": ["task_001", "task_002", "task_003", "task_004"],
  "acceptanceCriteria": [
    "OCR service file exists",
    "OCR result type exists",
    "Unit tests exist",
    "Typecheck passes",
    "Tests pass"
  ],
  "validation": {
    "commands": ["pnpm typecheck", "pnpm test"],
    "requiredFiles": ["src/ocr/ocr.service.ts", "src/ocr/ocr.types.ts", "src/ocr/ocr.test.ts"],
    "requireGitDiff": true
  },
  "retryCount": 0,
  "maxRetries": 2,
  "createdAt": "2026-06-26T10:35:00.000Z",
  "updatedAt": "2026-06-26T10:45:00.000Z"
}
```

---

## 7.4 Step

A step is a concrete action inside a task.

Example:

```json
{
  "id": "step_001",
  "taskId": "task_005",
  "type": "command",
  "command": "pnpm test",
  "status": "done",
  "exitCode": 0,
  "startedAt": "2026-06-26T10:40:00.000Z",
  "finishedAt": "2026-06-26T10:40:12.000Z"
}
```

---

## 7.5 Artifact

An artifact is a useful output generated by a run or task.

Example:

```json
{
  "artifactId": "artifact_001",
  "runId": "run_20260626_103000_implement_ocr_module",
  "taskId": "task_004",
  "type": "markdown",
  "title": "OCR Design",
  "path": "artifacts/task_004/ocr-design.md",
  "createdAt": "2026-06-26T10:39:00.000Z"
}
```

---

## 7.6 Rule Source

A rule source is a configured file or glob path that FlowTask reads before planning and execution.

Example:

```json
{
  "id": "rule_source_001",
  "path": "docs/AI_AGENT_RULES.md",
  "type": "markdown",
  "required": false
}
```

---

## 7.7 Event

An event is an append-only record of what happened. Events are stored in JSONL files (primary durable store), with SQLite as a query-optimized secondary store via the DatabaseManager. The `queryEvents` method queries SQLite; all writes go to both stores but JSONL is the source of truth.

Example:

```json
{
  "time": "2026-06-26T10:30:00.000Z",
  "type": "task_started",
  "runId": "run_20260626_103000_implement_ocr_module",
  "taskId": "task_005",
  "message": "Task started: Implement OCR service"
}
```

---

## 7.8 Checkpoint

A checkpoint captures task execution state at specific points for precise resume:

```json
{
  "checkpointId": "chk_001",
  "runId": "run_20260626_103000_implement_ocr_module",
  "taskId": "task_005",
  "stepId": "step_003",
  "status": "completed",
  "context": { "completedSteps": ["step_001", "step_002"] },
  "createdAt": "2026-06-26T10:40:00.000Z"
}
```

---

## 7.9 Task Result

A task result record stores the output and artifacts of completed tasks:

```json
{
  "id": "tr_001",
  "taskId": "task_005",
  "runId": "run_...",
  "status": "done",
  "exitCode": 0,
  "outputPath": ".flowtask/runs/.../outputs/task_005/output.txt",
  "validationStatus": "passed",
  "createdAt": "2026-06-26T10:45:00.000Z"
}
```

# 8. Local Directory Structure

FlowTask creates a `.flowtask` folder inside the project. State is stored in both JSON files (for fast file reads) and SQLite (`flowtask.db`, for efficient querying). API keys are stored in `~/.flowtask/secrets.json`.

```text
.flowtask/
  project.json
  config.json
  state.json
  run-index.json
  task-index.json
  events.jsonl         # Global event log
  flowtask.db          # SQLite database (events, task results, artifacts, checkpoints)

  steps/               # Per-run step definitions
    steps.run_20260626_103000.json

  rules/
    project.md
    workflow.md
    coding.md
    testing.md
    security.md
    output.md

  runs/
    run_20260626_103000_implement_ocr_module/
      run.json
      prompt.md
      rules-context.md
      plan.md
      tasks.json
      state.json
      events.jsonl
      final-report.md

      context/
        context-pack.task_001.md
        context-pack.task_002.md
        context-pack.task_005.retry_1.md

      logs/
        runtime.log
        task_001.log
        task_002.log
        task_003.log
        validation.log

      artifacts/
        task_001/
          requirement-summary.md

        task_002/
          project-analysis.md

        task_004/
          ocr-design.md

      outputs/
        changed-files.json
        command-results.json
        validation-results.json
        test-results.json
        git-before.txt
        git-after.txt
        git-diff-stat.txt

      snapshots/
        before.json
        after.json
```

---

# 9. File Responsibilities

## 9.1 project.json

Stores project metadata.

```json
{
  "projectId": "guest-scan",
  "name": "Guest Scan",
  "rootPath": "/Users/harry/projects/guest-scan",
  "createdAt": "2026-06-26T10:00:00.000Z",
  "updatedAt": "2026-06-26T10:00:00.000Z"
}
```

---

## 9.2 config.json

Stores FlowTask configuration. The `logging.maxInMemoryLines` uses a ring buffer — when the in-memory line limit is reached, the oldest lines are evicted.

```json
{
  "version": "1.0",
  "projectMode": "development",
  "defaultExecutor": "opencode",
  "runsDir": ".flowtask/runs",
  "logLevel": "info",
  "autoResume": true,

  "rules": {
    "enabled": true,
    "paths": [
      ".flowtask/rules/*.md",
      "AGENTS.md",
      "CLAUDE.md",
      "docs/AI_AGENT_RULES.md",
      "docs/CODE_QUALITY.md",
      "docs/DEVELOPMENT.md",
      ".cursor/rules/*.mdc",
      ".github/copilot-instructions.md"
    ],
    "required": false,
    "maxFileSizeKb": 256
  },

  "approval": {
    "enabled": true,
    "autoApprove": false,
    "requireFor": [
      "delete_file",
      "install_dependency",
      "git_push",
      "deploy",
      "database_migration",
      "read_sensitive_file"
    ]
  },

  "useCase": {
    "enabled": true,
    "customPatterns": [],
    "confidenceThreshold": 0.3
  },

  "quality": {
    "enabledByDefault": false,
    "commands": ["pnpm lint", "pnpm typecheck", "pnpm test"]
  },

  "validation": {
    "profile": "safe",
    "concurrency": 1,
    "timeoutMs": 300000,
    "killGraceMs": 5000,
    "dedupeCommands": true,
    "resourceGuard": true,
    "commands": [],
    "vitest": {
      "enabled": true,
      "maxWorkers": 1,
      "runMode": true
    }
  },

  "limits": {
    "maxRunMinutes": 120,
    "maxTaskMinutes": 30,
    "maxRetries": 2,
    "maxLogSizeMb": 20
  },

  "hooks": {
    "beforeRun": [],
    "afterRun": [],
    "beforeTask": [],
    "afterTask": [],
    "beforeRetry": [],
    "afterRetry": [],
    "onFailure": [],
    "failOnError": false
  },

  "logging": {
    "maxInMemoryLines": 500,
    "maxLineLength": 4000
  },

  "process": {
    "gracefulStopTimeoutMs": 5000,
    "forceKillTimeoutMs": 10000
  },

  "planner": {
    "default": "auto",
    "type": "internal-ai",
    "executor": "opencode",
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "maxRetries": 1,
    "fallbackToSimple": true
  },

  "ai": {
    "providers": {}
  },

  "executors": {
    "shell": {
      "type": "shell",
      "args": [],
      "inputMode": "argument",
      "timeoutMs": 1800000
    },
    "opencode": {
      "type": "command",
      "command": "opencode",
      "args": ["run"],
      "inputMode": "stdin",
      "timeoutMs": 1800000
    },
    "claude": {
      "type": "command",
      "command": "claude",
      "inputMode": "stdin",
      "timeoutMs": 1800000
    },
    "codex": {
      "type": "command",
      "command": "codex",
      "inputMode": "stdin",
      "timeoutMs": 1800000
    },
    "gemini": {
      "type": "command",
      "command": "gemini",
      "inputMode": "stdin",
      "timeoutMs": 1800000
    },
    "aider": {
      "type": "command",
      "command": "aider",
      "args": ["--message"],
      "inputMode": "argument",
      "timeoutMs": 1800000
    },
    "mock-ai": {
      "type": "command",
      "command": "node",
      "args": ["tests/fixtures/mock-ai-executor.mjs"],
      "inputMode": "stdin",
      "timeoutMs": 30000
    }
  }
}
```

---

## 9.3 state.json

Stores project-level state.

```json
{
  "projectId": "guest-scan",
  "status": "has_running_run",
  "activeRunId": "run_20260626_103000_implement_ocr_module",
  "lastRunId": "run_20260626_103000_implement_ocr_module",
  "updatedAt": "2026-06-26T10:45:00.000Z"
}
```

---

## 9.4 run-index.json

Stores all runs in the project.

```json
{
  "projectId": "guest-scan",
  "runs": [
    {
      "runId": "run_20260626_103000_implement_ocr_module",
      "title": "Implement OCR module",
      "status": "running",
      "createdAt": "2026-06-26T10:30:00.000Z",
      "updatedAt": "2026-06-26T10:45:00.000Z"
    }
  ]
}
```

---

## 9.5 task-index.json

Stores task references across all runs.

```json
{
  "projectId": "guest-scan",
  "tasks": [
    {
      "taskId": "task_001",
      "runId": "run_20260626_103000_implement_ocr_module",
      "title": "Understand request",
      "status": "done"
    },
    {
      "taskId": "task_002",
      "runId": "run_20260626_103000_implement_ocr_module",
      "title": "Inspect project structure",
      "status": "running"
    }
  ]
}
```

---

## 9.6 prompt.md

Stores the original user prompt.

```md
# Original Prompt

Implement OCR module for passport scanner.

Requirements:

- Extract full name
- Extract passport number
- Extract date of birth
- Extract expiry date
- Extract nationality
- Return confidence score
```

---

## 9.7 rules-context.md

Stores merged rules used for this run.

This is important because rules may change later.

The run should keep the exact rule context that was used.

```md
# Rules Context

## Source: .flowtask/rules/workflow.md

...

## Source: docs/AI_AGENT_RULES.md

...

## Source: .github/copilot-instructions.md

...
```

---

## 9.8 plan.md

Stores the human-readable execution plan.

```md
# Plan

1. Read project rules
2. Understand request
3. Inspect project structure
4. Design OCR pipeline
5. Implement OCR service
6. Add tests
7. Run quality checks
8. Generate final report
```

---

## 9.9 tasks.json

Stores machine-readable tasks for one run.

```json
{
  "runId": "run_20260626_103000_implement_ocr_module",
  "tasks": [
    {
      "id": "task_001",
      "title": "Understand request",
      "description": "Summarize the user request and acceptance criteria.",
      "status": "pending",
      "executor": "opencode",
      "dependsOn": [],
      "acceptanceCriteria": [
        "Requirement summary artifact exists",
        "Acceptance criteria are listed"
      ],
      "validation": {
        "requiredArtifacts": ["artifacts/task_001/requirement-summary.md"]
      },
      "retryCount": 0,
      "maxRetries": 2
    }
  ]
}
```

---

## 9.10 run state.json

Stores current run state.

```json
{
  "runId": "run_20260626_103000_implement_ocr_module",
  "status": "running",
  "currentTaskId": "task_005",
  "progress": {
    "total": 8,
    "done": 4,
    "running": 1,
    "failed": 0,
    "pending": 3
  },
  "startedAt": "2026-06-26T10:30:00.000Z",
  "updatedAt": "2026-06-26T10:45:00.000Z"
}
```

---

## 9.11 events.jsonl

Stores append-only events.

```jsonl
{"time":"2026-06-26T10:30:00.000Z","type":"run_started","runId":"run_20260626_103000_implement_ocr_module"}
{"time":"2026-06-26T10:31:00.000Z","type":"rules_loaded","runId":"run_20260626_103000_implement_ocr_module","count":4}
{"time":"2026-06-26T10:32:00.000Z","type":"task_started","runId":"run_20260626_103000_implement_ocr_module","taskId":"task_001"}
{"time":"2026-06-26T10:33:00.000Z","type":"task_completed","runId":"run_20260626_103000_implement_ocr_module","taskId":"task_001"}
```

---

# 10. Status Model

## 10.1 Project Status

```text
idle
has_running_run
has_failed_run
has_interrupted_run
```

---

## 10.2 Run Status

```text
created
planning
running
paused
completed
failed
cancelled
interrupted
```

---

## 10.3 Task Status

```text
pending
running
done
failed
skipped
blocked
cancelled
waiting_approval
interrupted
```

---

## 10.4 Step Status

```text
pending
running
done
failed
cancelled
interrupted
```

---

## 10.5 Validation Status

```text
pending
running
passed
failed
warning
skipped
```

---

# 11. CLI Commands

## 11.1 init

```bash
flowtask init
```

Options:

```bash
flowtask init --name "Guest Scan"
flowtask init --mode development
flowtask init --mode writing
flowtask init --mode research
flowtask init --mode general
flowtask init --force
```

Responsibilities:

```text
create .flowtask folder
create project.json
create config.json
create state.json
create run-index.json
create task-index.json
create default rules folder
```

---

## 11.2 run

```bash
flowtask run "Implement OCR module"
```

Options:

```bash
flowtask run "Implement OCR module" --executor opencode
flowtask run "Implement OCR module" --quality
flowtask run "Implement OCR module" --mode auto
flowtask run "Implement OCR module" --mode manual
flowtask run "Implement OCR module" --plan-only
flowtask run "Implement OCR module" --dry-run
flowtask run "Implement OCR module" --debug
flowtask run "Implement OCR module" --planner auto
flowtask run "Implement OCR module" --planner ai
flowtask run "Implement OCR module" --planner simple
flowtask run "Implement OCR module" --planner-provider openai
flowtask run "Implement OCR module" --planner-model gpt-4.1-mini
flowtask run "Implement OCR module" --approval-mode auto
flowtask run "Implement OCR module" --approval-mode manual
flowtask run "Implement OCR module" --approval-mode skip
flowtask run "Implement OCR module" --template feature
```

Responsibilities:

```text
validate project
load config
load rules
create run folder
save prompt.md
save rules-context.md
generate plan
generate tasks
save tasks.json
update indexes
execute tasks if not plan-only
stream logs
validate results
retry if needed
generate final report
```

---

## 11.3 status

```bash
flowtask status
```

Shows current project and run status.

Example:

```text
Project: guest-scan
Status: has_running_run

Active Run:
run_20260626_103000_implement_ocr_module

Progress:
4 / 8 tasks completed

Current Task:
task_005 Implement OCR service
```

---

## 11.4 runs

```bash
flowtask runs
```

Options:

```bash
flowtask runs --status failed
flowtask runs --limit 20
```

---

## 11.5 tasks

```bash
flowtask tasks
```

Options:

```bash
flowtask tasks --run <runId>
flowtask tasks --all
flowtask tasks --status failed
```

---

## 11.6 logs

```bash
flowtask logs
flowtask logs --follow
flowtask logs --run <runId>
flowtask logs --task <taskId>
flowtask logs --validation
```

---

## 11.7 resume

```bash
flowtask resume                    # Auto-continue from interruption
flowtask resume <runId>            # Resume a specific run
flowtask resume <runId> --from task_004  # Continue from a specific task
flowtask resume <runId> --dry-run  # Show resume plan without executing
```

Responsibilities:

```text
read project state
read run state
read tasks
detect incomplete task
mark stale running task as interrupted
continue execution
```

---

## 11.8 retry

```bash
flowtask retry task_005
```

Options:

```bash
flowtask retry task_005 --run <runId>
flowtask retry task_005 --continue  # Retry then continue remaining tasks
flowtask retry task_005 --force     # Bypass maxRetries check
flowtask retry task_005 --dry-run   # Show retry plan without executing
```

---

## 11.9 inspect

```bash
flowtask inspect <runId>
```

Shows:

```text
prompt
rules
plan
tasks
logs
artifacts
changed files
validation results
final report
```

---

## 11.10 stop

```bash
flowtask stop
```

Responsibilities:

```text
send termination signal
mark active task interrupted
mark run paused or interrupted
save state
write event
```

---

## 11.11 cancel

```bash
flowtask cancel <runId>
```

Cancels a run.

---

## 11.12 doctor

```bash
flowtask doctor
```

Checks:

```text
Node.js version
pnpm installed
git available
project initialized
config valid
rule paths valid
default executor available
quality commands available
```

---

## 11.13 clean

```bash
flowtask clean
```

Options:

```bash
flowtask clean --older-than 30d
flowtask clean --status completed
flowtask clean --dry-run
```

---

## 11.14 rules

```bash
flowtask rules list
flowtask rules scan
flowtask rules add AGENTS.md
flowtask rules validate
```

Responsibilities:

```text
list configured rules
scan common rule files
add rule path to config
validate rule paths
show missing required rules
```

---

## 11.15 tasks-edit

```bash
flowtask tasks-edit task_005
```

Options:

```bash
flowtask tasks-edit task_005 --title "New title"
flowtask tasks-edit task_005 --description "Updated description"
flowtask tasks-edit task_005 --executor opencode
flowtask tasks-edit task_005 --acceptance-criteria "AC1|AC2|AC3"
flowtask tasks-edit task_005 --validation-commands "pnpm test|pnpm lint"
flowtask tasks-edit task_005 --required-files "src/file.ts|src/types.ts"
```

---

## 11.16 tasks-approve / tasks-deny

```bash
flowtask tasks-approve task_005
flowtask tasks-deny task_005
```

Approve or deny a task in `waiting_approval` status. Used when a run is in `manual` mode and a task requires user confirmation.

---

## 11.17 providers

```bash
flowtask providers list              # List configured AI providers
flowtask providers current           # Show current AI provider
flowtask providers test              # Test provider connection
flowtask providers configure         # Interactive configuration wizard
flowtask providers remove <name>     # Remove a provider
flowtask providers doctor            # Check provider health
```

---

## 11.18 workflow

Workflow commands for viewing, editing, and managing task plans:

```bash
flowtask workflow list                           # View tasks with status and progress
flowtask workflow show [runId]                   # Export workflow as YAML/JSON
flowtask workflow show [runId] --json            # Export as JSON
flowtask workflow show [runId] --skip-completed  # Exclude completed tasks
flowtask workflow diff [runId] [file]            # Show diff between current and file
flowtask workflow apply [runId] <file>           # Apply changes from file
flowtask workflow add [runId]                    # Add a new task
flowtask workflow remove [runId] <taskId>         # Remove a task
flowtask workflow reorder [runId] [ids...]       # Reorder tasks
flowtask workflow edit [runId]                   # Open in $EDITOR
flowtask workflow edit [runId] --interactive     # Interactive TUI mode
flowtask workflow replan [runId]                 # Replan with AI
```

---

## 11.19 step / steps

Step-level management for granular control within tasks:

```bash
flowtask steps <taskId>                          # List all steps for a task
flowtask steps <taskId> --status pending_approval
flowtask step edit <stepId> --title "New title"  # Edit step properties
flowtask step edit <stepId> --command "pnpm add dep"
flowtask step approve <stepId>                   # Approve a step
flowtask step deny <stepId>                      # Deny a step
flowtask step approve-all                        # Approve all pending steps
```

Steps support types: `command`, `read`, `write`, `edit`, `shell`, `approval`.
Stored in `.flowtask/runs/<runId>/steps.json`.

---

## 11.20 config

```bash
flowtask config list              # List all configurable settings
flowtask config get               # Show current configuration values
flowtask config get <key>         # Show a specific value (e.g., "approval.enabled")
flowtask config set <key> <value> # Set a configuration value
```

---

## 11.21 setup

```bash
flowtask setup                    # Interactive AI provider setup
flowtask setup --provider openai  # Configure a specific provider
flowtask setup --model gpt-4.1-mini
flowtask setup --base-url https://api.openai.com/v1
```

Sets up AI provider configuration and stores API keys in `~/.flowtask/secrets.json`.

---

# 12. Run Modes

## 12.1 Auto Mode

```bash
flowtask run "Implement OCR" --mode auto
```

Behavior:

```text
generate tasks
execute tasks automatically
only stop for risky approval, failure, timeout, or validation issue
```

---

## 12.2 Manual Mode

```bash
flowtask run "Implement OCR" --mode manual
```

Behavior:

```text
ask user before executing each task
good for high-control workflows
```

---

## 12.3 Plan-Only Mode

```bash
flowtask run "Implement OCR" --plan-only
```

Behavior:

```text
generate plan and tasks
do not execute
allow user to review before running
```

---

## 12.4 Dry-Run Mode

```bash
flowtask run "Implement OCR" --dry-run
```

Behavior:

```text
show what would happen
do not create real run execution output
do not call AI CLI
```

---

## 12.5 Debug Mode

```bash
flowtask run "Implement OCR" --debug
```

Behavior:

```text
show config path
show loaded rules
show resolved executor
show task transition
show state updates
show command execution details
show validation details
```

---

# 13. Execution Lifecycle

## 13.1 New Run Lifecycle

```text
1. User runs flowtask run "<prompt>"
2. Validate current project
3. Load config
4. Load configured rules
5. Create run ID
6. Create run folder
7. Save prompt.md
8. Save rules-context.md
9. Set run status: created
10. Generate plan
11. Set run status: planning
12. Generate tasks with acceptance criteria
13. Save tasks.json
14. Set run status: running
15. Execute tasks one by one
16. Validate each task
17. Retry failed validation if allowed
18. Save state after every important action
19. Run final quality gate
20. Generate final report
21. Set run status: completed or failed
```

---

## 13.2 Task Lifecycle

```text
1. Pick next pending task
2. Check dependencies
3. Build context pack
4. Check safety
5. Ask approval if needed
6. Set task status: running
7. Create task log file
8. Call executor
9. Stream stdout/stderr
10. Save artifacts
11. Run task validation
12. If validation passes, mark task done
13. If validation fails, retry or fail
14. Update run progress
15. Write event
```

---

## 13.3 Resume Lifecycle

```text
1. Read project state
2. Find active or selected run
3. Read run state
4. Read task list
5. Detect last task
6. If task was running, mark interrupted
7. Build retry/resume context
8. Continue from interrupted or next pending task
9. Save state
10. Continue execution
```

---

## 13.4 Lifecycle Hooks

User-defined shell commands that execute at specific lifecycle points. Configured in `.flowtask/config.json` under `hooks`.

### Hook Points

| Hook          | Trigger              | Context Variables                                                                     |
| ------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `beforeRun`   | After run creation   | `HOOK_RUN_ID`, `HOOK_ROOT_PATH`                                                       |
| `afterRun`    | After run completion | `HOOK_RUN_ID`, `HOOK_SUCCESS`                                                         |
| `beforeTask`  | Before each task     | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_TASK_TITLE`                                      |
| `afterTask`   | After each task      | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_TASK_TITLE`, `HOOK_SUCCESS`                      |
| `beforeRetry` | Before each retry    | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_RETRY_COUNT`, `HOOK_MAX_RETRIES`                 |
| `afterRetry`  | After each retry     | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_RETRY_COUNT`, `HOOK_MAX_RETRIES`, `HOOK_SUCCESS` |
| `onFailure`   | Run or task failure  | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_TASK_TITLE`, `HOOK_ERROR`                        |

### Implementation

The `HookManager` class (`src/core/hook-manager.ts`) executes configured commands using `child_process.spawn` with the shell from `getShell()`. Each command receives context via environment variables. Hook execution results (exit code, stdout, stderr) are logged but do not halt execution unless `failOnError: true` is set.

### Configuration

```json
{
  "hooks": {
    "beforeRun": ["echo 'Run started'"],
    "afterRun": ["notify-send 'Run completed'"],
    "failOnError": false
  }
}
```

### Integration

Hooks are integrated into `RunLifecycle` at the following points:

1. `executeRun` — calls `hookManager.runBeforeRun()` after run creation, `hookManager.runAfterRun()` at completion, `hookManager.runOnFailure()` on failure
2. `executeTasks` — calls `hookManager.runBeforeTask()` before each task, `hookManager.runAfterTask()` and `hookManager.runOnFailure()` after each task
3. `executeTask` — calls `hookManager.runBeforeRetry()` before each retry, `hookManager.runAfterRetry()` after each retry attempt

---

## 13.5 Interactive Retry Approval

When a task exhausts its configured `maxRetries`, FlowTask can prompt the user for approval before additional retries:

- **TTY mode** (default): Shows a confirm prompt via `enquirer` asking the user to approve further retries
- **Non-TTY / CI**: Automatically skips the retry (approval is not possible without a terminal)
- **Auto-approve mode**: Automatically skips additional retries
- **Skip mode**: Automatically approves additional retries (treated as final failure)

If the user approves, the retry counter is reset and the task is re-executed from scratch. If denied, the task is marked as failed.

---

## 13.6 Interactive Task Approval

In `manual` mode, when the terminal is interactive (`process.stdin.isTTY`), FlowTask prompts the user inline via `enquirer` confirm prompts instead of pausing the run and exiting. The user can approve or skip each task without leaving the process.

When the terminal is not interactive (e.g., CI pipelines, pipes), the original behavior applies — the run pauses and waits for external approval via `flowtask tasks-approve <taskId>`.

---

# 14. Rule System Design

## 14.1 Rule Source Configuration

FlowTask should support both:

```text
.flowtask/rules/*.md
```

and existing project rule files:

```text
AGENTS.md
CLAUDE.md
docs/AI_AGENT_RULES.md
docs/CODE_QUALITY.md
.cursor/rules/*.mdc
.github/copilot-instructions.md
```

Example config:

```json
{
  "rules": {
    "enabled": true,
    "paths": [
      ".flowtask/rules/*.md",
      "AGENTS.md",
      "CLAUDE.md",
      "docs/AI_AGENT_RULES.md",
      "docs/CODE_QUALITY.md",
      ".cursor/rules/*.mdc",
      ".github/copilot-instructions.md"
    ],
    "required": false,
    "maxFileSizeKb": 256
  }
}
```

---

## 14.2 Rule Loading Flow

```text
1. Read config.json
2. Resolve rule paths relative to project root
3. Expand glob patterns
4. Ignore missing non-required files
5. Fail if required file is missing
6. Skip files larger than maxFileSizeKb
7. Read file content
8. Merge rules into rules-context.md
9. Pass rules to planner
10. Pass relevant rules to executor context pack
```

---

## 14.3 Rule Priority

Priority order:

```text
1. Built-in FlowTask safety rules
2. .flowtask/rules/*
3. Configured external rule files
4. Run prompt instructions
5. Task-specific instructions
```

Important:

```text
User rules cannot override built-in safety rules.
```

---

## 14.4 Rule Loader Interface

```ts
export interface RuleSource {
  path: string;
  required?: boolean;
  type?: "markdown" | "mdc" | "text";
}

export interface LoadedRule {
  sourcePath: string;
  content: string;
  sizeBytes: number;
}

export interface RuleLoader {
  loadRules(projectRoot: string, config: FlowTaskConfig): Promise<LoadedRule[]>;
  mergeRules(rules: LoadedRule[]): string;
}
```

---

# 15. Planner Design

## 15.1 Planner Responsibility

Planner converts:

```text
prompt + rules + project context
```

into:

```text
plan.md + tasks.json
```

Each task should include:

```text
title
description
executor
dependencies
acceptance criteria
validation config
risk level
max retries
```

---

## 15.2 Planner Interface

```ts
export interface Planner {
  createPlan(input: PlannerInput): Promise<PlannerResult>;
}

export interface PlannerInput {
  projectRoot: string;
  prompt: string;
  rulesContext: string;
  template?: string;
}

export interface PlannerResult {
  title: string;
  planMarkdown: string;
  tasks: TaskDefinition[];
}
```

---

## 15.3 Simple Planner

MVP can start with a simple default planner.

Default task template:

```text
1. Read project rules
2. Understand request
3. Inspect project
4. Create implementation plan
5. Execute implementation
6. Run validation
7. Generate final report
```

This gives predictable behavior.

---

## 15.4 AI Planner (Internal)

FlowTask uses an internal AI/API provider for planning, not an external AI CLI.

This is a key architectural decision:

```text
Planner = internal AI API (8 provider types: OpenAI, Anthropic, Gemini, Mistral, Azure OpenAI, Ollama, OpenAI-Compatible, Custom)
Executor = external AI CLI (opencode, claude, codex, aider, gemini CLI, shell)
```

### Why Internal AI for Planning?

AI CLI output (opencode, claude, codex, aider) includes:

```text
model banners
tool logs
file read logs
markdown fences
normal prose before/after JSON
partial JSON
implementation text
```

This makes JSON extraction unreliable. The internal AI API uses `response_format: { type: "json_object" }` to return clean structured JSON. If a provider does not support JSON mode, the ResponseFormatFallback mechanism retries without it.

### Supported Provider Types

| Provider          | Type                 | Endpoint            |
| ----------------- | -------------------- | ------------------- |
| OpenAI            | `openai`             | `/chat/completions` |
| OpenAI-Compatible | `openai-compatible`  | `/chat/completions` |
| Anthropic         | `anthropic`          | `/v1/messages`      |
| Gemini            | `gemini`             | `generateContent`   |
| Mistral           | `mistral`            | `/chat/completions` |
| Azure OpenAI      | `azure-openai`       | deployment-based    |
| Ollama            | `ollama`             | `/api/chat`         |
| Custom            | via registration API | configurable        |

### Provider Features

- `response_format` fallback (retries without JSON mode if unsupported)
- SSE/NDJSON streaming support
- Provider health checks (`providers doctor`)
- Custom provider registration API

### Internal AI Planner Architecture

```text
src/ai/
  ai-provider.ts             # AiProvider interface
  ai-provider-error.ts       # Typed error classes
  ai.schema.ts               # AI config schema
  api-key-validator.ts       # API key validation
  index.ts                   # Barrel exports
  openai-provider.ts         # OpenAI-compatible provider using fetch
  provider-definitions.ts    # Provider type definitions
  provider-presets.ts        # Built-in provider presets
  provider-registry.ts       # Provider instance management
  provider-service.ts        # Provider service layer
  response-format-fallback.ts # JSON mode fallback
  providers/
    anthropic-provider.ts
    azure-openai-provider.ts
    gemini-provider.ts
    index.ts
    mistral-provider.ts
    ollama-provider.ts
    openai-compatible-provider.ts

src/planner/
  internal-ai-planner.ts  # Internal AI planner implementation
  simple-planner.ts       # Fixed 7-task template
  planner.ts              # Planner interface
  planner-registry.ts     # Planner mode resolution
  ai-planner.ts           # External AI planner (for AI CLI planning)
  process-planner-output.ts # JSON extraction + validation
  templates/              # Prompt templates (empty: generated at runtime)
```

### Config

```json
{
  "planner": {
    "mode": "auto",
    "type": "internal-ai",
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "maxRetries": 1
  },
  "ai": {
    "providers": {
      "openai": {
        "type": "openai",
        "apiKeyEnv": "OPENAI_API_KEY",
        "baseUrl": "https://api.openai.com/v1"
      }
    }
  }
}
```

### Planner Output Validation

Output is validated with Zod (`AiPlannerOutputSchema`), including:

- Risk level normalization (`low` → `safe`, `medium` → `risky`, `high` → `dangerous`)
- Artifact path validation (must be relative file paths with extensions)
- Shell task validation (must have non-empty commands if executor=shell)
- Executor validation (must exist in config or built-in presets)
- Dependency normalization (title references → task IDs)

If validation fails, retry once with repair prompt, then fallback or fail by mode.

---

# 16. Context Pack Design

## 16.1 Purpose

FlowTask should not send only a short task title to the AI CLI.

Bad prompt:

```text
Implement OCR service.
```

Good prompt includes:

```text
original user prompt
current task
rules
project context
previous task results
acceptance criteria
validation commands
retry error if any
output expectation
```

---

## 16.2 Context Pack Content

Each AI CLI call should receive a context pack.

Context pack includes:

```text
Original prompt
Rules context
Current task
Previous completed tasks
Relevant artifacts
Acceptance criteria
Validation commands
Safety instructions
Retry error logs if retrying
Expected output
```

---

## 16.3 Context Pack Example

```md
# FlowTask Context Pack

## Original User Prompt

Implement OCR module for passport scanner.

## Current Task

Implement OCR service.

## Project Rules

- Follow existing project structure.
- Use TypeScript strict mode.
- Do not add dependencies without approval.
- Add tests for new features.

## Previous Completed Tasks

- Requirement summary created.
- Project structure analyzed.
- OCR design created.

## Acceptance Criteria

- OCR service file exists.
- OCR result type exists.
- Unit tests exist.
- Typecheck passes.
- Tests pass.

## Validation Commands

pnpm typecheck
pnpm test

## Instructions

- Work only on this task.
- Do not rewrite unrelated files.
- Do not mark the task complete unless acceptance criteria are satisfied.
- Return a short completion summary.
```

---

## 16.4 Context Pack Storage

Store context packs in:

```text
.flowtask/runs/<runId>/context/
```

Examples:

```text
context-pack.task_005.md
context-pack.task_005.retry_1.md
```

---

# 17. Executor Design

## 17.1 Executor Interface

```ts
export interface Executor {
  name: string;
  execute(input: ExecutorInput): Promise<ExecutorResult>;
}

export interface ExecutorInput {
  projectRoot: string;
  runId: string;
  task: Task;
  contextPackPath: string;
  contextPackContent: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ExecutorResult {
  status: "done" | "failed" | "cancelled" | "timeout";
  exitCode?: number;
  output?: string;
  error?: string;
  artifacts?: Artifact[];
  startedAt: string;
  finishedAt: string;
}
```

---

## 17.2 Shell Executor

Runs direct shell commands.

Use cases:

```text
git status
pnpm test
pnpm lint
cargo check
```

---

## 17.3 Command Executor

Runs configured external command.

Example config:

```json
{
  "opencode": {
    "type": "command",
    "command": "opencode run"
  }
}
```

Execution example:

```bash
opencode run "<context pack content>"
```

Alternative:

```bash
opencode run --file .flowtask/runs/<runId>/context/context-pack.task_005.md
```

Depending on what the target AI CLI supports.

---

## 17.4 Manual Executor

Waits for user action.

Use cases:

```text
approve plan
review risky action
confirm deploy
confirm dependency install
```

---

## 17.5 Executor Registry

```ts
const registry = new ExecutorRegistry();

registry.register("shell", new ShellExecutor());
registry.register("command", new CommandExecutor());
registry.register("manual", new ManualExecutor());
```

---

# 18. Real-Time Logging Design

## 18.1 Requirements

FlowTask must stream logs to terminal and save logs to files at the same time.

For child processes:

```text
stdout -> terminal + task log
stderr -> terminal + task log
```

---

## 18.2 Log Files

Each run has:

```text
logs/runtime.log
logs/task_001.log
logs/task_002.log
logs/validation.log
```

---

## 18.3 Ring Buffer

In-memory log lines are stored in a ring buffer (`src/utils/ring-buffer.ts`). When the `maxInMemoryLines` limit is reached, the oldest lines are evicted to bound memory usage. The ring buffer supports iteration and snapshot operations for live display.

---

## 18.4 Log Format

Human-readable task log:

```text
[2026-06-26T10:30:01.000Z] Task started: Inspect project
[2026-06-26T10:30:02.000Z] stdout: package.json found
[2026-06-26T10:30:03.000Z] stderr: warning: deprecated dependency
[2026-06-26T10:30:04.000Z] Task completed
```

---

## 18.4 Child Process Streaming

Use Node.js `child_process.spawn`.

Requirements:

```text
do not use exec for long output
use spawn
pipe stdout
pipe stderr
handle exit code
handle signal
handle timeout
redact secrets before logging
```

---

# 19. Validation and Stop Condition Design

## 19.1 Core Rule

```text
Never trust "AI says done".
Trust evidence.
```

FlowTask validates every task after the executor finishes.

---

## 19.2 Task Stop Condition

A task can be marked as done only when all required validation checks pass.

A task is completed when:

```text
1. Executor process exits successfully
2. Required files exist
3. Required artifacts exist
4. Validation commands pass
5. Acceptance criteria are satisfied
6. No dangerous action was detected
```

---

## 19.3 Run Stop Condition

A run is completed only when:

```text
1. All required tasks are done
2. No required task failed
3. Final quality checks pass
4. Final report is generated
```

A run fails when:

```text
1. A task fails after max retries
2. Validation fails
3. A dangerous command is detected
4. User rejects required approval
5. Executor crashes
6. Timeout or budget limit is reached
```

---

## 19.4 Validation Types

FlowTask supports these validation types:

```text
process validation
file validation
artifact validation
command validation
git diff validation
manual validation
optional AI review validation
```

---

## 19.5 Validation Result Schema

```json
{
  "taskId": "task_005",
  "status": "failed",
  "checks": [
    {
      "type": "process",
      "status": "passed",
      "exitCode": 0
    },
    {
      "type": "command",
      "command": "pnpm test",
      "status": "failed",
      "reason": "Unit test failed"
    }
  ],
  "createdAt": "2026-06-26T10:50:00.000Z"
}
```

---

## 19.6 Validation Engine Interface

```ts
export interface ValidationEngine {
  validateTask(input: ValidateTaskInput): Promise<ValidationResult>;
}

export interface ValidateTaskInput {
  projectRoot: string;
  run: Run;
  task: Task;
  executorResult: ExecutorResult;
}

export interface ValidationResult {
  status: "passed" | "failed" | "warning" | "skipped";
  checks: ValidationCheck[];
}

export interface ValidationCheck {
  type: "process" | "file" | "artifact" | "command" | "git_diff" | "manual" | "ai_review";
  status: "passed" | "failed" | "warning" | "skipped";
  message?: string;
  command?: string;
  path?: string;
  exitCode?: number;
}
```

---

# 20. Retry Feedback Loop

## 20.1 Retry Rule

If validation fails, FlowTask retries the current task if retry count has not exceeded the limit.

Retry flow:

```text
1. Capture validation error
2. Save error to task log
3. Build retry context pack
4. Send failure reason back to AI CLI
5. Ask AI CLI to fix only the failed task
6. Run validation again
7. Mark task done or failed
```

---

## 20.2 Retry Context Pack

Retry context should include:

```text
original task
previous attempt summary
failed command
error log
validation result
acceptance criteria
instruction to avoid unrelated changes
```

Example:

```md
# Retry Context

## Task

Implement OCR service.

## Previous Attempt Failed

The implementation was created, but validation failed.

## Failed Command

pnpm test

## Error

OCR result type is missing field `confidence`.

## Instruction

Fix only this task.
Do not rewrite unrelated files.
Run tests again before finishing.
```

---

# 21. Safety and Approval Design

## 21.1 Command Classification

Before executing commands, classify risk level.

Risk levels:

```text
safe
risky
dangerous
blocked
```

---

## 21.2 Safe Commands

Can run automatically:

```text
ls
dir
cat safe files
type safe files
find
grep
git status
git diff
pnpm test
pnpm lint
pnpm typecheck
cargo check
npm test
```

---

## 21.3 Risky Commands

Require approval:

```text
pnpm add
npm install
rm
del
git push
git reset
docker compose down
database migration
deploy command
reading sensitive files
```

---

## 21.4 Blocked Commands

Blocked by default:

```text
rm -rf /
rm -rf .git
printenv
cat .env
cat id_rsa
upload secrets
disable tests
delete project root
```

---

## 21.5 Approval Flow

```text
1. Detect risky action
2. Pause task
3. Show reason
4. Ask user approval
5. Continue or fail task
6. Write approval event
```

Example:

```text
Approval required

Task: Install OCR dependency
Command: pnpm add tesseract.js

Reason:
Installing dependencies changes project state.

Approve? [y/N]
```

---

# 22. State Management Design

## 22.1 Atomic Writes

State files must be written atomically.

Process:

```text
1. Write to temp file
2. Flush file
3. Rename temp file to target file
```

Example:

```text
state.json.tmp -> state.json
```

This prevents corrupted state.

---

## 22.2 State Update Rules

Save state when:

```text
run is created
rules are loaded
plan is generated
task starts
task completes
task fails
retry starts
resume starts
artifact is created
validation starts
validation completes
quality check starts
quality check completes
run completes
run fails
```

---

## 22.3 State Validation

Every state file must be validated before use.

If invalid:

```text
show repair suggestion
do not continue blindly
```

Future command:

```bash
flowtask repair
```

---

# 23. Event Store Design

Events are stored in JSONL files (primary durable store), with SQLite as a query-optimized secondary store. The EventStore (`src/core/event-store.ts`) writes to both on every append; `readRunEvents` reads from JSONL, `queryEvents` queries SQLite for efficient filtering.

## 23.1 Event Types

```text
project_initialized
rules_loaded
rules_missing
run_created
run_started
run_completed
run_failed
run_interrupted
run_cancel_requested
run_cancelled
run_paused
task_created
task_started
task_completed
task_failed
task_skipped
task_interrupted
context_pack_created
executor_started
executor_completed
executor_failed
executor_output
executor_exited
command_started
command_completed
command_failed
command_blocked
artifact_created
validation_started
validation_passed
validation_failed
approval_requested
approval_approved
approval_rejected
quality_started
quality_command_started
quality_command_completed
quality_command_failed
quality_completed
quality_failed
resume_started
resume_point_detected
resume_task_marked_interrupted
resume_continued
resume_completed
resume_failed
retry_started
retry_context_created
retry_executor_started
retry_validation_started
retry_completed
retry_failed
retry_limit_reached
process_started
process_exited
process_signal_sent
process_stopped
process_force_killed
process_stale
planner_fallback
ai_planner_started
ai_planner_output_received
ai_planner_json_extracted
ai_planner_validation_passed
ai_planner_validation_failed
ai_planner_repair_started
ai_planner_repair_succeeded
ai_planner_repair_failed
ai_planner_fallback_to_simple
internal_ai_planner_started
internal_ai_planner_provider_selected
internal_ai_planner_output_received
internal_ai_planner_json_extracted
internal_ai_planner_validation_passed
internal_ai_planner_validation_failed
internal_ai_planner_repair_started
internal_ai_planner_repair_succeeded
internal_ai_planner_repair_failed
internal_ai_planner_fallback_to_simple
ai_provider_stream_started
ai_provider_stream_delta
ai_provider_stream_completed
ai_provider_stream_failed
workflow_exported
workflow_edited
workflow_applied
workflow_diff_shown
workflow_added_task
workflow_removed_task
workflow_reordered
workflow_replanned
workflow_snapshot_saved
```

---

## 23.2 Event Store Interface

```ts
export interface EventStore {
  append(event: FlowTaskEvent): Promise<void>;
  readAll(runId: string): Promise<FlowTaskEvent[]>;
}
```

---

# 24. Git Integration

## 24.1 Before Run Snapshot

Before starting a run, save:

```bash
git status --porcelain
git diff --stat
git branch --show-current
```

Output files:

```text
outputs/git-before.txt
outputs/git-before-diff-stat.txt
```

---

## 24.2 After Run Snapshot

After completion, save:

```bash
git status --porcelain
git diff --stat
```

Output files:

```text
outputs/git-after.txt
outputs/git-diff-stat.txt
```

---

## 24.3 Conflict Handling

If files changed outside FlowTask during a run, FlowTask should detect it.

Behavior:

```text
1. Detect external file changes
2. Pause current task or run
3. Warn user
4. Ask whether to continue
```

This prevents overwriting user work.

---

## 24.4 Future Git Features

```text
create branch per run
commit successful run
rollback run changes
show diff per task
```

---

# 25. Quality Gate Design

FlowTask should support quality commands from config.

Example:

```json
{
  "quality": {
    "commands": ["pnpm lint", "pnpm typecheck", "pnpm test"]
  }
}
```

When user runs:

```bash
flowtask run "Implement OCR module" --quality
```

FlowTask executes quality commands before final report.

Quality result should be stored in:

```text
outputs/quality-results.json
```

---

# 26. Final Report Design

At the end of each run, generate:

```text
final-report.md
```

Report sections:

```text
Prompt
Rules Used
Summary
Plan
Completed Tasks
Failed Tasks
Skipped Tasks
Changed Files
Commands Executed
Artifacts
Validation Results
Quality Results
Errors
Manual Next Steps
```

Example:

```md
# Final Report

## Prompt

Implement OCR module for passport scanner.

## Summary

Implemented OCR module with field extraction and confidence scoring.

## Completed Tasks

- Read project rules
- Understand request
- Inspect project
- Design OCR flow
- Implement OCR service
- Add tests

## Changed Files

- src/ocr/ocr.service.ts
- src/ocr/ocr.types.ts
- src/ocr/ocr.test.ts

## Validation Results

- Required files: passed
- pnpm typecheck: passed
- pnpm test: passed

## Manual Next Steps

- Test with real passport images
- Review confidence score threshold
```

---

# 27. Error Handling

## 27.1 Executor Failure

If executor fails:

```text
save stderr
save exit code
mark task failed
mark run failed or paused
write event
show retry command
```

---

## 27.2 Validation Failure

If validation fails:

```text
save validation result
save failure reason
retry task if allowed
otherwise mark task failed
```

---

## 27.3 Process Crash

On next resume:

```text
detect task with running status
mark as interrupted
allow retry or continue
```

---

## 27.4 Invalid State

If state is invalid:

```text
stop execution
show error
suggest flowtask doctor or flowtask repair
```

---

## 27.5 Missing Executor

If configured executor is missing:

```text
show executor name
show configured command
suggest installing tool or changing config
```

---

## 27.6 Missing Rule File

If rule file is missing:

```text
if required = true, fail
if required = false, warn and continue
```

---

# 28. Limits and Timeout Control

Example config:

```json
{
  "limits": {
    "maxRunMinutes": 120,
    "maxTaskMinutes": 30,
    "maxRetries": 2,
    "maxLogSizeMb": 20
  }
}
```

Stop conditions:

```text
task timeout reached
run timeout reached
max retries reached
log size exceeded
user stopped run
dangerous command blocked
```

---

# 29. Concurrency Rules

MVP should allow only one active run per project.

If user starts another run while one is active:

```text
FlowTask detected an active run.

Options:
1. Resume active run
2. Stop active run
3. Start new run anyway
```

Default:

```text
do not start new run automatically
```

---

# 30. Cross-Platform Support

FlowTask should support:

```text
macOS
Windows
Linux
```

Rules:

```text
use path.join instead of string concat
support cmd/powershell/bash differences
avoid Unix-only commands in core logic
use cross-platform Node APIs
quote shell arguments safely
handle Windows paths correctly
```

---

# 31. Security Considerations

## 31.1 Do Not Print Secrets

Mask sensitive values.

Mask keys containing:

```text
TOKEN
SECRET
PASSWORD
API_KEY
PRIVATE_KEY
DATABASE_URL
```

---

## 31.2 Avoid Reading Sensitive Files Automatically

Sensitive files:

```text
.env
.env.local
id_rsa
id_ed25519
*.pem
*.key
```

Need approval before reading.

---

## 31.3 Command Safety

Do not execute dangerous commands without classification.

---

## 31.4 Log Redaction

Before writing logs, redact known secret patterns.

---

## 31.5 Secret Store

API keys and credentials are stored in `~/.flowtask/secrets.json` (encrypted at rest via file permissions `0o600`). The `SecretStore` class (`src/config/secret-store.ts`) provides get/set/remove/list operations. The `CredentialResolver` (`src/config/credential-resolver.ts`) maps provider names to stored credentials. The store can also be overridden via the `FLOWTASK_SECRETS_PATH` environment variable.

---

# 32. Source Code Structure

```text
flowtask/
  package.json
  tsconfig.json
  tsup.config.ts
  README.md

  src/
    cli/
      index.ts
      commands/
        cancel.command.ts
        clean.command.ts
        config.command.ts
        doctor.command.ts
        init.command.ts
        inspect.command.ts
        logs.command.ts
        providers.command.ts
        resume.command.ts
        retry.command.ts
        rules.command.ts
        run.command.ts
        run-planner.ts
        runs.command.ts
        setup.command.ts
        status.command.ts
        step.command.ts
        steps.command.ts
        stop.command.ts
        tasks.command.ts
        tasks-approve.command.ts
        tasks-edit.command.ts
        workflow.command.ts

    core/
      artifact-manager.ts
      checkpoint-service.ts
      database-manager.ts
      event-store.ts
      hook-manager.ts
      log-manager.ts
      process-manager.ts
      project-manager.ts
      report-generator.ts
      run-lifecycle.ts
      run-manager.ts
      state-manager.ts
      step-manager.ts
      workflow-manager.ts
      workflow-replanner.ts

    ai/
      ai-provider.ts
      ai-provider-error.ts
      ai.schema.ts
      api-key-validator.ts
      index.ts
      openai-provider.ts
      provider-definitions.ts
      provider-presets.ts
      provider-registry.ts
      provider-service.ts
      response-format-fallback.ts
      providers/
        anthropic-provider.ts
        azure-openai-provider.ts
        gemini-provider.ts
        index.ts
        mistral-provider.ts
        ollama-provider.ts
        openai-compatible-provider.ts

    api/
      flowtask-api.ts
      index.ts

    rules/
      rule-loader.ts
      rule-source-resolver.ts

    planner/
      planner.ts
      simple-planner.ts
      ai-planner.ts
      internal-ai-planner.ts
      planner-registry.ts
      process-planner-output.ts
      templates/

    context/
      context-pack-builder.ts
      planner-context-builder.ts

    executor/
      executor.ts
      shell-executor.ts
      command-executor.ts
      manual-executor.ts
      executor-registry.ts
      executor-presets.ts
      build-command-args.ts

    validation/
      validation-engine.ts
      validation-runner.ts
      process-validator.ts
      file-validator.ts
      command-validator.ts
      acceptance-criteria-validator.ts
      content-validator.ts
      resource-guard.ts

    safety/
      safety-checker.ts
      approval-manager.ts
      secret-redactor.ts

    quality/
      quality-gate.ts

    git/
      git-service.ts

    usecase/
      index.ts
      task-templates.ts
      usecase-detector.ts
      usecase-types.ts

    config/
      config-loader.ts
      credential-resolver.ts
      default-config.ts
      mode-rules.ts
      mode-steps.ts
      project-modes.ts
      secret-store.ts

    schemas/
      artifact.schema.ts
      checkpoint.schema.ts
      config.schema.ts
      event.schema.ts
      planner.schema.ts
      project.schema.ts
      quality.schema.ts
      rule.schema.ts
      run.schema.ts
      state.schema.ts
      step.schema.ts
      task-result.schema.ts
      task.schema.ts
      validation.schema.ts
      workflow.schema.ts

    ui/
      event-bus.ts
      output-mode.ts
      formatters/
        duration-format.ts
        error-format.ts
        status-format.ts
        task-format.ts
      renderers/
        json-renderer.ts
        plain-renderer.ts
        rich-renderer.ts
      ink/
        components/

    utils/
      command-exists.ts
      command-sanitizer.ts
      env-loader.ts
      errors.ts
      event-factory.ts
      fs.ts
      glob.ts
      ids.ts
      json-extractor.ts
      paths.ts
      process-tree-kill.ts
      process.ts
      provider-stream.ts
      ring-buffer.ts
      shell.ts
      stream-lines.ts
      stream-parser.ts
      test-streams.ts
      time.ts

    stream.ts

  tests/
    (112 test files, 1350+ tests covering all modules)
```

---

# 33. Package Configuration

## 33.1 package.json

```json
{
  "name": "flowtask",
  "version": "0.1.0",
  "description": "Local-first AI task runtime CLI — turn prompts into visible, validated, resumable AI task flows",
  "type": "module",
  "bin": {
    "flowtask": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/cli/index.ts",
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier . --write",
    "format:check": "prettier . --check",
    "quality": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test",
    "quality:fix": "pnpm lint:fix && pnpm format",
    "doctor": "node scripts/doctor.mjs",
    "codegraph": "node scripts/codegraph-trigger.mjs",
    "validate:docs": "node scripts/validate-docs.mjs",
    "audit": "pnpm audit",
    "prepare": "husky"
  },
  "dependencies": {
    "better-sqlite3": "^12.11.1",
    "commander": "^12.1.0",
    "enquirer": "^2.4.1",
    "fast-glob": "^3.3.2",
    "js-yaml": "^5.2.0",
    "picocolors": "^1.1.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0",
    "@types/better-sqlite3": "^7.6.13",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.9.0",
    "eslint": "^9.14.0",
    "eslint-config-prettier": "^9.1.0",
    "husky": "^9.1.6",
    "lint-staged": "^15.2.10",
    "prettier": "^3.4.1",
    "tsup": "^8.3.5",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "typescript-eslint": "^8.62.0",
    "vitest": "^2.1.5"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "packageManager": "pnpm@9.14.0"
}
```

---

## 33.2 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

---

## 33.3 tsup.config.ts

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  banner: {
    js: "#!/usr/bin/env node",
  },
});
```

---

# 34. Testing Strategy

## 34.1 Unit Tests

Test:

```text
schema validation
ID generation
path resolver
state manager
event store
rule loader
planner
command classifier
validation engine
```

---

## 34.2 Integration Tests

Test:

```text
init creates correct files
run creates run folder
rules are loaded
tasks are generated
task execution updates state
failed command marks task failed
validation failure triggers retry
resume detects interrupted task
logs are written
final report is generated
```

---

## 34.3 End-to-End Tests

Use a fixture project.

Test full flow:

```bash
flowtask init
flowtask run "Generate README" --executor shell
flowtask status
flowtask logs
flowtask inspect
```

---

## 34.4 Current Test Suite

```text
Test Files:  111 passed | 1 failed (112 total)
Tests:       1352 passed | 1 failed (1353 total)
Framework:   vitest
Coverage:    unit, integration, E2E, edge case, error handling
```

---

# 35. Implementation Status

## 35.1 Implemented Commands

```text
flowtask init
flowtask run
flowtask status
flowtask runs
flowtask tasks
flowtask logs
flowtask resume
flowtask retry
flowtask inspect
flowtask doctor
flowtask rules
flowtask cancel
flowtask clean
flowtask stop
flowtask setup
flowtask config
flowtask providers
flowtask workflow
flowtask steps
flowtask step
flowtask tasks-edit
flowtask tasks-approve / tasks-deny
```

---

## 35.2 Implemented Features

```text
local project initialization
file-based state
SQLite database (events, task results, artifacts, checkpoints)
config loader with schema validation
rule source config
rule loader
run creation
simple planner
AI planner (8 provider types: OpenAI, Anthropic, Gemini, Mistral, Azure, Ollama, OpenAI-compatible, Custom)
AI planner with response_format fallback and streaming
task generation
context pack generation
planner-context-builder
sequential task execution
shell executor
command executor
manual executor
real-time logs with ring buffer
events.jsonl + SQLite dual store
validation engine (process, file, artifact, command, git diff, acceptance criteria)
resume
retry with interactive approval
final report
basic git snapshot
basic quality gates
secret redaction
secret store (~/.flowtask/secrets.json)
credential resolver
use case detection
steps system (command, read, write, edit, shell, approval)
workflow management (list, show, diff, apply, add, remove, reorder, edit, replan)
checkpoint service
process manager
hook manager with lifecycle hooks
approval manager with interactive prompting
command classification (safe, risky, dangerous, blocked)
provider health checks
mode system (development, writing, research, general)
```

---

## 35.3 Beyond MVP / Future

```text
web UI
cloud sync
team collaboration
billing
parallel task execution
plugin marketplace
advanced DAG engine
multi-agent system
mobile app
```

---

# 36. Development Status

Phases 1-6 are now implemented. Phase 7 (Future UI) remains.

## Phase 1: Core Foundation ✅

```text
project init
config
schemas
file storage
state manager
event store
basic CLI
SQLite database manager
```

---

## Phase 2: Rules and Planning ✅

```text
rule source config
rule loader
rules-context.md
simple planner
AI planner with 8 provider types (OpenAI, Anthropic, Gemini, Mistral, Azure, Ollama, OpenAI-compatible, Custom)
internal AI planner with JSON mode and streaming
tasks.json
plan.md
```

---

## Phase 3: Execution ✅

```text
context pack builder
planner-context-builder
shell executor
command executor
manual executor
executor registry and presets
real-time log streaming
task lifecycle with steps
run lifecycle
hook system
```

---

## Phase 4: Validation and Retry ✅

```text
validation engine
file validator
artifact validator
command validator
process validator
content validator
acceptance criteria validator
resource guard
retry context pack
retry command with interactive approval
```

---

## Phase 5: Resume and Safety ✅

```text
resume command
interrupted task detection
command classifier
approval manager
interactive task approval (manual mode)
secret redaction
secret store (~/.flowtask/secrets.json)
credential resolver
timeout control
```

---

## Phase 6: Better UX ✅

```text
status tables
task tables
log follow mode (ring buffer)
inspect view
doctor command
clean command
final report
provider health checks
workflow management commands
```

---

## Phase 7: Future UI

```text
flowtask ui
local dashboard
task timeline
artifact viewer
live logs
diff viewer
```

---

# 37. Final Technical Direction

FlowTask should be built as a simple but solid local runtime.

The most important technical components are:

```text
rule loader
state manager
event store
task runner
context pack builder
executor system
log streamer
validation engine
resume logic
retry logic
artifact storage
final report generator
```

The CLI runtime has been built. The SQLite database is now implemented and integrated. Cloud sync, web UI, and collaboration remain future concerns.

The core runtime is successful when this works reliably:

```bash
flowtask init

flowtask rules scan

flowtask run "Implement OCR module" --executor opencode

flowtask status

flowtask logs --follow

flowtask resume

flowtask retry task_005

flowtask inspect <runId>
```

The core product is not the AI model.

The core product is the execution layer around AI work.

Final architecture principle:

```text
Prompt creates the work.
Rules guide the work.
AI CLI performs the work.
FlowTask validates the work.
State preserves the work.
Logs reveal the work.
Resume continues the work.
Report explains the work.
```
