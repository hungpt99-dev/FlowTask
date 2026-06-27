# FlowTask Code Quality & Best Practices Improvement Plan

## Priority Legend

| Label | Description                                                |
| ----- | ---------------------------------------------------------- |
| P0    | Critical — blocks correctness, security, or causes crashes |
| P1    | High — significant quality impact, maintainability         |
| P2    | Medium — good practice, moderate gains                     |
| P3    | Low — nice to have, cleanup                                |

**Note:** This plan covers issues **not already addressed** in the existing `docs/IMPROVEMENT_PLAN.md` (Section 3: Code Quality & Best Practices). Issues like massive file sizes (3.1), AI provider duplication (3.2), dead code (3.3), `Record<string, unknown>` casting (3.4), silent catch blocks (3.5), magic strings (3.6), CLI business logic (3.7), generate/stream separation (3.8), and input size validation (3.9) are already documented there.

---

## 1. TypeScript Config & Strictness Gaps

### 1.1 Enable `noUnusedLocals` and `noUnusedParameters` (P1)

**Problem:** `tsconfig.json` lines 11-12 set both to `false`, allowing dead parameters and unused variables to pass typecheck. ESLint catches some but not all — and typecheck is the stricter gate.

**Impact:** Dead code accumulates silently. Refactoring leaves orphaned variables.

**Action:**

1. Set `noUnusedLocals: true` and `noUnusedParameters: true` in `tsconfig.json`.
2. Fix all resulting errors (~19 from eslint alone, potentially more caught by `tsc`):
   - `src/cli/commands/providers.command.ts` — remove unused imports (5 declared but unused)
   - `src/cli/commands/setup.command.ts` — remove unused imports (5)
   - `src/core/project-manager.ts` — remove unused imports (2)
   - `src/validation/validation-runner.ts` — remove unused `SpawnOptions`
   - Test files with unused imports (`init-command.test.ts`, `setup-command.test.ts`)
3. Use `_` prefix for intentionally unused parameters (e.g., `_req`, `_res`).

**Files:** `tsconfig.json:11-12`
**Effort:** ~1h

---

## 2. Code Duplication

### 2.1 Duplicate `stripAnsi()` Function (P2)

**Problem:** `stripAnsi()` is defined identically in two files:

- `src/utils/stream-lines.ts:1`
- `src/utils/stream-parser.ts:3`

The `stream-parser.ts` version is **never imported** anywhere — only `stream-lines.ts` version is used.

**Impact:** Dead code to maintain. If one is updated and the other is not, inconsistency arises.

**Action:**

1. Remove `stripAnsi` from `src/utils/stream-parser.ts`.
2. Import from `src/utils/stream-lines.ts` if `stream-parser.ts` ever needs it.

**Files:** `src/utils/stream-parser.ts:3`
**Effort:** ~10min

### 2.2 Dead Function `writeJsonFile()` (P2)

**Problem:** `src/utils/fs.ts:39` exports `writeJsonFile()` which writes directly without atomic temp file. The codebase uses `atomicWriteJsonFile()` everywhere instead. Search shows zero callers of `writeJsonFile()`.

**Impact:** Dead code. Misleading API surface — future developers may use the non-atomic variant.

**Action:**

1. Remove `writeJsonFile()` export.
2. Keep `atomicWriteJsonFile()` as the sole JSON write utility.

**Files:** `src/utils/fs.ts:39-43`
**Effort:** ~10min

### 2.3 Dead Method `ExecutorRegistry.listPresets()` (P2)

**Problem:** `src/executor/executor-registry.ts:79-81` defines `listPresets()` returning registered executor keys. No caller exists in source or tests.

**Impact:** Dead code.

**Action:**

1. Remove the method.
2. Or add a caller if it serves a future purpose.

**Files:** `src/executor/executor-registry.ts:79-81`
**Effort:** ~10min

### 2.4 Dead Method `EventBus.on()` (P2)

**Problem:** `src/ui/event-bus.ts:118-120` defines `on()` as an alias for `addListener` with default options. All consumers use `subscribe()`, `subscribeSync()`, or `emit()` — never `on()`.

**Impact:** Dead code.

**Action:**

1. Remove `EventBus.on()`.
2. Ensure all consumers use the canonical subscription methods.

**Files:** `src/ui/event-bus.ts:118-120`
**Effort:** ~10min

### 2.5 Duplicate Executor Definitions in `default-config.ts` (P2)

