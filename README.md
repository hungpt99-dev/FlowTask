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
- AI provider architecture with 8 provider types (OpenAI, Anthropic, Gemini, Mistral, Azure, Ollama, OpenAI-compatible, Custom)
- Custom provider registration API for extending planner backends
- Provider health checks via `flowtask doctor --providers` and `flowtask providers doctor`
- Command safety classification, approval system, and secret redaction
- Git snapshot support (before/after run snapshots)
- Init-time project mode selection (development, writing, research, general)
- Mode-specific rules, steps, validation, and safety defaults
- AI provider setup with guided interactive flow
- Secure credential storage (no API keys in config files)
- Provider management commands (list, test, configure, remove)
- 269+ tests across 41 test files cover all modules
- All quality gates pass

## Requirements

- Node.js 22+
- pnpm 9+

## Quick Start

```bash
# Install
pnpm install

# Full setup (project + AI provider + rules)
pnpm dev init

# Initialize with a specific mode
pnpm dev init --name "My Project" --mode development
pnpm dev init --name "Writing Project" --mode writing
pnpm dev init --name "Research Project" --mode research

# Show available init modes
pnpm dev init --show-modes

# Configure AI provider (interactive)
pnpm dev setup

# Configure AI provider (non-interactive)
pnpm dev setup --provider openai --api-key-env OPENAI_API_KEY
pnpm dev setup --provider ollama --model llama3.1

# Provider management
pnpm dev providers list       # List all configured providers
pnpm dev providers current    # Show current provider
pnpm dev providers test       # Test provider connection
pnpm dev providers configure  # Interactive provider configuration
pnpm dev providers remove     # Remove a provider

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
flowtask init        # Initialize a FlowTask project (interactive mode + AI setup)
flowtask init --mode development   # Initialize as development project
flowtask init --mode writing       # Initialize as writing/document project
flowtask init --mode research      # Initialize as research project
flowtask init --mode general       # Initialize as general project
flowtask init --show-modes         # List available project modes
flowtask setup       # Configure AI provider interactively
flowtask setup --provider openai --api-key-env OPENAI_API_KEY   # Non-interactive AI setup
flowtask providers list    # List configured AI providers
flowtask providers current # Show current AI provider
flowtask providers test    # Test AI provider connection
flowtask providers configure  # Configure AI provider interactively
flowtask providers remove [name]  # Remove an AI provider
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
flowtask setup       # Configure AI provider interactively
flowtask providers   # Manage AI providers (list, test, configure, remove)
flowtask rules       # Manage FlowTask rule sources
```

### Execution Modes

- `auto` — execute tasks automatically (default)
- `manual` — ask for approval before each task
- `plan-only` — generate plan and tasks, do not execute
- `dry-run` — show what would happen without executing
- `debug` — show detailed state, config, and execution info

### Project Modes

FlowTask chooses a project mode during initialization.

Mode is selected once during `flowtask init` and stored in `.flowtask/config.json` as `projectMode`.

During normal `flowtask run`, no mode flag is needed — the project rules already define how FlowTask behaves.

| Mode          | Use Case                             | Validation                                   | Default Executor     |
| ------------- | ------------------------------------ | -------------------------------------------- | -------------------- |
| `development` | Software projects, coding, debugging | Code validation (lint/typecheck/test)        | AI CLI executor      |
| `writing`     | Documents, prompts, proposals        | Document validation (file exists, non-empty) | Internal AI provider |
| `research`    | Research, analysis, briefs           | Research validation (source notes, brief)    | Internal AI provider |
| `general`     | Generic AI task workflows            | Manual/basic artifact validation             | Internal AI provider |

Each mode generates:

- `.flowtask/rules/mode.md` — mode-specific rules loaded by the rule system
- `.flowtask/steps/default.md` — mode-specific default workflow
- Mode-specific validation and safety defaults in config

### Planner Modes

- `simple` — always use the fixed 7-task template, never calls AI
- `ai` — use internal AI planner (requires an API key for the configured provider); fails if invalid
- `auto` — try internal AI planner, fall back to simple if invalid or missing API key (default)

### Providers Command

```bash
flowtask providers list            # List configured AI providers with type and key status
flowtask providers doctor          # Check health of all configured AI providers
```

### AI Provider Setup

FlowTask supports guided AI provider setup. Run `flowtask setup` to configure:

```text
OpenAI               native OpenAI (gpt-4.1-mini)
Anthropic            native /v1/messages (claude-3-5-sonnet-latest)
Gemini               native generateContent (gemini-1.5-pro)
OpenRouter           OpenAI-compatible (openai/gpt-4o-mini)
DeepSeek             OpenAI-compatible (deepseek-chat)
Groq                 OpenAI-compatible (llama-3.3-70b-versatile)
Ollama               local /api/chat (llama3.1) — no API key needed
LM Studio            local OpenAI-compatible — no API key needed
```

Setup stores API keys in `~/.flowtask/secrets.json` — **not** in project config.

Environment variables like `OPENAI_API_KEY` still work for CI/advanced users.

### Planner Provider

Planner provider resolution follows this order:

1. Explicit `apiKeyEnv` from config (env var)
2. Secret reference (`flowtask:<name>`) from secure store
3. Default env var for provider type (e.g., `OPENAI_API_KEY`)
4. Local no-key mode for local providers

### Custom Provider Registration

FlowTask exposes a provider registration API for adding custom AI backends:

```typescript
import { ProviderRegistry, type AiProviderFactory } from "flowtask";

const registry = new ProviderRegistry();

// Register a custom provider type
registry.registerProviderType("my-vendor", myFactory: AiProviderFactory);

// Register a named provider instance
registry.registerProvider("my-model", { type: "my-vendor", ...config });
```

Providers registered via the API are checked during health checks and planning alongside built-in providers.

### API Key Setup

FlowTask offers **two ways** to configure API keys for AI providers:

**1. Interactive setup (recommended) — during `flowtask init`:**

After initializing a project, FlowTask can configure an AI planner provider. API keys are stored in `~/.flowtask/secrets.json` — never in project config files. Run `flowtask setup` later to change or test the provider.

```bash
flowtask init
# → "Would you like to configure an AI planner provider now?" [Yes]
# → Select provider (OpenAI, Anthropic, Gemini, Mistral, OpenRouter, etc.)
# → Enter your API key (masked input)
# → Key saved to .env, provider configured in .flowtask/config.json
```

**2. Manual setup — environment variables (advanced):**

Environment variables are supported but optional. Use them for CI/CD or when you prefer not to use the secure store.

```bash
export OPENAI_API_KEY=sk-your-key
```

Or create a `.env` file in your project root:

```bash
# .env
OPENAI_API_KEY=sk-your-key
```

FlowTask automatically loads `.env` from your project root on every command.

**Provider API key environment variables:**

| Provider     | Env Variable           |
| ------------ | ---------------------- |
| OpenAI       | `OPENAI_API_KEY`       |
| Anthropic    | `ANTHROPIC_API_KEY`    |
| Gemini       | `GEMINI_API_KEY`       |
| Mistral      | `MISTRAL_API_KEY`      |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` |
| OpenRouter   | `OPENROUTER_API_KEY`   |
| DeepSeek     | `DEEPSEEK_API_KEY`     |
| Groq         | `GROQ_API_KEY`         |
| Together AI  | `TOGETHER_API_KEY`     |
| Fireworks AI | `FIREWORKS_API_KEY`    |
| Ollama       | _(no key needed)_      |
| LM Studio    | _(no key needed)_      |

**Using the AI planner:**

```bash
# Use AI planner (auto mode — tries AI, falls back to simple)
flowtask run "update readme"

# Force AI planner (fails if API key missing)
flowtask run "update readme" --planner ai

# Override provider/model
flowtask run "update readme" --planner ai --planner-provider openai --planner-model gpt-4.1-mini

# Use Anthropic provider
flowtask run "update readme" --planner ai --planner-provider anthropic --planner-model claude-3-5-sonnet-latest

# Use Gemini provider
flowtask run "refactor" --planner ai --planner-provider gemini --planner-model gemini-1.5-pro

# Use Ollama local provider
flowtask run "update docs" --planner ai --planner-provider ollama --planner-model llama3.1

# Provider health check
flowtask doctor --providers

# List all providers
flowtask providers list

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

```bash
flowtask stop                      # Stop running task + signal executor process
flowtask cancel <runId>            # Cancel run + kill executor process
```

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
- **AI planner** — The internal AI planner requires an API key for the selected provider and will fall back to the simple planner if unavailable. Keys can be configured via `flowtask setup` (interactive), `flowtask init`, or by setting environment variables.
- **External AI CLI integration** — AI CLI tools (opencode, claude, codex) are used as task executors, not as the planner. The command executor supports argument, stdin, and file input modes, but end-to-end integration with specific tools may require configuration tuning.

## License

MIT
