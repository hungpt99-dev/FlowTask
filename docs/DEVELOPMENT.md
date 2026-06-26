# Development Guide

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
  core/                # Domain managers + run lifecycle
  rules/               # Rule loading and merging
  planner/             # Task plan generation
  context/             # Context pack for AI executors
  executor/            # Executor adapters (shell, command, manual)
  validation/          # Validation engine
  safety/              # Command safety, approval, secret redaction
  git/                 # Git snapshots
  config/              # Configuration loader
  schemas/             # Zod schemas
  utils/               # Shared utilities (fs, paths, ids, time, process, errors, glob, shell)

tests/                 # Vitest tests
```

## Architecture

```
Prompt → Load Config → Load Rules → Create Run → Generate Tasks
  → Build Context Pack → Execute Task → Validate Result
  → Retry / Continue / Stop → Final Report
```

FlowTask orchestrates; AI CLI tools execute the work.

## Planner Modes

| Mode     | Description                                                               |
| -------- | ------------------------------------------------------------------------- |
| `simple` | Always uses fixed 7-task template. Never calls AI planner.                |
| `ai`     | Uses internal AI API provider (OpenAI). Fails if output is invalid.       |
| `auto`   | Tries internal AI API. Falls back to simple planner if invalid. (Default) |

## Architecture: Planner vs Executor

FlowTask intentionally separates planning from execution:

- **Planner** = internal AI/API provider (OpenAI-compatible via `src/ai/`) — returns structured JSON
- **Executor** = external AI CLI (opencode, claude, codex, aider via `src/executor/`) — edits files, runs commands

The planner needs structured JSON. AI CLI output includes logs, banners, tool output, and markdown — making JSON extraction unreliable. The internal AI API returns clean JSON via `response_format: json_object`.

### Internal AI Planner Contract

Configuration: `.flowtask/config.json` → `ai.providers.openai`, env `OPENAI_API_KEY`.

If the planner returns invalid output, FlowTask:

1. Extracts JSON from common formats (raw JSON, fenced ```json blocks, balanced braces)
2. Saves raw output to `.flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-N.txt`
3. Retries once with a repair prompt
4. Falls back to simple planner in `auto` mode, or fails in `ai` mode

Raw output and error files are saved to `.flowtask/runs/<runId>/outputs/` for debugging.

## Cross-Platform Notes

- All paths use `path.join` (cross-platform).
- Shell invocation uses `getShell()` from `src/utils/shell.ts` — returns `sh` on Unix, `cmd.exe` on Windows.
- Tests use temporary directories via `tests/setup.ts`.
- No hardcoded Unix paths.

## Codegraph

FlowTask uses Codegraph for codebase indexing. Run `pnpm codegraph` to trigger indexing.
