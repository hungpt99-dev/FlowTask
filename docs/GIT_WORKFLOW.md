# Git Workflow

## Branch Strategy

- `main` — stable, release-ready
- `develop` — integration branch
- `feat/*` — feature branches
- `fix/*` — bug fix branches
- `chore/*` — maintenance branches

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: correct a bug
docs: update documentation
test: add tests
refactor: restructure code
chore: maintenance tasks
```

## Pre-commit Hooks

The pre-commit hook runs:

1. `pnpm lint-staged` — format and lint staged files
2. `pnpm typecheck` — TypeScript check
3. `node scripts/codegraph-trigger.mjs` — update codegraph index

## Commit Message Hook

The commit-msg hook validates messages using commitlint.

## Pull Requests

- PRs target `develop` or `main`.
- All CI checks must pass.
- Squash merge preferred to keep history clean.