**Problem:** `src/config/default-config.ts` defines `DEFAULT_EXECUTORS` constant (lines 3-48), then repeats nearly identical definitions inside `generateDefaultConfig()` (lines 134-178).

**Impact:** Maintenance hazard — adding/modifying an executor requires changes in two places.

**Action:**

1. Make `generateDefaultConfig()` reference `DEFAULT_EXECUTORS` instead of duplicating.
2. Verify all tests still pass.

**Files:** `src/config/default-config.ts:134-178`
**Effort:** ~30min

### 2.6 Secret Store Path Duplication (P2)

**Problem:** Both `src/config/secret-store.ts:11` and `src/config/credential-resolver.ts:10` define:

```typescript
path.join(homedir(), ".flowtask", "secrets.json");
```

The `credential-resolver.ts` version does NOT respect `FLOWTASK_SECRETS_PATH` env var, unlike `secret-store.ts`.

**Impact:** Inconsistent behavior. If secrets path is overridden via env var, `credential-resolver.ts` still reads from default location.

**Action:**

1. Extract a shared `getSecretsPath()` utility function in `src/utils/paths.ts`.
2. Both files call the shared function.
3. Ensure `credential-resolver.ts` respects `FLOWTASK_SECRETS_PATH`.

**Files:** `src/config/secret-store.ts:11`, `src/config/credential-resolver.ts:10`
**Effort:** ~30min

### 2.7 Unused Import Warnings (P1)

**Problem:** ESLint reports 19 `@typescript-eslint/no-unused-vars` warnings across 6 files:

| File                                    | Unused imports                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `src/cli/commands/providers.command.ts` | `listSetupProviders`, `fileExists`, `FLOWTASK_DIR`, `path`                      |
| `src/cli/commands/setup.command.ts`     | `ProjectManager`, `mergeProviderConfigs`, `fileExists`, `FLOWTASK_DIR`, `path`  |
| `src/core/project-manager.ts`           | `ProjectModeSchema`, `VALID_PROJECT_MODES`                                      |
| `src/validation/validation-runner.ts`   | `SpawnOptions`                                                                  |
| `tests/cli/init-command.test.ts`        | `fileExists`, `readTextFile`, `writeTextFile`, `readJsonFile`, `configJsonPath` |
| `tests/cli/setup-command.test.ts`       | `getSecretStore`, `credentialRef`                                               |

**Impact:** Code noise, dead imports, potential confusion for maintainers.

**Action:**

1. Remove all unused imports from each file.
2. Verify no functionality is broken (the imports are unused by definition).

**Effort:** ~30min

---

## 3. Module Layer Violations

### 3.1 `picocolors` in Core/Planner Modules (P1)

**Problem:** The `CODE_QUALITY.md` rule "Core modules do not import presentation-layer libraries (picocolors, ora)" is violated in:

- `src/core/run-lifecycle.ts:28` — `import pc from "picocolors"`
- `src/planner/ai-planner.ts:3` — `import pc from "picocolors"`
- `src/planner/internal-ai-planner.ts:2` — `import pc from "picocolors"`

These modules emit `console.log(pc.xxx(...))` output directly.

**Impact:** Core modules are coupled to terminal output. Cannot reuse programmatically. Test output is polluted with ANSI codes. Violates separation of concerns.

**Action:**

1. Remove all `console.log` + `picocolors` calls from core/planner modules.
2. Emit structured events via `EventBus` instead (e.g., `eventBus.emit("planner:progress", { message })`).
3. Move coloring to the renderer layer (`plain-renderer.ts`, `rich-renderer.ts`).
4. The renderers subscribe to these events and format output with picocolors.

**Files:** `src/core/run-lifecycle.ts:28`, `src/planner/ai-planner.ts:3`, `src/planner/internal-ai-planner.ts:2`
**Effort:** ~2h

### 3.2 `EventBus` in UI Layer Imported by Core Modules (P1)

**Problem:** `src/ui/event-bus.ts` is in the UI layer but is imported by business logic modules:

| File                                     | Import     |
| ---------------------------------------- | ---------- |
| `src/validation/validation-runner.ts:10` | `EventBus` |
| `src/executor/shell-executor.ts:5`       | `EventBus` |
| `src/executor/command-executor.ts:8`     | `EventBus` |
| `src/planner/internal-ai-planner.ts:17`  | `EventBus` |
| `src/core/run-lifecycle.ts:29`           | `EventBus` |

This creates an inverted dependency — core depends on UI instead of UI depending on core.

