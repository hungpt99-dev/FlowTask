# Codegraph

Codegraph indexes the FlowTask codebase for AI-assisted development.

## What It Does

Codegraph creates a searchable index of:

- Functions, methods, classes, interfaces
- Caller/callee relationships
- File dependencies

This helps AI coding agents understand the codebase quickly.

## Triggering

Run manually:

```bash
pnpm codegraph
```

Or it runs automatically in the pre-commit hook (`scripts/codegraph-trigger.mjs`).

## When Codegraph Is Not Available

The codegraph trigger script handles missing installations gracefully:

- Checks for `codegraph` or `codegraph-cli`
- If not found, prints a warning and exits with code 0
- Never blocks commits or CI

## Benefits

- Faster codebase exploration for AI agents
- Accurate symbol resolution without grep/file search
- Better context for edits — see callers and callees instantly
- Reduces round-trips when understanding code

## Setup

Codegraph must be installed separately. See [Codegraph documentation](https://opencode.ai) for installation instructions.
