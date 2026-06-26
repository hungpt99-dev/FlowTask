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

### Planner Modes

- `simple` — always use the fixed 7-task template, never calls AI
- `ai` — use internal AI planner (requires `OPENAI_API_KEY`); fails if invalid
- `auto` — try internal AI planner, fall back to simple if invalid or missing API key (default)

### Planner Provider

FlowTask uses an internal AI/API provider for planning (OpenAI-compatible).
External AI CLIs (opencode, claude, codex, etc.) remain as task executors.

```bash
# Set API key
export OPENAI_API_KEY=sk-your-key

# Use AI planner
flowtask run "update readme" --planner ai

# Override provider/model
flowtask run "update readme" --planner ai --planner-provider openai --planner-model gpt-4.1-mini

# Skip AI planner entirely
flowtask run "update readme" --planner simple
```

### Resume

```bash
flowtask resume                    # Auto-continue from interruption
flowtask resume <runId>            # Resume a specific run
flowtask resume <runId> --from task_004  # Continue from a specific task
flowtask resume <runId> --dry-run  # Show resume plan without executing
```

### Retry

```bash
flowtask retry task_005            # Retry a failed task immediately
flowtask retry task_005 --continue # Retry then continue remaining tasks
flowtask retry task_005 --force    # Bypass maxRetries check
flowtask retry task_005 --dry-run  # Show retry plan without executing
```

### Logs

```bash
flowtask logs --follow             # Stream logs in real time (tail -f style)
flowtask logs --follow --tail 100  # Show last 100 lines then follow
flowtask logs --follow --task task_005  # Follow a specific task log
flowtask logs --follow --validation     # Follow validation logs
```

### Stop / Cancel

````bash
flowtask stop                      # Stop running task + signal executor process
flowtask cancel <runId>            # Cancel run + kill executor process

## Build

```bash
pnpm build
````

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

## AI CLI Executor Configuration

Executors are configured in `.flowtask/config.json` under the `executors` key. Each executor specifies a command, arguments, and how input is delivered.

### Input Modes

| Mode       | How Context Is Passed                | Best For                        |
| ---------- | ------------------------------------ | ------------------------------- |
| `stdin`    | Written to the process stdin         | opencode, claude, codex, gemini |
| `argument` | Appended as the final CLI argument   | aider (`--message`)             |
| `file`     | Path written via `--file <path>` arg | Custom tools needing file input |

### Default Presets

```json
{
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
    "args": [],
    "inputMode": "stdin",
    "timeoutMs": 1800000
  },
  "codex": {
    "type": "command",
    "command": "codex",
    "args": [],
    "inputMode": "stdin",
    "timeoutMs": 1800000
  },
  "gemini": {
    "type": "command",
    "command": "gemini",
    "args": [],
    "inputMode": "stdin",
    "timeoutMs": 1800000
  },
  "aider": {
    "type": "command",
    "command": "aider",
    "args": ["--message"],
    "inputMode": "argument",
    "timeoutMs": 1800000
  }
}
```

### Running with a Specific Executor

```bash
flowtask run "update readme" --executor opencode
flowtask run "update readme" --executor claude
flowtask run "update readme" --executor codex
flowtask run "update readme" --executor shell
```

### Check Executor Availability

```bash
flowtask doctor
```

Shows all configured executors and whether their CLI binaries are installed.

### Planner Modes with AI Executor

```bash
flowtask run "update readme" --planner auto --executor opencode   # AI planner, fallback on failure
flowtask run "update readme" --planner ai --executor opencode     # AI planner only, fail if unavailable
flowtask run "update readme" --planner simple --executor shell    # Skip AI planner entirely
```

## Troubleshooting

### "README.md: command not found" / "Permission denied"

If you see errors like:

```text
README.md: command not found
zod: command not found
path.join: command not found
docs/IDEA.MD: Permission denied
```

This means the context pack (which contains markdown text) is being executed as shell commands. This was a known bug in the command executor — it has been fixed.

**The fix:** The `CommandExecutor` now uses `spawn(command, args, { shell: false })` and passes context through stdin, argument, or file mode — never through the shell. The `AiPlanner` was also fixed to use direct `spawn` instead of building a shell command string.

If you still see these errors after updating FlowTask, check your `.flowtask/config.json`:

- Ensure each executor uses `"command"` + `"args"` separately (not `"command": "opencode run"`)
- Set `"inputMode": "stdin"` for most AI CLI tools
- Run `flowtask doctor` to verify executor configurations

### AI planner returned non-JSON output

This happens when the planner returns prose or markdown instead of a strict JSON task plan.

FlowTask now uses an internal AI/API provider (OpenAI-compatible) for planning. The internal provider uses `response_format: json_object` for structured output.

The planner handles non-JSON output as follows:

1. It extracts JSON from common output formats (raw JSON, fenced ```json blocks, etc.)
2. If extraction fails, it saves the raw output to `.flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-1.txt`
3. It retries once with a JSON-repair prompt
4. If retry also fails:
   - `--planner auto` (default): falls back to the simple planner with a warning
   - `--planner ai`: fails with a clear error message

**To skip AI planning entirely:**

```bash
flowtask run "update readme" --planner simple --executor opencode
```

**To debug planner output:**

```bash
cat .flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-1.txt
```

**Planner modes:**

| Mode     | Behavior                                                                    |
| -------- | --------------------------------------------------------------------------- |
| `simple` | Always use the fixed 7-task template. Never calls AI planner.               |
| `ai`     | Use internal AI planner. Fails if output is invalid after repair retry.     |
| `auto`   | Try internal AI planner. Falls back to simple planner if invalid. (Default) |

## Known Limitations

- **No web UI** — CLI only. A local dashboard is planned for the future.
- **No cloud sync** — All data is local to the project. No cloud backup or sharing.
- **No parallel task execution** — Tasks run sequentially within a run.
- **No team features** — Single-user, local-only.
- **No database** — All state is file-based using JSON and JSONL intentionally.
- **Windows testing** — Cross-platform utilities (`getShell()`, `path.join`) are in place but Windows has not been tested end-to-end.
- **AI planner** — The internal AI planner requires an `OPENAI_API_KEY` environment variable and will fall back to the simple planner if unavailable.
- **External AI CLI integration** — AI CLI tools (opencode, claude, codex) are used as task executors, not as the planner.
- **External AI CLI integration** — The command executor supports argument, stdin, and file input modes, but end-to-end integration with specific tools may require configuration tuning.

## License

MIT
