# FlowTask Copilot Instructions

You are working on FlowTask, a local-first AI task runtime CLI.

## Before you start

1. Read `docs/IDEA.MD` and `docs/TECHNICAL.MD` to understand the full product and technical design.
2. Follow `docs/AI_AGENT_RULES.md` for AI agent behavior rules.
3. Follow `docs/CODE_QUALITY.md` for code quality requirements.

## Code Standards

- Use strict TypeScript. No `any` types.
- Use `zod` for all schema validation.
- Use named exports (no default exports).
- Use `path.join` for file paths (never string concatenation).
- Use `path.isAbsolute` for path detection (not `startsWith("/")`).
- Use `getShell()` / `getShellCommandFlag()` from `src/utils/shell.ts` for shell commands (not hardcoded `"sh"` or `"-c"`).
- Use `fast-glob` for glob expansion.
- Use `child_process.spawn` for long-running commands (not `exec`).
- Use atomic writes for state files (write to `.tmp` then rename).

## Architecture Rules

- CLI commands must be thin — parse arguments, call services, format output.
- Business logic lives in `src/core/`, `src/rules/`, `src/planner/`, etc.
- Keep modules small and focused. One responsibility per module.
- Do not implement unrelated features.
- Do not skip tests.
- Do not remove validation.
- Do not bypass safety rules.
- Do not mark tasks as done without validation evidence.
- Support Windows, macOS, and Linux.
- Never hardcode Unix-only paths or commands in core logic.

## Validation Rule

Never trust "AI says done". Trust evidence:

- Process exits successfully
- Required files exist
- Validation commands pass
- No dangerous action was detected
