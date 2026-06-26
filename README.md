# FlowTask

**Local-first AI task runtime CLI.**

FlowTask turns prompts into visible, validated, resumable AI task flows.

Instead of giving an AI a large prompt and waiting blindly, FlowTask breaks the work into smaller tasks, shows progress, saves state, streams logs, validates results, and supports resume/retry.

## Status

FlowTask core runtime is implemented and operational.

- Project initialization, configuration, and rule loading are functional
- Run lifecycle (plan-only, dry-run, full execution with shell executor) works
- Status, runs, tasks, logs, inspect, doctor, and rules commands are implemented
- Validation engine checks process exit codes and file existence
- Event store, state manager, and log manager persist all state
- 70+ tests cover core functionality
- All quality gates pass

## Requirements

- Node.js 22+
- pnpm 9+

## Quick Start

```bash
# Install
pnpm install

# Initialize a project
pnpm dev init --name "My Project"

# List configured rules
pnpm dev rules list

# Run a task (plan-only mode)
pnpm dev run "Generate a README" --plan-only

# Full auto execution (uses shell executor)
pnpm dev run "Generate a README"

# Check status
pnpm dev status

# List runs and tasks
pnpm dev runs
pnpm dev tasks

# View logs
pnpm dev logs --run <runId>

# Inspect a run
pnpm dev inspect <runId>

# System health check
pnpm dev doctor
```

## Commands

```bash
flowtask init        # Initialize a FlowTask project in the current directory
flowtask run         # Start a new run from a prompt
flowtask status      # Show current project and run status
flowtask runs        # List all runs in the project
flowtask tasks       # List tasks
flowtask logs        # Show logs for runs and tasks
flowtask resume      # Resume an interrupted run
flowtask retry       # Retry a failed task
flowtask inspect     # Inspect a run's details, logs, and artifacts
flowtask stop        # Stop the current running task
flowtask cancel      # Cancel a run
flowtask clean       # Clean up old runs
flowtask doctor      # Check system health and project configuration
flowtask rules       # Manage FlowTask rule sources
```

### Execution Modes

- `auto` — execute tasks automatically (default)
- `manual` — ask for approval before each task
- `plan-only` — generate plan and tasks, do not execute
- `dry-run` — show what would happen without executing
- `debug` — show detailed state, config, and execution info

## Build

```bash
pnpm build
```

Output goes to `dist/`.

## Test

```bash
pnpm test
pnpm test:watch
```

## Code Quality

```bash
pnpm quality     # typecheck + lint + format:check + test
pnpm quality:fix # lint:fix + format
pnpm doctor      # system health check
```

## Git Hooks

- Pre-commit: lint-staged, typecheck, codegraph trigger
- Commit-msg: commitlint (conventional commits)

## Project Structure

```
.flowtask/
  project.json     # Project metadata
  config.json      # FlowTask configuration
  state.json       # Project-level state
  run-index.json   # Index of all runs
  task-index.json  # Index of all tasks
  rules/           # Default rule files
  runs/            # Run directories (not committed)

src/
  cli/             # CLI commands
  core/            # Domain managers + run lifecycle
  rules/           # Rule loading and merging
  planner/         # Task plan generation
  context/         # Context pack for AI executors
  executor/        # Executor adapters (shell, command, manual)
  validation/      # Validation engine
  safety/          # Command safety and secret redaction
  git/             # Git snapshots
  config/          # Configuration loader
  schemas/         # Zod schemas
  utils/           # Shared utilities
```

## Rule Files

FlowTask loads rules from configured paths:

```
.flowtask/rules/*.md
AGENTS.md
CLAUDE.md
docs/AI_AGENT_RULES.md
docs/CODE_QUALITY.md
docs/DEVELOPMENT.md
.cursor/rules/*.mdc
.github/copilot-instructions.md
```

## AI Agent Docs

- `AGENTS.md` — AI agent instructions
- `CLAUDE.md` — Claude Code instructions
- `.cursor/rules/flowtask.mdc` — Cursor AI rules
- `.github/copilot-instructions.md` — GitHub Copilot instructions
- `docs/AI_AGENT_RULES.md` — Detailed AI agent rules
- `docs/CODE_QUALITY.md` — Code quality standards

## Architecture

```
Prompt → Load Config → Load Rules → Create Run → Generate Tasks
  → Build Context Pack → Execute Task → Validate Result
  → Retry / Continue / Stop → Final Report
```

FlowTask orchestrates; AI CLI tools execute the work.

## Known Limitations

- **No web UI** — CLI only. A local dashboard is planned for the future.
- **No cloud sync** — All data is local to the project. No cloud backup or sharing.
- **No parallel task execution** — Tasks run sequentially within a run.
- **No advanced AI planner** — The simple planner generates a fixed 7-task template. AI-driven planning is not yet implemented.
- **Resume** — Basic: marks interrupted tasks but does not auto-continue execution.
- **Retry** — Basic: resets task status to pending for manual re-run.
- **Stop** — Graceful stop via state update but no process signal to running executor.
- **Logs --follow** — The flag is accepted but real-time log streaming is not yet implemented.
- **External AI CLI executors** — Shell executor is functional. Command executor for tools like `opencode`, `claude`, `codex` is registered but requires configuration.
- **No team features** — Single-user, local-only.
- **No database** — All state is file-based using JSON and JSONL.
- **Windows testing** — Cross-platform utilities (`getShell()`, `path.join`) are in place but Windows has not been tested end-to-end.

## License

MIT