**Impact:** Circular dependency risk. Violates layered architecture. Makes it hard to swap UI frameworks.

**Action:**

1. Move `EventBus` to a neutral shared layer: `src/events/event-bus.ts`.
2. Re-export from `src/ui/` for backward compatibility (or update all imports).
3. The event bus interface remains the same, but its location reflects its shared nature.

**Files:** `src/ui/event-bus.ts` → `src/events/event-bus.ts`
**Effort:** ~30min

### 3.3 `console.log` in Non-CLI Modules (P1)

**Problem:** Beyond picocolors usage, several non-CLI modules use `console.log` directly:

- `src/planner/ai-planner.ts:70,144,230,232,238`
- `src/planner/internal-ai-planner.ts:50,57,78,80,86,240,248`

**Impact:** Makes these modules untestable (output goes to stdout). Couples to terminal.

**Action:**

1. Replace all `console.log` in non-CLI modules with `LogManager` calls or `EventBus` emissions.
2. Only CLI commands and the renderer layer should call `console.log`.

**Effort:** ~1h (combined with 3.1)

### 3.4 Missing `index.ts` in `src/schemas/` (P3)

**Problem:** `src/schemas/` has 10 schema files but no barrel `index.ts`. Consumers import from individual file paths. While this follows "one module per file", it creates inconvenient import paths.

**Impact:** Import paths are verbose: `import { Task } from "../schemas/task.schema.js"` vs. `import { Task } from "../schemas/index.js"`.

**Action:**

1. Create `src/schemas/index.ts` that re-exports all public schemas.
2. Update consumers to import from the barrel (optional — existing paths still work).

**Files:** Create `src/schemas/index.ts`
**Effort:** ~20min

---

## 4. Cross-Platform Issues

### 4.1 Hardcoded `"which"` in `doctor.command.ts` (P1)

**Problem:** `src/cli/commands/doctor.command.ts:280` uses:

```typescript
await spawnWithPromise("which", [cmdName], { timeout: 3000 });
```

`which` does not exist on Windows. Meanwhile, `src/utils/command-exists.ts:15` correctly handles this with:

```typescript
spawnSync(platform() === "win32" ? "where" : "which", ...)
```

**Impact:** `flowtask doctor` crashes on Windows.

**Action:**

1. Replace the hardcoded `"which"` call with the existing `commandExists()` utility from `src/utils/command-exists.ts`.
2. Or use `commandExists` which is already cross-platform.

**Files:** `src/cli/commands/doctor.command.ts:280`
**Effort:** ~15min

### 4.2 `getShell()` Returns `"sh"` Not `$SHELL` (P3)

**Problem:** `src/utils/shell.ts:7` returns `"sh"` on Unix. On many systems, `sh` is `dash` (Debian/Ubuntu) which lacks bash features like `[[ ]]`, `source`, and process substitution. This can cause compatibility issues for validation commands.

**Impact:** Commands that expect bash syntax may fail when `sh` is `dash`.

**Action:**

1. Fall back to `process.env.SHELL` before defaulting to `"sh"`:
   ```typescript
   if (platform() === "win32") return "cmd.exe";
   return process.env.SHELL || "sh";
   ```
2. Verify all spawn calls work with bash as well as `sh`.

**Files:** `src/utils/shell.ts:7`
**Effort:** ~15min

---

## 5. Test Coverage & Quality

### 5.1 Untested Source Files (P1)

**Problem:** 45+ source files lack dedicated tests. Key modules with no tests:

