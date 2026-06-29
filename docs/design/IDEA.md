# FlowTask — Product Concept

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** contributors, maintainers

## Full Product Idea Document

Version: 2.0
Document Type: Product Idea Document
Focus: Product concept, user value, positioning, core behavior, and future direction

---

# 1. Product Name

## FlowTask

FlowTask means:

- **Flow**: a workflow, process, or execution path
- **Task**: a unit of work that needs to be completed

The name fits because FlowTask turns a large prompt into a clear flow of smaller tasks.

FlowTask is not only for coding. It can support coding, documentation, debugging, research, testing, DevOps, planning, project setup, and other AI-assisted work.

---

# 2. One-Line Idea

FlowTask is a local-first AI task runtime that turns prompts into visible, trackable, resumable task flows and uses AI CLI tools to execute the work.

---

# 3. Short Product Description

FlowTask helps users manage AI work more clearly.

Instead of giving an AI one large prompt and waiting blindly, FlowTask breaks the work into smaller tasks, shows progress, saves state, streams logs, validates results, and allows the user to resume or retry if something fails.

The core idea is:

```text
Prompt -> Run -> Tasks -> Execution -> Validation -> Result
```

FlowTask does not need to be the AI model.

FlowTask is the control layer around AI work.

---

# 4. Product Vision

The vision of FlowTask is to make AI execution organized, visible, reliable, and controllable.

Today, many AI tools are powerful, but long-running AI work can feel unclear. A user gives a big request, the AI starts working, and the user often does not know what is happening.

FlowTask changes this by making AI work look like a real task flow.

Users should always know:

- What the AI is doing now
- Which task is running
- What has already completed
- What failed
- Why it failed
- What was generated
- What needs review
- Whether the result passed validation
- Whether the work can be resumed or retried

FlowTask turns AI work from a hidden chat experience into a visible execution process.

---

# 5. Mission

FlowTask helps users control AI work better.

It makes AI execution:

- Clear
- Trackable
- Resumable
- Safer
- Easier to validate
- Easier to debug
- Easier to trust
- Easier to review

FlowTask is not trying to replace AI coding tools.

FlowTask orchestrates them.

### Current Status

FlowTask is a fully built and operational CLI. It has 112 test files with over 1,350 tests, uses SQLite (better-sqlite3) for persistent state, and implements the full pipeline from prompt to validated result. All core features described in this document are implemented and working.

---

# 6. Core Product Statement

FlowTask is a local-first AI task runtime.

It turns prompts into task flows, reads project rules, calls AI CLI tools to execute tasks, validates results with evidence, saves state, streams logs, and supports resume/retry.

---

# 7. The Main Problem

AI tools are becoming very powerful, but long-running AI work is still hard to manage.

## 7.1 AI Work Is Often Hidden

Many tools show vague messages like:

```text
Thinking...
Working...
Generating...
```

But the user does not clearly know:

- Is AI reading the project?
- Is AI planning?
- Is AI editing files?
- Is AI running tests?
- Is AI stuck?
- Did AI fail?
- Did AI actually finish correctly?

This creates uncertainty.

---

## 7.2 Big Prompts Are Hard to Control

Users often ask AI to do large tasks:

```text
Build the OCR module.
Create the auto-fill feature.
Fix the Tauri build error.
Set up production-ready quality checks.
Generate full technical documentation.
```

These requests should not be treated as one invisible task.

They should become a flow of smaller tasks with clear progress.

---

## 7.3 Failure Is Painful

If an AI task fails halfway, users often have to restart from the beginning.

Example:

```text
Task 1 completed
Task 2 completed
Task 3 completed
Task 4 failed
```

The user should not need to restart everything.

The user should be able to retry only task 4.

---

## 7.4 AI Says "Done" Is Not Enough

AI may say the task is complete, but the result may still be wrong.

For coding tasks, the code may not compile.

For documentation tasks, the required document may be missing.

For test tasks, tests may still fail.

FlowTask does not trust only AI's final message.

FlowTask trusts evidence.

Evidence includes:

- Exit code
- Test result
- Typecheck result
- Lint result
- Required file exists
- Required artifact exists
- Git diff exists
- Manual approval
- Acceptance criteria passed

---

## 7.5 Project-Level History Is Missing

A project can have many AI-assisted runs over time.

Example:

```text
Project: guest-scan

Runs:
- Implement OCR module
- Implement auto-fill module
- Fix Rust Tauri build error
- Add git hooks
- Add production logging
- Create OCR technical document
```

Without project-level history, users cannot easily review what AI did before.

FlowTask keeps a clear history of all AI runs in a project.

---

# 8. Proposed Solution

FlowTask is a simple local-first CLI that manages AI work as structured task flows.

The user gives FlowTask a prompt.

FlowTask creates a run.

The run contains tasks.

Each task has state, logs, validation rules, artifacts, and result.

FlowTask then calls an external AI CLI tool to execute the work.

After execution, FlowTask validates the result.

If validation passes, FlowTask continues.

If validation fails, FlowTask retries, asks for approval, or stops safely.

---

# 9. Core Mental Model

The correct model is:

```text
Project
  -> Runs
      -> Tasks
          -> Steps / Logs / Artifacts / Results
```

---

# 10. Core Entities

## 10.1 Project

A project is a long-lived workspace.

Usually, one project equals one repository or product.

Examples:

```text
guest-scan
workmind-ai
personal-blog
ocr-desktop-app
backend-api
```

One project can have many runs.

---

## 10.2 Run

A run is one execution created from one user prompt.

Examples:

```text
Implement OCR module
Implement auto-fill module
Fix build error
Generate technical documentation
Set up code quality checks
```

One run can have many tasks.

---

## 10.3 Task

A task is one meaningful unit of work inside a run.

Example run:

```text
Run: Implement OCR module
```

Possible tasks:

```text
1. Understand the requirement
2. Read project rules
3. Analyze current project
4. Design OCR flow
5. Implement OCR logic
6. Add tests
7. Run validation
8. Generate final report
```

---

## 10.4 Step

A step is a smaller action inside a task.

Examples:

```text
Read file
Write file
Run command
Call AI CLI
Run test
Save artifact
Update state
```

---

## 10.5 Artifact

An artifact is useful output from a task or run.

Examples:

```text
Requirement summary
Technical design
Code diff summary
Test report
Error report
Final report
```

---

## 10.6 Rule

A rule is a user-defined instruction that controls how FlowTask plans, executes, validates, and reports work.

Examples:

```text
Always run tests before marking task done.
Do not add dependencies without approval.
Follow existing project structure.
Generate final report after every run.
Use TypeScript strict mode.
```

---

# 11. FlowTask's Role

FlowTask does not directly code.

FlowTask is the orchestrator.

AI CLI tools are the executors.

FlowTask manages:

- Project
- Run
- Tasks
- State
- Rules
- Logs
- Validation
- Resume
- Retry
- Final report

AI CLI tools do the actual coding, writing, fixing, or analysis.

Example:

```text
FlowTask
  -> OpenCode
  -> Claude Code
  -> Codex CLI
  -> Gemini CLI
  -> Aider
  -> Custom command
```

Simple explanation:

```text
FlowTask = controls the work
AI CLI = performs the work
```

---

# 12. Example User Experience

User runs:

```bash
flowtask run "Implement OCR module for passport scanner"
```

FlowTask shows:

```text
Project: guest-scan
Run: Implement OCR module

Tasks:
1. Read project rules - Done
2. Understand requirement - Done
3. Analyze project - Done
4. Design OCR flow - Done
5. Implement OCR service - Running
6. Add tests - Pending
7. Run validation - Pending
8. Generate final report - Pending
```

If the task fails:

```text
Task failed: Add tests

Reason:
pnpm test failed because OCR result type is missing one field.

Next actions:
- Retry this task
- Ask AI CLI to fix the error
- Skip task
- Stop run
```

If validation passes:

```text
Task completed:
Add tests

Evidence:
- Test file exists
- pnpm test passed
- pnpm typecheck passed
```

---

# 13. Main Value Proposition

