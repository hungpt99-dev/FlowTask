# Retry Logic Bug Analysis

## Summary

The `retryCommand` in `src/cli/commands/retry.command.ts` has two related bugs:

1. **`retryCount` is never persisted** back to the task after a retry attempt.
2. **Error state is never cleared** from the task or run when a retry begins or succeeds.

These bugs cause `retryCount` to remain at 0 and stale error state to persist even after a retry succeeds.

---

## Root Cause 1: `retryCount` never written to task

### `src/cli/commands/retry.command.ts:145-254` — retry loop

At line 161, `newRetryCount` is computed but never persisted:

```typescript
const newRetryCount = task.retryCount + 1; // computed
// ...
await runManager.updateTaskStatus(runId, indTaskId, "pending"); // only sets status
const success = await runLifecycle.executeSingleTask(runId, indTaskId);
```

Neither `updateTaskStatus` nor `executeSingleTask` writes `newRetryCount` back to the task.

### `src/core/run-manager.ts:370-379` — `updateTaskStatus`

```typescript
async updateTaskStatus(runId, taskId, status): Promise<Task> {
  const tasks = await this.loadTasks(runId);
  const idx = tasks.findIndex((t) => t.id === taskId);
  const existing = tasks[idx]!;
  const updated = { ...existing, status, updatedAt: now() };  // only status + updatedAt
  tasks[idx] = updated;
  await this.saveTasks(runId, tasks);
  return updated;
}
```

This method only spreads `status` and `updatedAt` — it does not accept or write `retryCount`.

### `src/core/run-lifecycle.ts:1557-2419` — `executeTask`

Inside `executeTask`, there is a **local** `let retryCount = 0` (line 1688) that tracks internal auto-retries (do-while loop at line 1697). This local variable is used for logging and loop control but is **never persisted** to the task record.

### `src/core/run-manager.ts:381-396` — `updateTask`

The `updateTask` method is called in `retry.command.ts:176` but only for `description` updates. Its type signature also does not accept `retryCount`:

```typescript
async updateTask(runId, taskId, updates: Partial<
  Pick<Task, "title" | "description" | "executor" | "acceptanceCriteria" | "validation">
>): Promise<Task> {
```

`retryCount` and `status` are both excluded from the accepted update keys.

---

## Root Cause 2: Error state never cleared

### No error cleanup before retry

When `retryCommand` sets the task status to `"pending"` at line 209, it does not:

- Clear `run.errors[]` (stored via `addRunError` in `src/core/run-manager.ts:529`)
- Clear the task's error-related fields
- Decrement `run.errorCount`
- Clear task output logs

### Error persists through success

After a successful retry:

- Task status → `"done"` (via `executeTask` → `updateTaskStatus`)
- The error added to `run.errors[]` from the original failure remains
- `run.errorCount` stays at whatever it was after the first failure

### `addRunError` (`src/core/run-manager.ts:529-544`)

Errors are appended to `run.errors[]` by `recordError` → `addRunError`. There is no corresponding "clear errors for task" method called during retry.

---

## Affected files

| File                                | Lines            | Issue                                                                              |
| ----------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `src/cli/commands/retry.command.ts` | 161, 209, 224    | `newRetryCount` computed but never stored; no error cleanup before/after retry     |
| `src/core/run-manager.ts`           | 370-379, 381-396 | `updateTaskStatus` / `updateTask` don't accept/update `retryCount` or clear errors |
| `src/core/run-lifecycle.ts`         | 1688, 2262, 2272 | Local `retryCount` variable never persisted to task                                |

---

## Fix approach

1. **In `retry.command.ts`**, after `executeSingleTask` succeeds:
   - Use `updateTask` (or a new method) to persist `newRetryCount` to the task
   - Clear the run errors related to this task (or call a new `clearTaskErrors` method)
   - Decrement `run.errorCount` appropriately

2. **In `run-manager.ts`**, either:
   - Extend `updateTaskStatus` to accept optional `retryCount` updates (risks scope creep)
   - Or add a dedicated `incrementTaskRetryCount(runId, taskId)` method
   - Add a `clearTaskErrors(runId, taskId)` method

3. **In `run-manager.ts`**, extend `updateTask` to accept `retryCount` and `status` so retry-specific fields can be updated atomically.
