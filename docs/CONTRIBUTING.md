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
- `zod` for schemas.
- Tests for all code.
- No `any` types.
- Small, focused modules.
- CLI commands are thin — no business logic.
- Cross-platform: use `path.join`, `getShell()`, `path.isAbsolute`.

## Pull Request Process

1. PR title must follow conventional commits.
2. All quality checks must pass on CI.
3. PR must be reviewed by at least one maintainer.
4. Squash merge preferred.

## Reporting Issues

- Use GitHub issues.
- Include: FlowTask version, Node.js version, OS, steps to reproduce, expected vs actual behavior.

## Testing

- Use `vitest` for all tests.
- Tests live in `tests/` mirroring `src/` structure.
- Do not hardcode Unix paths like `/tmp` in tests — use `testDir` from `tests/setup.ts`.
