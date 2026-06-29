# Lifecycle Hooks Reference

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** users

FlowTask supports user-defined shell commands that execute at specific lifecycle points.

## Configuration

Configured in `.flowtask/config.json` under the `hooks` key:

```json
{
  "hooks": {
    "beforeRun": ["echo 'Run started: $HOOK_RUN_ID'"],
    "afterRun": ["echo 'Run finished with success: $HOOK_SUCCESS'"],
    "beforeTask": ["echo 'Starting task: $HOOK_TASK_TITLE'"],
    "afterTask": ["echo 'Task completed with success: $HOOK_SUCCESS'"],
    "beforeRetry": ["echo 'Retrying task: $HOOK_TASK_TITLE ($HOOK_RETRY_COUNT/$HOOK_MAX_RETRIES)'"],
    "afterRetry": ["echo 'Retry attempt completed'"],
    "onFailure": ["echo 'Task failed: $HOOK_TASK_TITLE — $HOOK_ERROR'"],
    "failOnError": false
  }
}
```

## Hook Points

| Hook          | Trigger                  | Environment Variables                                                                 |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `beforeRun`   | After run creation       | `HOOK_RUN_ID`, `HOOK_ROOT_PATH`                                                       |
| `afterRun`    | After run completion     | `HOOK_RUN_ID`, `HOOK_SUCCESS`                                                         |
| `beforeTask`  | Before each task         | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_TASK_TITLE`                                      |
| `afterTask`   | After each task          | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_TASK_TITLE`, `HOOK_SUCCESS`                      |
| `beforeRetry` | Before each retry        | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_RETRY_COUNT`, `HOOK_MAX_RETRIES`                 |
| `afterRetry`  | After each retry attempt | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_RETRY_COUNT`, `HOOK_MAX_RETRIES`, `HOOK_SUCCESS` |
| `onFailure`   | Run/task failure         | `HOOK_RUN_ID`, `HOOK_TASK_ID`, `HOOK_TASK_TITLE`, `HOOK_ERROR`                        |

## Behavior

- When `failOnError` is `true`, a failing hook aborts the run
- When `failOnError` is `false` (default), hook failures are logged but execution continues
- Hooks execute using `getShell()` for cross-platform support
- Context is passed via environment variables
