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

## Lifecycle Hooks

FlowTask supports user-defined lifecycle hooks — shell commands that execute at specific lifecycle points. Configured in `.flowtask/config.json`:

```json
{
  "hooks": {
    "beforeRun": [],
    "afterRun": [],
    "beforeTask": [],
    "afterTask": [],
    "beforeRetry": [],
    "afterRetry": [],
    "onFailure": [],
    "failOnError": false
  }
}
```

Hook points: `beforeRun`, `afterRun`, `beforeTask`, `afterTask`, `beforeRetry`, `afterRetry`, `onFailure`.
Context is passed via environment variables (`HOOK_RUN_ID`, `HOOK_TASK_ID`, etc.).

## Interactive Retry Approval

When a task fails after exhausting `maxRetries`, FlowTask prompts the user interactively (TTY only) before additional retries. If approved, the retry counter resets. In non-TTY/auto modes, retries skip automatically.

## Interactive Task Approval

In `manual` mode with TTY available, task approval prompts happen inline instead of pausing the run. Non-TTY environments fall back to the original pause-and-wait behavior.

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

## AI Provider Architecture

FlowTask supports **dedicated AI provider classes** for planning:

| Provider          | Type                 | Endpoint            |
| ----------------- | -------------------- | ------------------- |
| OpenAI            | `openai`             | `/chat/completions` |
| OpenAI-Compatible | `openai-compatible`  | `/chat/completions` |
| Anthropic         | `anthropic`          | `/v1/messages`      |
| Gemini            | `gemini`             | `generateContent`   |
| Mistral           | `mistral`            | `/chat/completions` |
| Azure OpenAI      | `azure-openai`       | deployment-based    |
| Ollama            | `ollama`             | `/api/chat`         |
| Custom            | via registration API | configurable        |

Features:

- `response_format` fallback (retries without JSON mode if unsupported)
- SSE/NDJSON streaming support
- Provider health checks
- Custom provider registration API

### Why Separate Planner from Executor?

AI CLI output includes logs, banners, tool output, and markdown — making JSON extraction unreliable. The internal AI API returns clean JSON via `response_format: json_object`.

## AI Planner Contract

Configuration: `.flowtask/config.json` → `ai.providers.<name>`, env `<NAME>_API_KEY`.

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