FlowTask gives users control over AI work.

The value is not only that AI can do the task.

The value is that the user can understand, manage, validate, resume, retry, and review the task.

FlowTask helps users answer:

- What is happening now?
- What has been completed?
- What failed?
- Why did it fail?
- Can I continue?
- Can I retry only the failed part?
- Did the result pass validation?
- What final output did I get?
- Can I trust the process?

---

# 14. Rule System

FlowTask is rule-driven.

Prompt creates the work.

Rules control how the work is planned, executed, validated, and reported.

---

## 14.1 Default Rule Folder

FlowTask has its own rule folder:

```text
.flowtask/rules/
```

Example files:

```text
project.md
workflow.md
coding.md
testing.md
security.md
git.md
output.md
```

---

## 14.2 Configurable Rule Sources

FlowTask does not force users to store rules only in `.flowtask/rules`.

Many projects already have rule files.

Examples:

```text
AGENTS.md
CLAUDE.md
.cursor/rules/*.mdc
.github/copilot-instructions.md
docs/agents/AI_AGENT_RULES.md
docs/guides/CODE_QUALITY.md
docs/guides/CONTRIBUTING.md
docs/guides/DEVELOPMENT.md
```

FlowTask allows users to configure where to read rules from.

Example:

```text
FlowTask reads:
- .flowtask/rules/*.md
- AGENTS.md
- CLAUDE.md
- docs/agents/AI_AGENT_RULES.md
- docs/guides/CODE_QUALITY.md
- .cursor/rules/*.mdc
```

---

## 14.3 Rule Loading Flow

Before generating tasks, FlowTask:

```text
1. Load FlowTask config
2. Read configured rule files
3. Merge rules
4. Apply safety rules
5. Generate plan
6. Generate tasks
```

Before executing each task, FlowTask also passes relevant rules to the AI CLI tool.

---

## 14.4 Rule Priority

Rule priority is:

```text
1. Built-in FlowTask safety rules
2. Project rules
3. Configured external rule files
4. Run prompt instructions
5. Task-specific instructions
```

Important:

```text
User rules cannot override built-in safety rules.
```

If a rule says:

```text
Delete .git
Print environment secrets
Disable all tests
```

FlowTask blocks it.

---

# 15. Validation and Stop Conditions

Validation is one of the most important parts of FlowTask.

FlowTask never trusts only this:

```text
AI says done.
```

FlowTask trusts evidence.

---

## 15.1 Task Stop Condition

A task is marked as done only when required validation checks pass.

A task is not completed just because the AI CLI exits successfully.

A task is completed when:

```text
1. AI CLI process exits successfully
2. Required files or artifacts exist
3. Required validation commands pass
4. Acceptance criteria are satisfied
5. No blocked or dangerous action was detected
```

---

## 15.2 Run Stop Condition

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
5. AI CLI crashes
6. Timeout or budget limit is reached
```

---

## 15.3 Acceptance Criteria

Each task has acceptance criteria.

Example:

```text
Task: Implement OCR service

Acceptance criteria:
- OCR service file exists
- OCR result type exists
- Unit tests exist
- Typecheck passes
- Tests pass
```

This helps FlowTask know when a task is actually complete.

---

## 15.4 Validation Engine

FlowTask includes a built-in validation engine with the following validators:

- Process validator (exit code checks)
- File validator (file existence, content checks)
- Command validator (custom validation command execution)
- Acceptance criteria validator
- Content validator (regex pattern matching in output)

---

# 16. Retry Feedback Loop

When validation fails, FlowTask does not restart the whole run.

It retries the failed task.

Example:

```text
Task 5 failed validation.

Failed command:
pnpm test

Error:
Missing field in OCR result type.

