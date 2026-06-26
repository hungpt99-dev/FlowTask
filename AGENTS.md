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
- `ai` — uses internal AI planner, fails if output is invalid after retry
- `auto` — tries internal AI planner, falls back to simple if invalid (default)

## Internal AI Planner

FlowTask uses an **internal AI/API provider** (OpenAI-compatible) for planning, not an external AI CLI.

- **Planner** = internal AI API (returns structured JSON with `response_format: json_object`)
- **Executor** = external AI CLI (edits files, runs commands)

### Why Separate Planner from Executor?

AI CLI output includes logs, banners, tool output, and markdown — making JSON extraction unreliable. The internal AI API returns clean JSON via `response_format: json_object`.

## AI Planner Contract

Configuration: `.flowtask/config.json` → `ai.providers.openai`, env `OPENAI_API_KEY`.

If the planner returns invalid output, FlowTask will:

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
