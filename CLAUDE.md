# FlowTask Claude Code Instructions

## About

FlowTask is a local-first AI task runtime CLI. It orchestrates AI CLI tools to execute work as structured task flows.

## Reference Documents

- `docs/IDEA.MD` — Product concept, user value, core behavior
- `docs/TECHNICAL.MD` — Technical architecture, stack, design
- `docs/AI_AGENT_RULES.md` — AI agent behavior rules
- `docs/CODE_QUALITY.md` — Code quality standards
- `AGENTS.md` — AI agent instructions (must read)
- `README.md` — Current project status and commands

## Key Technical Decisions

| Decision        | Choice                                |
| --------------- | ------------------------------------- |
| Language        | TypeScript strict mode, no `any`      |
| Schemas         | zod                                   |
| CLI framework   | commander                             |
| Build tool      | tsup → dist/index.js                  |
| Testing         | vitest                                |
| Runtime         | Node.js 22+                           |
| Package manager | pnpm                                  |
| Shell detection | `getShell()` utility (cross-platform) |
| Path handling   | `path.join` only                      |

## Architecture

FlowTask orchestrates; AI CLI tools execute.

- FlowTask manages: project, runs, tasks, rules, state, logs, artifacts, validation, resume, retry, reports
- AI CLI handles: coding, editing files, writing docs, debugging

## Source Map

- `src/cli/` — Commander CLI entry points (thin, no business logic)
- `src/core/` — Domain managers + run lifecycle
- `src/rules/` — Rule loading, glob expansion, merging
- `src/planner/` — Task plan generation (SimplePlanner)
- `src/context/` — Context pack builder for AI executors
- `src/executor/` — Executor adapters (shell, command, manual)
- `src/validation/` — Validation engine + validators (process, file, command)
- `src/safety/` — Safety checker, approval manager, secret redactor
- `src/schemas/` — Zod schemas for all domain objects
- `src/config/` — Configuration loading with zod validation
- `src/utils/` — Shared utilities (fs, paths, ids, time, process, errors, glob, shell)

## Planner Modes

| Mode     | Description                                                               |
| -------- | ------------------------------------------------------------------------- |
| `simple` | Always uses fixed 7-task template. Never calls AI planner.                |
| `ai`     | Uses internal AI API provider (OpenAI). Fails if output is invalid.       |
| `auto`   | Tries internal AI API. Falls back to simple planner if invalid. (Default) |

## AI Provider Architecture

FlowTask uses dedicated AI provider implementations for planning:

- **OpenAI** — native `/chat/completions` with `response_format: json_object`
- **OpenAI-Compatible** — OpenRouter, DeepSeek, Groq, LM Studio, Together, Fireworks
- **Anthropic** — native `/v1/messages` API (no OpenAI response_format)
- **Gemini** — native `generateContent` API with `responseMimeType`
- **Mistral** — native `/chat/completions` API
- **Azure OpenAI** — deployment-based provider
- **Ollama** — native `/api/chat` with NDJSON streaming
- **Custom** — via provider registration API

All providers support: response_format fallback, SSE/NDJSON streaming, health checks.

## Architecture: Planner vs Executor

FlowTask intentionally separates planning from execution:

- **Planner** = internal AI API via dedicated provider — returns structured JSON
- **Executor** = external AI CLI (opencode, claude, codex, aider) — edits files, runs commands

This separation exists because AI CLI output includes logs, banners, tool output, and markdown — making JSON extraction unreliable. The internal AI API returns clean JSON via `response_format: json_object`.

## AI Planner Contract

- Configuration: `.flowtask/config.json` → `ai.providers.<name>`, env `<NAME>_API_KEY`
- The planner uses `response_format: json_object` for structured output
- If the provider does not support native JSON mode, FlowTask retries without it and uses strict JSON prompting
- If the planner returns prose, FlowTask extracts JSON from common formats, retries once, and falls back to simple planner in `auto` mode
- Raw planner output is saved to `.flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-1.txt` for debugging

## Key Rules

- No `any` types
- No default exports
- No hardcoded `sh` — use `getShell()`
- No hardcoded `/tmp` in tests — use `testDir`
- No `exec` — always `spawn`
- Atomic writes for all state files
- Secrets redacted before logging
