# FlowTask AI Agent Instructions

## Project Overview

FlowTask is a local-first AI task runtime CLI that turns user prompts into visible, trackable, resumable task flows.

Core principle: Prompt → Rules → Tasks → Execution → Validation → Report

## Before Working

1. Read `docs/IDEA.MD` — the full product idea document.
2. Read `docs/TECHNICAL.MD` — the full technical design document.
3. Read `docs/AI_AGENT_RULES.md` — AI agent behavior rules.
4. Read `docs/CODE_QUALITY.md` — code quality expectations.
5. Read `README.md` — current project status and commands.

## Development Rules

- TypeScript strict mode required. No `any`.
- All schemas must use `zod`.
- Use atomic writes for state files.
- Use `spawn` for subprocesses (not `exec`).
- Use `path.join` for file paths (not string concatenation).
- Use `path.isAbsolute` for path detection (not `startsWith("/")`).
- Use `getShell()` for cross-platform shell commands.
- Keep modules small and focused.
- CLI commands must be thin — no business logic.

## Planner Modes

- `simple` — always uses fixed 7-task template, never calls AI
- `ai` — uses AI planner, fails if output is invalid after retry
- `auto` — tries AI planner, falls back to simple if invalid (default)

## AI Planner Contract

The AI planner must return **only JSON** — no markdown, no explanation, no code fences. The first character must be `{` and the last must be `}`.

If the planner returns prose (e.g. README content), FlowTask will:

1. Extract JSON from common formats (raw, fenced, balanced braces)
2. Save raw output to `.flowtask/runs/<runId>/outputs/`
3. Retry once with a repair prompt
4. Fall back to simple planner in `auto` mode, or fail in `ai` mode

## Do Not

- Do not add databases or external services.
- Do not add web UI.
- Do not bypass safety/validation.
- Do not skip tests.
- Do not add unnecessary dependencies.
- Do not mark tasks as done without validation evidence.
- Do not use hardcoded Unix paths (like `/tmp`, `"sh"`).

## Validation Rule

Never trust "AI says done". Trust evidence:

- Process exits successfully
- Required files exist
- Validation commands pass
- No dangerous action was detected
