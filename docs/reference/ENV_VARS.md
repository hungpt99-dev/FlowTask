# Environment Variable Reference

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** users

## AI Provider API Keys

| Variable               | Provider     |
| ---------------------- | ------------ |
| `OPENAI_API_KEY`       | OpenAI       |
| `ANTHROPIC_API_KEY`    | Anthropic    |
| `GEMINI_API_KEY`       | Gemini       |
| `MISTRAL_API_KEY`      | Mistral      |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI |

API keys can also be stored in `~/.flowtask/secrets.json` via `flowtask setup`.

## Hook Context Variables

These environment variables are passed to lifecycle hook commands:

| Variable           | Description                              |
| ------------------ | ---------------------------------------- |
| `HOOK_RUN_ID`      | Current run ID                           |
| `HOOK_TASK_ID`     | Current task ID                          |
| `HOOK_TASK_TITLE`  | Current task title                       |
| `HOOK_RETRY_COUNT` | Current retry attempt number             |
| `HOOK_MAX_RETRIES` | Maximum retries configured               |
| `HOOK_SUCCESS`     | Whether the previous operation succeeded |
| `HOOK_ROOT_PATH`   | Project root path                        |
| `HOOK_ERROR`       | Error message (on failure hooks)         |