Retry:
Send error back to AI CLI and ask it to fix only task 5.
```

Retry prompt includes:

- Current task
- Previous attempt summary
- Failure reason
- Error logs
- Acceptance criteria
- Rule files
- Instruction to avoid unrelated changes

If max retries are reached, FlowTask marks the task as failed and stops the run.

### Interactive Retry Approval

When maxRetries is exhausted, FlowTask prompts the user interactively (TTY only) before additional retries. If the user approves, the retry counter resets. In non-TTY or auto modes, retries skip automatically.

---

# 17. Context Pack

Before calling an AI CLI tool, FlowTask prepares a context pack.

The context pack gives the AI CLI enough information to do the task correctly.

It includes:

```text
Original prompt
Current task
Previous completed tasks
Project rules
Relevant project context
Acceptance criteria
Validation commands
Last error if retrying
Expected output
```

This prevents the AI CLI from losing context.

---

# 18. Task Prompt Generation

FlowTask does not send only a short task title to the AI CLI.

Bad:

```text
Implement OCR service.
```

Better:

```text
Original user request:
Implement OCR module for passport scanner.

Current task:
Implement OCR service.

Project rules:
Follow existing project structure.
Use TypeScript strict mode.
Do not add dependencies without approval.

Acceptance criteria:
- OCR service file exists
- OCR result type exists
- Unit tests exist
- Typecheck passes
- Tests pass

Validation commands:
pnpm typecheck
pnpm test

Instruction:
Only work on this task.
Do not rewrite unrelated files.
Return a short completion summary.
```

This improves task quality.

---

# 19. Run Modes

FlowTask supports different run modes.

## 19.1 Auto Mode

Runs tasks automatically.

```text
Good for trusted projects and low-risk tasks.
```

## 19.2 Manual Mode

User approves each task before execution.

```text
Good for careful control.
```

In TTY environments, task approval prompts happen inline. Non-TTY environments fall back to pause-and-wait behavior.

## 19.3 Plan-Only Mode

Only generates plan and tasks, but does not execute.

```text
Good for reviewing before running.
```

## 19.4 Dry-Run Mode

Shows what FlowTask would do without doing it.

```text
Good for safety and debugging.
```

## 19.5 Debug Mode

Shows detailed internal logs.

```text
Good for development and troubleshooting.
```

---

# 20. Approval System

Some actions are risky and require approval.

Examples:

```text
Install dependency
Delete files
Run database migration
Deploy application
Push to remote
Change git history
Read sensitive files
```

FlowTask pauses and asks:

```text
Approval required

Task: Install OCR dependency
Command: pnpm add tesseract.js

Approve? [y/N]
```

This gives the user control over risky actions.

---

# 21. Safety Rules

FlowTask has built-in safety rules with command classification.

Safe actions can run automatically:

```text
Read normal files
List files
Generate docs
Run tests
Run lint
Inspect git status
```

Risky actions require approval:

```text
Install dependencies
Delete files
Run migrations
Deploy
Git push
Git reset
```

Dangerous actions are blocked by default:

```text
Delete project root
Delete .git
Print secrets
Upload .env files
Disable tests
Remove security checks
```

Command output also performs secret redaction to prevent credential leakage.

---

# 22. Logs and Observability

Logs are core to FlowTask.

Users can see real-time output from the AI CLI tool.

FlowTask shows:

```text
Current run
Current task
Current command
AI CLI output
Validation output
Failure reason
Retry count
Final result
```

This makes AI work visible instead of hidden.

---

# 23. Resume

FlowTask saves state continuously.

If the terminal closes, the process crashes, or the AI CLI stops, the user can resume.

Example:

```bash
flowtask resume
```

FlowTask reads saved state and continues from the last safe point.

Resume does not depend on memory.

It depends on saved files and events.

FlowTask uses a checkpoint service for precise resume positioning and an event store (SQLite + JSONL) for durable state persistence.

---

# 24. Project-Level History

FlowTask keeps a history of all runs inside a project.

Example:

```text
Project: guest-scan

