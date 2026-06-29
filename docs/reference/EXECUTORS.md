# Executor Configuration Reference

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** users

Executors are configured in `.flowtask/config.json` under the `executors` key.

## Input Modes

| Mode       | How Context Is Passed                | Best For                        |
| ---------- | ------------------------------------ | ------------------------------- |
| `stdin`    | Written to process stdin             | opencode, claude, codex, gemini |
| `argument` | Appended as final CLI argument       | aider (`--message`)             |
| `file`     | Path written via `--file <path>` arg | Custom tools needing file input |

## Default Presets

```json
{
  "executors": {
    "shell": {
      "type": "shell",
      "args": [],
      "inputMode": "argument",
      "timeoutMs": 1800000
    },
    "opencode": {
      "type": "command",
      "command": "opencode",
      "args": ["run"],
      "inputMode": "stdin",
      "timeoutMs": 1800000
    },
    "claude": {
      "type": "command",
      "command": "claude",
      "inputMode": "stdin",
      "timeoutMs": 1800000
    },
    "codex": {
      "type": "command",
      "command": "codex",
      "inputMode": "stdin",
      "timeoutMs": 1800000
    },
    "gemini": {
      "type": "command",
      "command": "gemini",
      "inputMode": "stdin",
      "timeoutMs": 1800000
    },
    "aider": {
      "type": "command",
      "command": "aider",
      "args": ["--message"],
      "inputMode": "argument",
      "timeoutMs": 1800000
    }
  }
}
```

## Running with a Specific Executor

```bash
flowtask run "update readme" --executor opencode
flowtask run "update readme" --executor claude
flowtask run "update readme" --executor codex
flowtask run "update readme" --executor shell
```
