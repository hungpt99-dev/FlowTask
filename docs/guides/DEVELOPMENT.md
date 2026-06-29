# Development Guide

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** contributors

## Prerequisites

- Node.js 22+
- pnpm 9+
- Git

## Setup

```bash
git clone <repo-url>
cd flowtask
pnpm install
```

## Available Commands

```bash
pnpm dev <command>    # Run CLI with tsx (e.g. pnpm dev init)
pnpm build            # Build with tsup → dist/
pnpm test             # Run tests (vitest)
pnpm test:watch       # Run tests in watch mode
pnpm typecheck        # TypeScript type checking (tsc --noEmit)
pnpm lint             # ESLint
pnpm lint:fix         # ESLint with auto-fix
pnpm format           # Prettier format
pnpm format:check     # Check format
pnpm quality          # Run all quality checks
pnpm quality:fix      # lint:fix + format
pnpm doctor           # System health check (node scripts/doctor.mjs)
pnpm codegraph        # Trigger codegraph index
pnpm validate:docs    # Validate documentation files
pnpm audit            # Run security audit
```

## Development Workflow

1. Create a branch: `git checkout -b feat/my-feature`
2. Make changes
3. Run `pnpm quality` to verify
4. Commit using conventional commits: `feat: add X`
5. Push and create PR

## Project Structure

```
.flowtask/
  project.json         # Project metadata
  config.json          # FlowTask configuration
  state.json           # Project-level state
  run-index.json       # Index of all runs
  task-index.json      # Index of all tasks
  rules/               # Default rule files
  runs/                # Run directories (not committed)

src/
  cli/                 # CLI commands (Commander) — thin, no business logic
  core/                # Domain managers + run lifecycle + hooks + database + workflow
  ai/                  # AI provider implementations (OpenAI, Anthropic, Gemini, etc.)
  api/                 # FlowTask API layer
  rules/               # Rule loading and merging
  planner/             # Task plan generation (simple, AI, auto)
  context/             # Context pack for AI executors
  executor/            # Executor adapters (shell, command, manual)
  validation/          # Validation engine + validators
  safety/              # Command safety, approval, secret redaction
  quality/             # Quality gate runner
  git/                 # Git snapshots
  usecase/             # Use case detection and task templates
  config/              # Configuration loader
  schemas/             # Zod schemas
  ui/                  # Terminal UI formatting (rich, plain, JSON renderers)
  utils/               # Shared utilities (fs, paths, ids, time, process, errors, glob, shell)

tests/                 # Vitest tests
```

## Architecture

```
Prompt → Load Config → Load Rules → Create Run → (beforeRun hooks)
  → Generate Tasks → (beforeTask hooks) → Build Context Pack
  → Execute Task → Validate Result → (afterTask hooks)
  → Retry / (beforeRetry/afterRetry hooks) / Interactive Retry Approval
  → (afterRun hooks) → Final Report → (onFailure hooks if failed)
```

FlowTask orchestrates; AI CLI tools execute the work.

## Planner Modes

| Mode     | Description                                                                        |
| -------- | ---------------------------------------------------------------------------------- |
| `simple` | Always uses fixed 7-task template. Never calls AI planner.                         |
| `ai`     | Uses internal AI API provider (OpenAI, Anthropic, Gemini, etc.). Fails if invalid. |
| `auto`   | Tries internal AI planner. Falls back to simple if invalid. (Default)              |

## Architecture: Planner vs Executor

FlowTask intentionally separates planning from execution:

- **Planner** = internal AI/API provider (OpenAI-compatible via `src/ai/`) — returns structured JSON
- **Executor** = external AI CLI (opencode, claude, codex, aider via `src/executor/`) — edits files, runs commands

The planner needs structured JSON. AI CLI output includes logs, banners, tool output, and markdown — making JSON extraction unreliable. The internal AI API returns clean JSON via `response_format: json_object`.

### AI Provider Architecture

FlowTask supports dedicated provider classes for different AI APIs:

- **OpenAI** — native `/chat/completions` with `response_format: json_object`
- **OpenAI-Compatible** — OpenRouter, DeepSeek, Groq, LM Studio, Together, Fireworks, custom endpoints
- **Anthropic** — native `/v1/messages` API
- **Gemini** — native `generateContent` API with `responseMimeType`
- **Mistral** — native `/chat/completions` API
- **Azure OpenAI** — deployment-based `/openai/deployments/{deployment}/chat/completions`
- **Ollama** — native `/api/chat` with NDJSON streaming

Providers support:

- `response_format` fallback (retry without JSON mode if unsupported)
- SSE/NDJSON streaming
- Health checks (`flowtask doctor --providers`)
- Custom provider registration API

## Internal AI Planner Contract

Configuration: `.flowtask/config.json` → `ai.providers.<name>`, env `<NAME>_API_KEY`.

If the planner returns invalid output, FlowTask:

1. Extracts JSON from common formats (raw JSON, fenced ```json blocks, balanced braces)
2. Saves raw output to `.flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-N.txt`
3. Retries once with a repair prompt
4. Falls back to simple planner in `auto` mode, or fails in `ai` mode

Raw output and error files are saved to `.flowtask/runs/<runId>/outputs/` for debugging.

## Lifecycle Hooks

FlowTask supports user-defined lifecycle hooks configured in `.flowtask/config.json`:

```json
{
  "hooks": {
    "beforeRun": ["echo 'Run started: $HOOK_RUN_ID'"],
    "afterRun": ["echo 'Run finished'"],
    "beforeTask": ["echo 'Starting task: $HOOK_TASK_TITLE'"],
    "afterTask": ["echo 'Task completed'"],
    "beforeRetry": ["echo 'Retrying task'"],
    "afterRetry": ["echo 'Retry attempt completed'"],
    "onFailure": ["echo 'Task failed'"],
    "failOnError": false
  }
}
```

Hooks receive context via env variables (`HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_TASK_TITLE`, `HOOK_RETRY_COUNT`, `HOOK_MAX_RETRIES`, etc.).

## Interactive Retry Approval

When a task exhausts `maxRetries`, FlowTask prompts for user approval before additional retries:

- **TTY mode**: Interactive prompt via `enquirer`
- **Non-TTY / CI**: Auto-skips (approval not possible)
- **Auto-approve mode**: Skips additional retries

On approval, retry counter resets. On denial, task is marked failed.

## Interactive Task Approval

In `manual` mode with TTY, task approval prompts happen inline. Non-TTY falls back to external approval via `flowtask tasks-approve`.

## Cross-Platform Notes

- All paths use `path.join` (cross-platform).
- Shell invocation uses `getShell()` from `src/utils/shell.ts` — returns `sh` on Unix, `cmd.exe` on Windows.
- Tests use temporary directories via `tests/setup.ts`.
- No hardcoded Unix paths.

## Codegraph

FlowTask uses Codegraph for codebase indexing. Run `pnpm codegraph` to trigger indexing.