Runs:
- Implement OCR module - Completed
- Implement auto-fill module - Running
- Fix Tauri build error - Failed
- Add git hooks - Completed
```

This gives the user a long-term record of AI-assisted work.

---

# 25. Final Report

At the end of every run, FlowTask generates a final report.

The final report includes:

```text
Original prompt
Summary
Completed tasks
Failed tasks
Skipped tasks
Changed files
Commands executed
Validation results
Artifacts generated
Manual next steps
```

This report helps the user review what happened.

---

# 26. Target Users

## 26.1 Software Developers

Developers who use AI tools to write code, fix bugs, refactor, generate documentation, or set up projects.

They need visibility and control.

---

## 26.2 Indie Hackers

People building products alone.

They use AI heavily but need a structured way to manage large tasks.

---

## 26.3 Technical Founders

Founders who want to use AI to build faster but still need a clear execution process.

---

## 26.4 AI Power Users

Users who already use many AI tools and want a better way to organize AI work.

---

## 26.5 Future Team Users

Small teams could use FlowTask to track AI-assisted work across a project.

---

# 27. Main Use Cases

## 27.1 Coding Work

Examples:

```text
Build a new feature
Fix a bug
Refactor a module
Add tests
Improve logging
Set up project structure
```

---

## 27.2 Documentation Work

Examples:

```text
Create technical documentation
Generate project overview
Write setup instructions
Create user guide
Generate release notes
```

---

## 27.3 Debugging Work

Examples:

```text
Analyze build error
Investigate failed tests
Find root cause of runtime issue
Generate fix plan
```

---

## 27.4 Project Setup

Examples:

```text
Set up linting
Set up formatting
Set up git hooks
Set up CI checks
Create project structure
```

---

## 27.5 Research and Planning

Examples:

```text
Research technical options
Compare libraries
Create architecture plan
Break product idea into tasks
```

---

# 28. Product Positioning

FlowTask should be positioned as:

```text
A local-first AI task runtime.
```

or:

```text
A task flow manager for AI work.
```

or:

```text
A control layer for AI CLI tools.
```

or:

```text
Turn big prompts into visible, resumable task flows.
```

Best positioning:

```text
FlowTask turns prompts into visible, validated, resumable AI task flows.
```

---

# 29. Why FlowTask Is Different

FlowTask is not just another AI chat tool.

FlowTask is not just another AI coding assistant.

FlowTask is an AI task runtime.

Most AI tools focus on:

```text
Chatting
Generating code
Editing files
Answering questions
Calling models
```

FlowTask focuses on:

```text
Project-level organization
Run history
Task tracking
Rule loading
State persistence
Real-time logs
Validation
Stop conditions
Resume
Retry
Artifacts
Final reports
Provider-neutral execution
```

FlowTask can use other AI tools underneath instead of replacing them.

---

# 30. Competitive Category

FlowTask belongs to a new category:

```text
AI Task Runtime
```

or:

```text
AI Work Execution Layer
```

or:

```text
AI Task Flow Manager
```

It sits above AI CLI tools.

Example:

```text
User
  -> FlowTask
      -> OpenCode / Claude Code / Codex / Gemini / Aider
