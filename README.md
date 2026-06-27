<p align="center">
  <img src="assets/images/flowtask-icon.png" alt="FlowTask Icon" width="120">
</p>

# FlowTask — AI Workflow Orchestrator

<p align="center">
  <strong>Prompt → Rules → Tasks → Execution → Validation → Report</strong>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/github/actions/workflow/status/phamthanhhung/flowtask/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="#"><img src="https://img.shields.io/github/v/release/phamthanhhung/flowtask?style=for-the-badge" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**FlowTask** is an AI Workflow Orchestrator — it turns your prompts into visible, trackable, resumable task flows and orchestrates AI CLI tools to execute the work.

Instead of giving an AI a large prompt and waiting blindly, FlowTask breaks the work into smaller tasks, shows progress, saves state, streams logs, validates results, and supports resume/retry. No cloud, no database, no web UI — just a CLI that orchestrates your AI tools with surgical precision.

If you want structured, observable, and reliable AI-driven workflows that you can pause, resume, and audit, this is it.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=phamthanhhung/flowtask&type=date&legend=top-left)](https://www.star-history.com/#phamthanhhung/flowtask&type=date&legend=top-left)

## Why FlowTask?

FlowTask gives you complete control over AI-driven workflows. Instead of treating every prompt as a one-shot black box, it organizes work into structured, observable task flows that you can track, pause, resume, and validate at every step.

- **Full visibility** — Every task shows status, live logs, and artifacts. No more staring at "Thinking..."
- **Resume anywhere** — Interrupted workflows pick up exactly where they left off. No restarts.
- **Evidence-based validation** — Never trust "AI says done". Trust process exits, file existence, and custom checks.
- **Planner modes** — `simple` (template), `ai` (AI-generated plans), `auto` (AI with fallback to simple)
- **Multi-executor** — Works with opencode, claude, codex, aider, shell, or manual approval
- **Safety built-in** — Command classification, secret redaction, and approval workflows protect your project

## Highlights

- **Prompt-to-flow pipeline** — Type a prompt, get a structured task plan with dependencies, execution order, and validation rules
- **8 AI provider types** — OpenAI, Anthropic, Gemini, Mistral, Azure, Ollama, OpenAI-compatible, Custom
- **Multiple executors** — Run tasks via opencode, claude, codex, aider, shell, or manual approval
- **Validation engine** — Process exits, file existence, custom commands — never trust "AI says done"
- **Resume & retry** — Interrupted runs resume from the last completed task; failed tasks retry with configurable limits
- **Safety first** — Command classification (safe/risky/blocked), secret redaction, approval workflows
- **Project modes** — `development`, `writing`, `research`, `general` — each with tailored rules, validation, and defaults
- **Git snapshots** — Before/after run snapshots for every workflow
- **269+ tests** — 41 test files covering all modules, all quality gates pass

## Quick Start (TL;DR)

Runtime: **Node.js 22+** — Package manager: **pnpm 9+**

```bash
pnpm install
pnpm dev init --name "My Project" --mode development
pnpm dev run "Generate a README"
```

## From Source (Development)

```bash
git clone https://github.com/phamthanhhung/flowtask.git
cd flowtask
pnpm install
pnpm dev init     # Interactive project setup
pnpm dev run      # Start your first run
```

Development loop:

```bash
pnpm dev <command>   # Run CLI with tsx (e.g. pnpm dev run)
pnpm test            # Run tests (vitest)
pnpm quality         # typecheck + lint + format:check + test
pnpm build           # Build with tsup → dist/
```

## How It Works

```
Prompt → Load Config → Load Rules → Create Run → Generate Tasks
  → Build Context Pack → Execute Task → Validate Result
  → Retry / Continue / Stop → Final Report
```

FlowTask orchestrates; AI CLI tools execute the work.

Architecture is intentionally separated:

- **Planner** = internal AI API (8 provider types) — returns structured JSON plans
- **Executor** = external AI CLI (opencode, claude, codex, aider) — edits files, runs commands

This separation exists because AI CLI output includes logs, banners, tool output, and markdown — making JSON extraction unreliable. The internal AI API returns clean JSON via `response_format: json_object`.

## Commands

```bash
flowtask init        # Initialize a FlowTask project (interactive mode + AI setup)
flowtask init --mode development   # Initialize as development project
flowtask init --mode writing       # Initialize as writing/document project
flowtask init --mode research      # Initialize as research project
flowtask init --mode general       # Initialize as general project
flowtask setup       # Configure AI provider interactively
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

| Mode          | Use Case                             | Validation                                   | Default Executor     |
| ------------- | ------------------------------------ | -------------------------------------------- | -------------------- |
| `development` | Software projects, coding, debugging | Code validation (lint/typecheck/test)        | AI CLI executor      |
| `writing`     | Documents, prompts, proposals        | Document validation (file exists, non-empty) | Internal AI provider |
| `research`    | Research, analysis, briefs           | Research validation (source notes, brief)    | Internal AI provider |
| `general`     | Generic AI task workflows            | Manual/basic artifact validation             | Internal AI provider |

### Planner Modes

- `simple` — always use the fixed 7-task template, never calls AI
- `ai` — use internal AI planner (requires an API key); fails if invalid
- `auto` — try internal AI planner, fall back to simple if invalid (default)

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

Setup stores API keys in `~/.flowtask/secrets.json` — **not** in project config. Environment variables like `OPENAI_API_KEY` still work for CI/advanced users.

### Using the AI Planner

```bash
# Use AI planner (auto mode — tries AI, falls back to simple)
flowtask run "update readme"

# Force AI planner (fails if API key missing)
flowtask run "update readme" --planner ai

# Override provider/model
flowtask run "update readme" --planner ai --planner-provider openai --planner-model gpt-4.1-mini

# Use Anthropic provider
flowtask run "update readme" --planner ai --planner-provider anthropic --planner-model claude-3-5-sonnet-latest

# Use Gemin provider
flowtask run "refactor" --planner ai --planner-provider gemini --planner-model gemini-1.5-pro

# Use Ollama local provider
flowtask run "update docs" --planner ai --planner-provider ollama --planner-model llama3.1

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

## Custom Provider Registration

FlowTask exposes a provider registration API for adding custom AI backends:

```typescript
import { ProviderRegistry, type AiProviderFactory } from "flowtask";

const registry = new ProviderRegistry();

registry.registerProviderType("my-vendor", myFactory: AiProviderFactory);
registry.registerProvider("my-model", { type: "my-vendor", ...config });
```

## Troubleshooting

### AI planner returned non-JSON output

The planner handles non-JSON output as follows:

1. It extracts JSON from common output formats (raw JSON, fenced ```json blocks, etc.)
2. If extraction fails, it saves the raw output to `.flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-1.txt`
3. It retries once with a JSON-repair prompt
4. If retry also fails, it falls back (`auto` mode) or fails with a clear error (`ai` mode)

```bash
# Skip AI planning entirely
flowtask run "update readme" --planner simple --executor opencode

# Debug planner output
cat .flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-1.txt
```

## Community

FlowTask is open source under the MIT license. Built for developers who want control, visibility, and confidence in their AI workflows. Contributions, issues, and feature requests are always welcome.

- [GitHub Issues](https://github.com/phamthanhhung/flowtask/issues) — Bug reports, feature requests
- [Contributing](CONTRIBUTING.md) — Guidelines for contributors
- [License](LICENSE) — MIT

Thanks to every contributor who has helped shape FlowTask — every issue, PR, discussion, and idea makes this project better.

## License

MIT
