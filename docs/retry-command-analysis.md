# Retry Command Analysis — Extension Points for Additional Instructions & Resume

## Overview

The `retryCommand` function (`src/cli/commands/retry.command.ts:10`) retries failed/interrupted tasks from a previous run. It supports `--failed-only`, `--from <taskId>`, `--force`, `--dry-run`, `--continue`, and `--skip-validation` flags.

## Current Flow

1. Resolve `runId` (from `--run`, active state, or last run)
2. Load all tasks for the run via `RunManager.loadTasks()`
3. Filter tasks to retry:
   - `--failed-only`: all failed/interrupted tasks
   - `--from <id>`: slice from matching task onward
   - default: single task by `taskIdOrRunId`
4. Filter by retryable status (failed/interrupted, or force)
5. For each retryable task:
   - Build a context pack via `ContextPackBuilder.build()` with `isRetry: true` and `errorLog` (last 2000 chars of previous output)
   - Write context pack to `.flowtask/runs/<runId>/context-pack.<taskId>.retry_N.md`
   - Set task status → `pending`
   - Execute via `runLifecycle.executeSingleTask(runId, taskId)`
6. If `--continue` and any success: call `runLifecycle.continueRun(runId)`

## Key Interfaces & Classes

### `ContextPackInput` (`src/context/context-pack-builder.ts:8`)

```typescript
interface ContextPackInput {
  prompt: string;
  rulesContext: string;
  run: Run;
  task: Task;
  completedTasks: Task[];
  errorLog?: string;
  isRetry: boolean;
}
```

### `ContextPackBuilder.build()` (`src/context/context-pack-builder.ts:19`)

Concatenates sections: Retry Context → Original User Prompt → Current Task → Project Rules → Completed Tasks → Acceptance Criteria → Validation Commands → Expected Outputs → Instructions. **No "Additional Instructions" section exists.**

### `retryCommand` options type (`src/cli/commands/retry.command.ts:12`)

```typescript
options: {
  run?: string;
  continue?: boolean;
  force?: boolean;
  dryRun?: boolean;
  failedOnly?: boolean;
  from?: string;
  skipValidation?: boolean;
}
```

**No `instructions` or `additionalInstructions` field exists.**

## Extension Points for "Retry with Additional Instructions"

### 1. CLI Options — add `--instruction` (repeatable) or `--instructions-file`

- **File**: `src/cli/commands/retry.command.ts` — options type (line 12)
- Also: command registration in `src/cli/index.ts`

### 2. Context Pack — add `additionalInstructions` to `ContextPackInput`

- **File**: `src/context/context-pack-builder.ts` — `ContextPackInput` interface (line 8) and `build()` method (line 19)
- Add a new section in the markdown output after "Project Rules" (or after "Instructions" at the bottom)

### 3. Context Pack Builder — render the new section

- **File**: `src/context/context-pack-builder.ts` — `build()` method
- New section: `## Additional Instructions` with user-supplied text

### 4. Retry loop — pass instructions through build

- **File**: `src/cli/commands/retry.command.ts` — around line 164 where `contextBuilder.build()` is called
- Pass `{ ...retryPack, additionalInstructions: ... }` into `ContextPackInput`

### 5. Dry-run — display instructions

- **File**: `src/cli/commands/retry.command.ts` — dry-run branch (line 99)
- Show the additional instructions in the dry-run output

## Extension Points for "Resume with Additional Instructions"

### 1. Resume Command options

- **File**: `src/cli/commands/resume.command.ts:10`
- Add `--instruction` / `--instructions-file` to the resume options

### 2. Resume flow — inject into context before continue

- **File**: `src/cli/commands/resume.command.ts` — around line 135 (`lifecycle.continueRun()`)
- Before continuing, update the task context packs (or pass additional instructions into RunLifecycle)

### 3. RunLifecycle.continueRun()

- **File**: `src/core/run-lifecycle.ts`
- Currently doesn't accept additional instructions. Would need to thread them to per-task context building.

### 4. RunLifecycle.executeSingleTask()

- **File**: `src/core/run-lifecycle.ts`
- Builds context pack internally during task execution. Consider whether additional instructions should be baked into the task metadata or passed as a side channel.

## Integration Notes

- **ContextPackBuilder** is the natural injection point — a new `additionalInstructions?: string` field on `ContextPackInput`, rendered as a dedicated markdown section, gives the AI executor the extra guidance.
- The retry loop constructs a `ContextPackInput` object around line 164. This is where the new field should be wired in.
- For resume, the instructions need to be applied to pending/interrupted tasks before they execute. The simplest path: add instructions to the task's `metadata` field in the run store, or pass them through `RunLifecycle.continueRun()`.

## Files to Modify (ordered by priority)

| Priority | File                                     | Change                                                                  |
| -------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| 1        | `src/context/context-pack-builder.ts:8`  | Add `additionalInstructions?: string` to `ContextPackInput`             |
| 2        | `src/context/context-pack-builder.ts:19` | Render `## Additional Instructions` section in `build()`                |
| 3        | `src/cli/commands/retry.command.ts:12`   | Add `instruction?: string[]` to options type                            |
| 4        | `src/cli/commands/retry.command.ts:164`  | Pass instructions into `contextBuilder.build()`                         |
| 5        | `src/cli/commands/retry.command.ts:99`   | Display instructions in dry-run                                         |
| 6        | `src/cli/commands/resume.command.ts:10`  | Add `instruction` option                                                |
| 7        | `src/cli/commands/resume.command.ts:135` | Thread instructions through `continueRun()` or pre-apply to tasks       |
| 8        | `src/core/run-lifecycle.ts`              | Accept and forward additional instructions in `continueRun()` if needed |