| Category              | Missing Tests                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLI commands** (14) | `run.command.ts`, `resume.command.ts`, `cancel.command.ts`, `retry.command.ts`, `stop.command.ts`, `clean.command.ts`, `runs.command.ts`, `tasks.command.ts`, `logs.command.ts`, `inspect.command.ts`, `rules.command.ts`, `providers.command.ts`, `doctor.command.ts`, `status.command.ts` |
| **Config** (6)        | `mode-rules.ts`, `project-modes.ts`, `mode-steps.ts`, `secret-store.ts`, `default-config.ts`, `credential-resolver.ts`                                                                                                                                                                      |
| **Planner** (4)       | `internal-ai-planner.ts`, `feature.template.ts`, `bugfix.template.ts`, `docs.template.ts`                                                                                                                                                                                                   |
| **Executor** (3)      | `executor-registry.ts`, `executor-presets.ts`, `manual-executor.ts`                                                                                                                                                                                                                         |
| **Core** (2)          | `report-generator.ts`, `artifact-manager.ts`                                                                                                                                                                                                                                                |
| **Utils** (7)         | `time.ts`, `paths.ts`, `shell.ts`, `process.ts`, `errors.ts`, `command-exists.ts`, `glob.ts`                                                                                                                                                                                                |
| **Validation** (1)    | `process-validator.ts`                                                                                                                                                                                                                                                                      |
| **Git** (1)           | `git-service.ts`                                                                                                                                                                                                                                                                            |
| **Safety** (1)        | `approval-manager.ts`                                                                                                                                                                                                                                                                       |
| **Context** (1)       | `planner-context-builder.ts`                                                                                                                                                                                                                                                                |
| **AI** (1)            | `provider-presets.ts`                                                                                                                                                                                                                                                                       |
| **Quality** (1)       | `quality-gate.ts`                                                                                                                                                                                                                                                                           |
| **UI** (2)            | `task-format.ts`, `error-format.ts`                                                                                                                                                                                                                                                         |

**Impact:** No regression protection, refactoring risk, undetected bugs.

**Action:**

1. **Priority P1** — Write tests for: `internal-ai-planner.ts`, `run.command.ts`, `secret-store.ts`, `git-service.ts`, `process.ts`, `shell.ts`, `paths.ts`
2. **Priority P2** — Write tests for: all CLI commands, `report-generator.ts`, `artifact-manager.ts`, `quality-gate.ts`, `approval-manager.ts`
3. **Priority P3** — Write tests for: templates, `provider-presets.ts`, formatters, `mode-rules.ts`, `mode-steps.ts`

**Effort:** ~5-8 days for all (prioritize by usage frequency)

### 5.2 Hardcoded Unix Paths in Tests (P1)

**Problem:** 3 test files use hardcoded `/tmp` paths instead of `testDir` or `mkdtempSync`:

| File                                      | Line           | Violation                                        |
| ----------------------------------------- | -------------- | ------------------------------------------------ |
| `tests/executor/command-executor.test.ts` | 16, 27, 38, 50 | `contextPackPath: "/tmp/ctx.md"`                 |
| `tests/ai/api-key-validator.test.ts`      | 49             | `process.env.FLOWTASK_SECRETS_PATH = "/tmp/..."` |
| `tests/schemas/schema-validation.test.ts` | 14, 25         | `rootPath: "/tmp/test"`                          |

Additionally, `tests/executor/shell-executor.test.ts:31,57,83` and `command-executor.test.ts:96,138,193` use `contextPackPath: "/dev/null"` which is also Unix-only.

**Impact:** Tests fail on Windows. Violates project rules (`CODE_QUALITY.md` — "Do not hardcode Unix-only paths like `/tmp` in tests").

**Action:**

1. Replace all `/tmp/*` paths with `path.join(testDir, "ctx.md")` using `testDir` from test setup.
2. Replace `/dev/null` with platform-appropriate null device: `platform() === "win32" ? "nul" : "/dev/null"`, or use a temp empty file.

**Effort:** ~30min

### 5.3 Test Isolation: Shared Mutable State (P1)

**Problem:** Multiple test suites share mutable state across test cases, creating order-dependent tests:

| File                               | Issue                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `tests/core/state-manager.test.ts` | Same `StateManager` instance shared; `saveProjectState` persists across tests |
| `tests/core/event-store.test.ts`   | Same `EventStore` instance shared; events leak between tests                  |
| `tests/core/log-manager.test.ts`   | Single `LogManager` with one `runId`; logs accumulate across tests            |

**Impact:** Tests pass/fail depending on execution order. Flaky CI. False confidence.

**Action:**

1. Create fresh instances in `beforeEach()` for each test case.
2. Use separate temp directories per test or per describe block.
3. Remove shared state between tests.

**Effort:** ~1h

### 5.4 Test Isolation: `process.env` Pollution (P1)

**Problem:** Tests mutate `process.env` without restoring original values:

| File                                 | Issue                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `tests/cli/setup-command.test.ts`    | Sets `OPENAI_API_KEY`, `FLOWTASK_SECRETS_PATH` — only deletes on cleanup, doesn't restore original |
| `tests/ai/provider-registry.test.ts` | Sets then deletes `OPENAI_API_KEY` — original value lost if set                                    |
| `tests/ai/api-key-validator.test.ts` | Sets `FLOWTASK_SECRETS_PATH` in `beforeAll`, deletes in `afterAll` — leaks to other suites         |