```

---

# 31. MVP Idea

The MVP set out to prove one thing:

```text
Can FlowTask turn a prompt into tasks, execute them through an AI CLI, save state, show logs, validate results, and resume/retry when needed?
```

### Implemented Features

All original MVP features are now built and operational:

```text
Initialize project
Start run from prompt
Read configured rule files
Generate task list
Call AI CLI executor
Show progress
Stream logs
Save state via SQLite (better-sqlite3)
Validate results with validation engine
Retry failed task with interactive approval
Resume interrupted run via checkpoint service
Generate final report
```

### Additional Features Beyond MVP

Beyond the original MVP scope, the following features have been implemented:

```text
Step-level editing and approval
Workflow management (list, show, diff, apply, add, remove, reorder, edit, replan)
Interactive retry approval (TTY prompt when maxRetries exhausted)
Interactive task approval in manual mode (inline TTY prompts)
8 AI provider types: OpenAI, Anthropic, Gemini, Mistral, Azure OpenAI, Ollama, OpenAI-Compatible, Custom
AI provider response_format fallback, SSE/NDJSON streaming, health checks
Custom provider registration API
Lifecycle hooks (beforeRun, afterRun, beforeTask, afterTask, beforeRetry, afterRetry, onFailure)
Checkpoint service for precise resume
Event store (SQLite + JSONL)
Quality gate runner
Use case detection + task templates
Secret store + credential resolver for API key management
Git snapshots (before/after run)
Project modes (development, writing, research, general)
Planner modes (simple, ai, auto) with fallback chain
Validation engine with process, file, command, acceptance criteria, content validators
Executor adapters: shell, command, manual
Command safety classification (safe, risky, blocked) with secret redaction
```

The original MVP exclusions remain unchanged:

```text
Cloud sync
Billing
Team collaboration
Plugin marketplace
Complex web UI
Multi-agent system
Advanced parallel execution
```

---

# 32. Future Product Direction

## 32.1 Local Dashboard

A local dashboard can show:

```text
Projects
Runs
Tasks
Progress
Logs
Results
Reports
Artifacts
Validation status
```

---

## 32.2 Templates (Basic)

Basic task templates are implemented via use case detection. Future improvements can include user-created reusable templates:

```text
New feature template
Bug fix template
Documentation template
Code review template
Test generation template
Production readiness template
```

---

## 32.3 Team Mode

Teams can share AI task history.

This helps teams understand:

```text
What AI did
Who started the run
What changed
What passed validation
What still needs review
```

---

## 32.4 Advanced Approval Policies

FlowTask supports interactive approval. Future work can add configurable policies:

```text
Always approve dependency installation
Always approve deployment
Always approve database migration
Require manual review before final completion
```

---

## 32.5 Multi-Agent Workflow

In the future, FlowTask can support different AI roles:

```text
Business Analyst
Architect
Developer
Tester
Reviewer
Security Reviewer
DevOps
Technical Writer
```

But this should come after the core runtime is stable.

---

## 32.6 Cloud and Team Features

Future cloud features could include:

```text
Shared run history
Team dashboard
Cloud sync
Audit logs
Role permissions
Organization policy
Private AI provider gateway
```

---

# 33. Monetization Ideas

## 33.1 Free Core

The basic FlowTask CLI is free.

Free features:

```text
Local projects
Runs
Tasks
Logs
Rules
Validation
Resume
Retry
Final reports
Basic executors
```

---

## 33.2 Pro Version

Paid features could include:

```text
Local dashboard
Advanced templates
Better reports
Run analytics
Visual timeline
Advanced diff viewer
Agent profiles
Advanced rule management
```

---

## 33.3 Team Version

Team features could include:

```text
Shared projects
Team run history
Approval workflow
Role permissions
Audit logs
Cloud sync
```

---

## 33.4 Enterprise Version

Enterprise features could include:

```text
Private deployment
Security policies
Compliance logs
SSO
Admin dashboard
Central AI provider control
```

---

# 34. Product Personality

FlowTask should feel:

```text
Simple
Reliable
Transparent
Developer-friendly
Calm
Practical
Safe
Not over-engineered
```

The product should not feel like a huge complex AI platform.

It should feel like a useful local tool that helps users stay in control.

---

# 35. Key Insight

The key insight is:

```text
AI work should not be treated as one chat message.
AI work should be treated as a task flow.
```

This is the heart of FlowTask.

---

# 36. Product Promise

FlowTask promises:

```text
You will always know what your AI task is doing.
```

More complete promise:

```text
FlowTask turns big AI prompts into clear task flows that you can track, validate, resume, retry, and review.
```

---

# 37. Success Criteria

FlowTask is successful if users say:

```text
I understand what the AI is doing.
I can see progress clearly.
I can see real-time logs.
I do not lose work when something fails.
I can retry only the failed task.
I can validate whether the result is correct.
I can review what happened.
I trust long AI tasks more.
I feel more in control.
```

---

# 38. Final Product Statement

FlowTask is a local-first AI task runtime.

It turns a user prompt into a structured project run with tasks, rules, state, logs, validation, artifacts, resume, retry, and final report.

It does not try to replace AI coding tools.

It orchestrates them.

The product is simple:

```text
Prompt in.
Rules loaded.
Tasks created.
AI CLI called.
Logs streamed.
State saved.
Results validated.
Failed tasks retried.
Final report generated.
Resume supported.
```

That is the core idea of FlowTask.
