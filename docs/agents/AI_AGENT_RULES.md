# FlowTask AI Agent Rules

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** ai-agents

This is the **single source of truth** for all AI agent rules. It consolidates content from `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/flowtask.mdc`, and the now-relocated `docs/AI_AGENT_RULES.md` and `docs/CODE_QUALITY.md`.

---

## Before Working

Read these documents before making any changes:

1. `docs/design/IDEA.md` — Product concept, user value, core behavior
2. `docs/design/TECHNICAL.md` — Technical architecture, stack, design decisions
3. `docs/README.md` — Documentation index
4. `README.md` — Project overview, status, commands, and development loop

---

## Code Standards

- **TypeScript strict mode** required. No `any` types.
- **zod** for all schema validation.
- **Named exports only** — no default exports.
- `path.join` for file paths (cross-platform, never string concatenation).
- `path.isAbsolute` for path detection (never `startsWith("/")`).
- `getShell()` / `getShellCommandFlag()` from `src/utils/shell.ts` (never hardcoded `"sh"` or `"-c"`).
- `spawn` from `child_process` for subprocesses (never `exec`).
- **Atomic writes** for all state files — write to `.tmp` then rename.
- **Keep modules small** — ~200 lines max, one responsibility per module.
- **CLI commands must be thin** — parse arguments, delegate to services, format output. No business logic in CLI files.

---

## Planner Modes

| Mode     | Description                                                             |
| -------- | ----------------------------------------------------------------------- |
| `simple` | Always uses fixed 7-task template. Never calls AI planner.              |
| `ai`     | Uses internal AI API provider. Fails if output is invalid after retry.  |
| `auto`   | Tries internal AI API. Falls back to `simple` if invalid. **(Default)** |

---

## AI Provider Architecture

FlowTask uses dedicated AI provider implementations for planning:

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

Features shared by all providers:

- `response_format` fallback — retries without JSON mode if the provider does not support native `response_format: json_object`
- SSE/NDJSON streaming support
- Provider health checks
- Custom provider registration API (`ProviderRegistry.registerProviderType`)

### Architecture: Planner vs Executor

FlowTask intentionally separates planning from execution:

- **Planner** = internal AI API via dedicated provider — returns structured JSON
- **Executor** = external AI CLI (opencode, claude, codex, aider) — edits files, runs commands

This separation exists because AI CLI output includes logs, banners, tool output, and markdown — making JSON extraction unreliable. The internal AI API returns clean JSON via `response_format: json_object`.

---

## AI Planner Contract

- **Configuration:** `.flowtask/config.json` → `ai.providers.<name>`, env `<NAME>_API_KEY`
- The planner uses `response_format: json_object` for structured output
- If the provider does not support native JSON mode, FlowTask retries without it and uses strict JSON prompting

**Invalid output handling:**

1. Extract JSON from common formats (raw JSON, fenced ```json blocks, balanced braces)
2. Save raw output to `.flowtask/runs/<runId>/outputs/` for debugging
3. Retry once with a JSON-repair prompt
4. Fall back to `simple` planner in `auto` mode, or fail with a clear error in `ai` mode

---

## Validation Rule

Never trust "AI says done". Trust evidence:

- Process exits successfully
- Required files exist
- Validation commands pass
- No dangerous action was detected

---

## Quality Requirements

`pnpm quality` must pass before committing. This runs: typecheck + lint + format:check + tests.

Use `pnpm quality:fix` for auto-fixable lint and formatting issues.

---

## Scope Discipline

- No databases
- No web UIs
- No cloud features
- No unnecessary dependencies
- No bypassing safety or validation

---

## Testing

- Every feature needs tests. Regression tests for bugs.
- Use `testDir` from `tests/setup.ts` — never hardcode `/tmp`.
- Tests must pass before marking work complete.

---

## Cross-Platform

Support Windows, macOS, and Linux:

- `path.join` for file paths
- `path.isAbsolute` for path detection
- `getShell()` / `getShellCommandFlag()` for shell commands
- `spawn` (not `exec`) for subprocesses
- No hardcoded Unix paths (e.g. `/tmp`, `"sh"`)
- `fast-glob` for glob expansion (not Unix `find`)
