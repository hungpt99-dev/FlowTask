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

**FlowTask** is a local-first AI task runtime CLI that turns prompts into visible, trackable, resumable task flows and orchestrates AI CLI tools to execute the work.

Instead of giving an AI a large prompt and waiting blindly, FlowTask breaks the work into smaller tasks, shows progress, saves state, streams logs, validates results, and supports resume/retry. No cloud, no database, no web UI — just a CLI that orchestrates your AI tools with surgical precision.

## Key Features

- **Prompt-to-flow pipeline** — Type a prompt, get a structured task plan with dependencies and validation rules
- **8 AI provider types** — OpenAI, Anthropic, Gemini, Mistral, Azure, Ollama, OpenAI-compatible, Custom
- **Multiple executors** — opencode, claude, codex, aider, shell, or manual approval
- **Validation engine** — Process exits, file existence, custom commands — never trust "AI says done"
- **Resume & retry** — Interrupted runs resume from the last completed task; failed tasks retry with configurable limits
- **Lifecycle hooks** — Custom shell scripts before/after runs, tasks, and retries
- **Safety first** — Command classification, secret redaction, approval workflows
- **Project modes** — development, writing, research, general — each with tailored rules
- **Git snapshots** — Before/after run snapshots for every workflow
- **Planner modes** — simple (template), ai (AI-generated), auto (AI with fallback)

## Quick Start

Runtime: **Node.js 22+** — Package manager: **pnpm 9+**

```bash
pnpm install
pnpm dev init --name "My Project" --mode development
pnpm dev run "Generate a README"
```

## How It Works

```
Prompt → Load Config → Load Rules → Create Run → (beforeRun hooks)
  → Generate Tasks → (beforeTask hooks) → Build Context Pack
  → Execute Task → Validate Result → (afterTask hooks)
  → Retry / (beforeRetry/afterRetry hooks)
  → (afterRun hooks) → Final Report → (onFailure hooks if failed)
```

FlowTask orchestrates; AI CLI tools execute.

- **Planner** = internal AI API (8 provider types) — returns structured JSON plans
- **Executor** = external AI CLI (opencode, claude, codex, aider) — edits files, runs commands

## Commands

```bash
flowtask init                          # Initialize a project
flowtask run <prompt>                  # Start a new run
flowtask status                        # Show project and run status
flowtask resume                        # Resume an interrupted run
flowtask retry <taskId>                # Retry a failed task
flowtask tasks                         # List tasks
flowtask workflow list                 # View workflow with status
flowtask logs --follow                 # Stream logs in real time
flowtask doctor                        # System health check
flowtask setup                         # Configure AI provider
flowtask providers list                # List AI providers
```

For the full command list, see [docs/reference/COMMANDS.md](docs/reference/COMMANDS.md).

## Documentation

| Section                                                            | Description                             |
| ------------------------------------------------------------------ | --------------------------------------- |
| [docs/README.md](docs/README.md)                                   | Documentation index and map             |
| [docs/guides/GETTING_STARTED.md](docs/guides/GETTING_STARTED.md)   | Quick start guide                       |
| [docs/guides/DEVELOPMENT.md](docs/guides/DEVELOPMENT.md)           | Development setup and workflow          |
| [docs/guides/CONTRIBUTING.md](docs/guides/CONTRIBUTING.md)         | How to contribute                       |
| [docs/guides/CODE_QUALITY.md](docs/guides/CODE_QUALITY.md)         | Code quality standards                  |
| [docs/reference/COMMANDS.md](docs/reference/COMMANDS.md)           | Full CLI command reference              |
| [docs/reference/CONFIGURATION.md](docs/reference/CONFIGURATION.md) | Configuration reference                 |
| [docs/reference/PROVIDERS.md](docs/reference/PROVIDERS.md)         | AI provider setup                       |
| [docs/reference/EXECUTORS.md](docs/reference/EXECUTORS.md)         | Executor configuration                  |
| [docs/reference/HOOKS.md](docs/reference/HOOKS.md)                 | Lifecycle hooks                         |
| [docs/reference/SECURITY.md](docs/reference/SECURITY.md)           | Security model and practices            |
| [docs/design/IDEA.md](docs/design/IDEA.md)                         | Product concept and vision              |
| [docs/design/TECHNICAL.md](docs/design/TECHNICAL.md)               | Technical architecture                  |
| [docs/agents/AI_AGENT_RULES.md](docs/agents/AI_AGENT_RULES.md)     | AI agent rules (single source of truth) |

## AI Agent Integration

FlowTask is designed to work seamlessly with AI coding agents. Agent-specific entry points reference shared documentation:

- **[AGENTS.md](AGENTS.md)** — opencode instructions
- **[CLAUDE.md](CLAUDE.md)** — Claude Code instructions
- **[.github/copilot-instructions.md](.github/copilot-instructions.md)** — GitHub Copilot
- **[.cursor/rules/flowtask.mdc](.cursor/rules/flowtask.mdc)** — Cursor rules

All agent files reference [docs/agents/AI_AGENT_RULES.md](docs/agents/AI_AGENT_RULES.md) as the single source of truth for AI agent behavior, planner modes, code standards, and validation rules.

## Build & Test

```bash
pnpm build            # Build with tsup → dist/
pnpm test             # Run tests (vitest)
pnpm quality          # typecheck + lint + format:check + test
pnpm quality:fix      # lint:fix + format
pnpm doctor           # System health check
```

## Project Status

Under active development. Core pipeline fully operational with extensive test coverage.

## License

MIT
