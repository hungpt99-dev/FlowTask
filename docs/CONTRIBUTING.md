# Contributing

## How to Contribute

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes.
4. Run quality checks: `pnpm quality`
5. Commit with conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`
6. Push and open a pull request.

## Code Standards

- TypeScript strict mode. No `any`.
- `zod` for all schema validation.
- All exports are named (no default exports).
- Tests for all code using `vitest`.
- Small, focused modules (~200 lines max per file).
- CLI commands are thin — no business logic.
- Cross-platform: use `path.join`, `getShell()`, `path.isAbsolute`.

## Development Setup

```bash
pnpm install
pnpm dev init     # Initialize a test project
pnpm dev run      # Start a run
```

## Available Commands

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `pnpm dev`           | Run CLI with tsx                       |
| `pnpm build`         | Build with tsup → dist/                |
| `pnpm test`          | Run tests (vitest)                     |
| `pnpm test:watch`    | Run tests in watch mode                |
| `pnpm typecheck`     | TypeScript type checking               |
| `pnpm lint`          | ESLint                                 |
| `pnpm lint:fix`      | ESLint with auto-fix                   |
| `pnpm format`        | Prettier format                        |
| `pnpm format:check`  | Check format                           |
| `pnpm quality`       | typecheck + lint + format:check + test |
| `pnpm quality:fix`   | lint:fix + format                      |
| `pnpm doctor`        | System health check                    |
| `pnpm codegraph`     | Trigger codegraph index                |
| `pnpm validate:docs` | Validate documentation files           |
| `pnpm audit`         | Run security audit                     |

## Pull Request Process

1. PR title must follow conventional commits.
2. All quality checks must pass on CI.
3. Commits are linted by commitlint and pre-commit hooks.
4. Pre-commit hook runs: `lint-staged`, `typecheck`, `codegraph trigger`.
5. PR must be reviewed by at least one maintainer.
6. Squash merge preferred.

## Reporting Issues

- Use GitHub issues.
- Include: FlowTask version, Node.js version, OS, steps to reproduce, expected vs actual behavior.
- Use labels: `bug`, `feature`, `enhancement`, `documentation`, `security`.

## Testing Guidelines

- Use `vitest` for all tests.
- Tests live in `tests/` mirroring `src/` structure.
- Do not hardcode Unix paths like `/tmp` in tests — use `testDir` from `tests/setup.ts`.
- Every core module should have a corresponding test file.
- Use `tests/fixtures/` for complex test data.
- Tests must be deterministic, isolated, and cross-platform.

## Project Structure

```
src/
  cli/           CLI commands (Commander) — thin, no business logic
  core/          Domain managers + run lifecycle + hooks + workflow
  ai/            AI provider implementations (OpenAI, Anthropic, Gemini, etc.)
  api/           FlowTask API layer
  rules/         Rule loading and merging
  planner/       Task plan generation (simple, AI, auto)
  context/       Context pack builder
  executor/      Executor adapters (shell, command, manual)
  validation/    Validation engine + validators
  safety/        Safety checker, approval manager, secret redactor
  quality/       Quality gate runner
  git/           Git snapshots
  usecase/       Use case detection and task templates
  config/        Configuration loader
  schemas/       Zod schemas
  ui/            Terminal UI formatting (rich, plain, JSON)
  utils/         Shared utilities (fs, paths, ids, shell, etc.)
```

## Getting Help

- Open a GitHub issue for bugs and feature requests.
- Check `README.md` for usage and commands.
- Run `flowtask doctor` for system health checks.