**Impact:** Test pollution across suites. Existing environment variables get deleted.

**Action:**

1. Use a `saveEnv`/`restoreEnv` pattern: capture `process.env` snapshot in `beforeEach`, restore in `afterEach`.
2. Better: use a helper:
   ```typescript
   const savedEnv: Record<string, string | undefined> = {};
   function setEnv(key: string, value: string) {
     savedEnv[key] = process.env[key];
     process.env[key] = value;
   }
   // In afterEach:
   for (const [key, value] of Object.entries(savedEnv)) {
     if (value === undefined) delete process.env[key];
     else process.env[key] = value;
   }
   ```

**Effort:** ~30min

### 5.5 Test Isolation: `process.chdir` Mutation (P2)

**Problem:** `tests/cli/init-command.test.ts:17` and `tests/cli/setup-command.test.ts:19` call `process.chdir(projectDir)`, mutating the global CWD. If the test crashes, CWD is never restored, breaking subsequent tests.

**Impact:** Flaky tests on crash. Hard to debug.

**Action:**

1. Save original CWD before each test: `const originalCwd = process.cwd()`.
2. Restore in `afterEach`: `process.chdir(originalCwd)`.
3. Consider using a wrapper function to ensure restoration happens even on failure.

**Effort:** ~15min

### 5.6 Non-Deterministic Timestamps in Tests (P3)

**Problem:** Tests in `state-manager.test.ts`, `run-manager.test.ts`, `schema-validation.test.ts` use `new Date().toISOString()` for test data. While functionally correct, these values are non-deterministic and can mask timezone-related bugs.

**Impact:** Low risk, but non-ideal for deterministic testing.

**Action:**

1. Use fixed timestamps for test data: `new Date("2024-01-01T00:00:00.000Z").toISOString()`.
2. Or use a `const FIXED_DATE = "2024-01-01T00:00:00.000Z"` constant.

**Effort:** ~20min

### 5.7 Weak/Trivial Tests (P3)

**Problem:** Several tests are trivial constructor existence checks:

- `tests/validation/file-validator.test.ts:8-10` — `expect(validator).toBeInstanceOf(FileValidator)`
- `tests/core/event-store.test.ts:12-14` — same pattern
- `tests/stream.test.ts:42-44` — `_typeCheck` is undefined, test does nothing

**Impact:** Waste of test runtime. Gives false sense of coverage.

**Action:**

1. Replace trivial tests with meaningful behavior tests.
2. Remove tests that only check `toBeInstanceOf` without behavior verification.
3. Remove the no-op `_typeCheck` test.

**Effort:** ~30min

---

## 6. Error Handling & Safety

### 6.1 `process.exit()` Proliferation in CLI Commands (P2)

**Problem:** 47 `process.exit()` calls across CLI command files. `process.exit()` terminates the process immediately, preventing:

- Proper cleanup (temp files, log flushing)
- Testability (kills the test runner)

**Impact:** CLI commands are essentially untestable. Resource leaks on failure paths.

**Action:**

1. Replace `process.exit(code)` with `process.exitCode = code; return;` in functions that return promises.
2. For synchronous exit points, use `process.exitCode = code; throw new CliError()`.
3. Let the top-level `main()` function call `process.exit()` once if needed.

**Effort:** ~1h

### 6.2 Non-Null Assertions on Optional Config Fields (P2)

**Problem:** `config.planner!` (non-null assertion) is used extensively across the codebase:

- `src/core/run-lifecycle.ts` (multiple locations)
- `src/planner/internal-ai-planner.ts:45`
- `src/cli/commands/doctor.command.ts:119`
- `src/planner/planner-registry.ts:28-29,41,46-47,66-67`

If the planner config is somehow undefined, these silently produce undefined behavior instead of a clear error.

**Impact:** Silent failures. Hard-to-debug runtime errors.

**Action:**

1. Replace all non-null assertions with proper validation:
   ```typescript
   const plannerConfig = config.planner;
   if (!plannerConfig) {
     throw new FlowTaskError("Planner configuration is required");
   }
   ```
2. Or use zod's `.default()` to ensure the field is always populated.

**Effort:** ~1h

### 6.3 Untyped `catch (err)` Patterns (P2)

**Problem:** 35+ catch blocks use the pattern:

```typescript
catch (err) {
  const message = err instanceof Error ? err.message : String(err);
}
```

