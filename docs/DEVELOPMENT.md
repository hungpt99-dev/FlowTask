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

## Cross-Platform Notes

- All paths use `path.join` (cross-platform).
- Shell invocation uses `getShell()` from `src/utils/shell.ts` — returns `sh` on Unix, `cmd.exe` on Windows.
- Tests use temporary directories via `tests/setup.ts`.
- No hardcoded Unix paths.

## Codegraph

FlowTask uses Codegraph for codebase indexing. Run `pnpm codegraph` to trigger indexing.
