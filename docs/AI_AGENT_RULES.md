# AI Agent Rules

Rules for AI coding agents working on FlowTask.

## 1. Read Design First

Before making any changes, read:

- `docs/IDEA.MD` — product idea and vision
- `docs/TECHNICAL.MD` — technical architecture
- `docs/CODE_QUALITY.md` — code quality standards
- `README.md` — current project status and commands

## 2. Follow Project Conventions

- TypeScript strict mode. No `any`.
- Use `zod` for schema validation.
- Named exports only.
- Use `path.join` for paths (cross-platform).
- Use `getShell()` for shell commands (cross-platform — not hardcoded `sh`).
- Use `child_process.spawn` instead of `exec`.
- Atomic writes for state files.
- Use `path.isAbsolute` (not `startsWith("/")`).

## 3. Quality Requirements

- Run `pnpm quality` before committing.
- TypeScript type check, lint, format check, and tests must all pass.
- Do not skip tests.
- Do not bypass validation.

## 4. Scope Discipline

- Do not add databases.
- Do not add web UIs.
- Do not add cloud features.
- Do not add unnecessary dependencies.
- Do not implement features outside the current task scope.

## 5. Safety

- Never bypass safety checks.
- Never expose secrets or environment variables.
- Never add code that removes or bypasses validation.
- Never add commands that could damage the project.

## 6. Code Organization

- CLI commands must be thin — no business logic.
- Keep modules small and focused.
- One responsibility per module.
- Group related functionality in directories.
- Use clear, descriptive names.

## 7. Testing

- Every new feature needs tests.
- Every bug fix needs a regression test.
- Tests should be isolated and deterministic.
- Use fixtures for test data stored in `tests/fixtures/`.
- Do not hardcode Unix paths in tests.

## 8. Validation Rule

Never trust "AI says done". Trust evidence.

A task is complete only when:

- Process exits successfully
- Required files exist
- Validation commands pass
- No dangerous action was detected