While this is correct, these should use the typed error classes from `src/utils/errors.ts`.

**Impact:** Inconsistent error handling. Loses typed error context (e.g., `FlowTaskError` with details).

**Action:**

1. Where the error is expected to be a `FlowTaskError` or subclass, use `catch (err: unknown)` with proper narrowing.
2. Add a helper: `function asError(err: unknown): Error { return err instanceof Error ? err : new Error(String(err)); }`.
3. Reference the helper from a single location rather than inlining the pattern.

**Effort:** ~1h

---

## 7. Formatting & Code Style

### 7.1 Unformatted Markdown Files (P3)

**Problem:** `pnpm format:check` reports 2 files not formatted by Prettier:

- `docs/IMPROVEMENT_PLAN.md`
- `docs/SECURITY_IMPROVEMENT_PLAN.md`

**Impact:** CI will fail on format check.

**Action:**

1. Run `pnpm format` or `prettier --write docs/IMPROVEMENT_PLAN.md docs/SECURITY_IMPROVEMENT_PLAN.md`.

**Effort:** ~2min

---

## 8. Test Infrastructure

### 8.1 Test Configuration Improvements (P1)

**Problem:** The `vitest.config.ts` has `pool: "forks"` but no explicit `poolOptions` for isolation. Tests that pollute global state (env vars, CWD, stdout) can affect parallel test execution.

**Impact:** Flaky test results in CI, especially with parallel workers.

**Action:**

1. Add `poolOptions.forks.singleFork: true` or configure `pool: "threads"` with proper isolation.
2. Add `test.globalSetup` and `test.globalTeardown` for environment setup/teardown.
3. Consider adding `test.bail: 1` to stop on first failure (for faster debugging).

**Effort:** ~30min

---

## Implementation Order

### Phase 1 — Immediate (P1 items)

| #   | Item                                                          | Effort |
| --- | ------------------------------------------------------------- | ------ |
| 1   | 1.1 Enable `noUnusedLocals`/`noUnusedParameters` + fix errors | ~1h    |
| 2   | 4.1 Hardcoded `"which"` in doctor.command.ts                  | ~15min |
| 3   | 5.2 Hardcoded `/tmp` and `/dev/null` in tests                 | ~30min |
| 4   | 5.4 Fix `process.env` pollution in tests                      | ~30min |
| 5   | 3.2 Move EventBus to shared layer                             | ~30min |
| 6   | 2.7 Remove 19 unused imports                                  | ~30min |

### Phase 2 — Short-term (P1-P2)

| #   | Item                                               | Effort    |
| --- | -------------------------------------------------- | --------- |
| 7   | 3.1 Remove picocolors from core/planner modules    | ~2h       |
| 8   | 3.3 Replace `console.log` in non-CLI modules       | ~1h       |
| 9   | 5.1 Write tests for high-priority untested modules | ~3-4 days |
| 10  | 5.3 Fix shared mutable state in tests              | ~1h       |
| 11  | 5.5 Fix `process.chdir` mutation in tests          | ~15min    |
| 12  | 6.2 Remove non-null assertions on config fields    | ~1h       |

### Phase 3 — Medium-term (P2)

| #   | Item                                                 | Effort |
| --- | ---------------------------------------------------- | ------ |
| 13  | 2.1-2.5 Remove all dead code and duplicates          | ~1h    |
| 14  | 2.6 Unify secret store path                          | ~30min |
| 15  | 6.1 Replace `process.exit()` with `process.exitCode` | ~1h    |
| 16  | 6.3 Centralize `catch (err)` pattern                 | ~1h    |
| 17  | 8.1 Improve test configuration for isolation         | ~30min |

### Phase 4 — Polish (P2-P3)

| #   | Item                                           | Effort |
| --- | ---------------------------------------------- | ------ |
| 18  | 3.4 Create `schemas/index.ts` barrel           | ~20min |
| 19  | 4.2 Improve `getShell()` to check `$SHELL`     | ~15min |
| 20  | 5.6 Fix non-deterministic timestamps in tests  | ~20min |
| 21  | 5.7 Replace trivial tests with meaningful ones | ~30min |
| 22  | 7.1 Run formatter on docs                      | ~2min  |

---

## Verification

After each phase, verify:

1. `pnpm test` — all tests pass
2. `pnpm typecheck` — no type errors
3. `pnpm lint` — zero warnings (not just zero errors)
4. `pnpm format:check` — all files formatted
5. `pnpm quality` — full pipeline passes
