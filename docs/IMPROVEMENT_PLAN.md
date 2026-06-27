# FlowTask Improvement Plan

## Priority Legend

| Label | Description                                                      |
| ----- | ---------------------------------------------------------------- |
| P0    | Critical — blocks correctness, security, or causes crashes       |
| P1    | High — significant performance/memory impact, security hardening |
| P2    | Medium — good practice, moderate gains                           |
| P3    | Low — nice to have, cleanup                                      |

---

## 1. Performance & RAM Optimization

### 1.1 Remove Unused Heavy Dependencies (P1)

**Problem:** `package.json` includes `ink` (7.1.0), `react` (19.2.7), `@types/react` — these are not used by any `.ts` source file (only `process-manager.ts` imports `jsx` from `react/jsx-runtime` for a trivial type). `ora` and `enquirer` are also heavy interactive libraries.

**Impact:** Bundle size includes ~80KB+ of React runtime. Memory is loaded at startup.

**Action:**

1. Audit each dependency: check actual `import` statements across all source files.
2. Remove `ink`, `react`, `@types/react` if unused.
3. Replace `ora` with a lightweight spinner (native `process.stdout.write` animation).
4. Replace `enquirer` with `readline` or `@inquirer/prompts` tree-shakeable alternative.
5. Run `pnpm build` and verify size reduction with `du -sh dist/`.

### 1.2 Buffer Concatenation in Stream Parsing (P2)

**Problem:** `src/utils/stream-parser.ts` accumulates all text deltas in `fullTextParts[]`, then joins at the end. For long streaming responses, this holds the entire output in memory twice (as array of fragments + final joined string). The `buffer` variable also grows unbounded within a read cycle.

**Impact:** Each stream response is doubled in RAM. For large AI outputs (10K+ tokens), this is wasteful.

**Action:**

1. Replace `fullTextParts: string[]` with a single `fullText: string` accumulative variable.
2. Use `let fullText = ""; fullText += textDelta` instead of `push` + `join`.
3. Cap the buffer in `buffer += decoder.decode(...)` by flushing at a threshold (e.g., 64KB).

### 1.3 Elimination of Repeated Task File Reloads (P1)

**Problem:** `src/core/run-lifecycle.ts:446` — after each task execution, the entire task list is reloaded from disk:

```typescript
tasks.length = 0;
tasks.push(...(await this.runManager.loadTasks(run.runId)));
```

`loadTasks` reads, parses, and validates JSON + zod-parses every task. This is O(n \* tasks) for n tasks.

**Impact:** For a run with 10 tasks, tasks.json is read 10 times. Each read involves file I/O + JSON.parse + zod validation of all tasks.

**Action:**

1. Remove the full reload after each iteration.
2. Instead, update the in-memory `tasks` array directly when a task status changes.
3. Keep `saveTasks` for persistence, but do not reload the entire collection.

### 1.4 Atomic Write for State Files Causes Read-Modify-Write Every Time (P1)

**Problem:** `src/core/run-manager.ts` — methods like `updateRunStatus`, `updateTaskStatus`, `saveTasks` each:

1. Load the current file from disk
2. Modify in memory
3. Write back via `atomicWriteJsonFile`

This pattern applies to `run.json`, `tasks.json`, `run-index.json`, `task-index.json`. Each state transition fires ~3-4 file writes.

**Impact:** For a run with 10 tasks, this is ~30-40 disk I/O operations for state files alone.

**Action:**

1. Add a write-combining/debounce mechanism to `StateManager` — instead of writing on every call, queue writes and flush on a microtask or every 100ms.
2. Alternatively, use a single state file per run (instead of `run.json` + `tasks.json` + `state.json` + `events.jsonl`).
3. Batch index updates: instead of `updateRunIndex` on every `updateRunStatus`, only write at run completion + on explicit sync points.

### 1.5 SecretStore Reloads Entire File on Every Operation (P2)

**Problem:** `src/config/secret-store.ts` — `get`, `set`, `remove` all call `this.load()` which reads and parses the entire JSON file from disk. `set` then writes the entire file back.

**Impact:** Each credential check is O(file size) in I/O and parse time.

**Action:**

1. Add an in-memory cache (loaded once, invalidated on write).
2. Use a simple `Map<string, string>` that is loaded on first access.
3. For writes, update the map + write through (atomic).

### 1.6 Dynamic Imports in Hot Paths (P2)

**Problem:** `src/core/run-manager.ts:241-243`, `250`, `259` dynamically imports `readTextFile` from `../utils/fs.js` even though it is already imported at the top of the file.

```typescript
const { readTextFile } = await import("../utils/fs.js");
```

**Impact:** Each call to `loadTaskOutput`, `loadPrompt`, `loadRulesContext` triggers an unnecessary dynamic import that resolves the same module.

**Action:**

1. Remove all dynamic imports in `run-manager.ts` — the module is already statically imported.
2. Audit all files for similar patterns (`executor-registry.ts:21` lazy-imports `ShellExecutor` on every execution instead of once).

### 1.7 RingBuffer O(n) Shift Operations (P2)

**Problem:** `src/utils/ring-buffer.ts:16` uses `Array.shift()` which is O(n) for array re-indexing. With `maxLines=500` this is manageable but suboptimal.

**Impact:** Small but measurable overhead on rapid output.

**Action:**

1. Replace `string[]` with a linked list or use index-based circular buffer:

```typescript
export class RingBuffer {
  private buffer: string[];
  private head = 0;
  private count = 0;

  push(line: string): void {
    this.buffer[this.head] = line;
    this.head = (this.head + 1) % this.maxLines;
    if (this.count < this.maxLines) this.count++;
  }

  getLines(): string[] {
    const result: string[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(this.head - this.count + i + this.maxLines) % this.maxLines]!);
    }
    return result;
  }
}
```

### 1.8 SSE Stream Parser String Splitting (P2)

**Problem:** `src/utils/stream-parser.ts:59` and `139` use `buffer.split("\n")` on every chunk, which creates temporary arrays on every data event. For rapid SSE streams (many small chunks), this creates GC pressure.

**Impact:** Increased GC overhead during AI streaming.

**Action:**

1. Use incremental line scanning (find `\n` index manually with `indexOf`) instead of `split`.
2. Or pre-allocate and reuse line buffers.

### 1.9 JSON.stringify with Pretty-Printing Everywhere (P2)

**Problem:** All state writes use `JSON.stringify(data, null, 2)` which generates human-readable multi-line output with extra whitespace. For state files that are written frequently, this triples file size and write time.

**Impact:** Each `atomicWriteJsonFile` writes ~3x more bytes than needed.

**Action:**

1. Use `JSON.stringify(data)` (compact) for internal state files.
2. Reserve pretty-print only for files intended for human reading (config.json, reports).

### 1.10 Unbounded JSON Response Bodies (P3)

**Problem:** AI provider responses are fully buffered in memory via `response.json()` before parsing (`src/ai/providers/openai-compatible-provider.ts:248`). For non-streaming responses, large model outputs are held in memory as raw bytes + parsed object.

**Impact:** Large responses double RAM usage temporarily.

**Action:**

1. Keep as-is for non-streaming (necessary for JSON parse), but add a max body size check:
   ```typescript
   const contentLength = response.headers.get("content-length");
   if (contentLength && parseInt(contentLength) > 10_000_000) {
     throw new Error("Response too large");
   }
   ```

---

## 2. Security Hardening

### 2.1 SafetyChecker Pattern Bypass (P1)

**Problem:** `src/safety/safety-checker.ts` uses simple `includes()` matching that is trivially bypassed:

- `"rm -rf /"` blocks exact string but `"rm -rf /*"` passes
- `"cat .env"` blocks but `"cat ./.env"` or `.env` in a longer path passes

**Impact:** Dangerous commands can bypass safety checks.

**Action:**

1. Use regex word boundary matching: `/\brm\s+-rf\s+\/\b/` instead of `includes("rm -rf /")`.
2. Add normalization before matching: collapse multiple spaces, resolve `./` prefixes.
3. Extend blocked patterns to cover common bypasses.

### 2.2 `.env` Loading with No Permission Check (P2)

**Problem:** `src/utils/env-loader.ts` reads `.env` and loads into `process.env` without any user approval, secret masking, or audit log.

**Impact:** Secrets are loaded into process memory and leaked to spawned child processes (which inherit `process.env`). The `env-loader.ts` is called by `config-loader.ts` on every load.

**Action:**

1. Log a warning when `.env` is loaded.
2. Ensure the `SecretRedactor` masks the loaded values from logs.
3. Add a config option to disable automatic `.env` loading.

### 2.3 Credential Files Stored in Plaintext (P2)

**Problem:** `src/config/secret-store.ts` stores API keys in `~/.flowtask/secrets.json` as plain JSON. `src/config/credential-resolver.ts` uses synchronous `readFileSync` to access them.

**Impact:** Secrets are readable by any process with filesystem access. `readFileSync` blocks the event loop.

**Action:**

1. Add a note to document that secrets are stored in plaintext (awareness).
2. Replace `readFileSync` in `credential-resolver.ts` with async `readFile`.
3. Consider recommending OS keychain integration for production use (documentation).

### 2.4 Secret Redactor Misses Inline Secrets (P2)

**Problem:** `src/safety/secret-redactor.ts` only matches `KEY=VALUE` and `Bearer TOKEN` patterns. It does NOT redact:

- Inline API keys in URLs (e.g., `https://api.key=sk-...`)
- JSON response bodies containing secrets
- Command arguments containing secrets (`--api-key sk-...`)
- Environment variables passed as `-e KEY=value`

**Impact:** Secrets may leak into logs and console output.

**Action:**

1. Add regex patterns for common API key formats (sk-..., pk-..., etc.).
2. Add URL-based pattern: `https?://[^@]+@` (credentials in URLs).
3. Add flag-based pattern: `--(?:api-key|token|secret|password)\s+\S+`.
4. Apply redactor to all `process.env` captures before logging.

### 2.5 Health Check API Keys Logged in Errors (P3)

**Problem:** When provider health checks fail, error messages may include parts of the URL that contain API key patterns. The error objects are logged via `LogManager`.

**Impact:** Partial key leakage in error logs.

**Action:**

1. Ensure all error messages pass through `SecretRedactor` before logging.
2. Truncate URLs in health check error messages.

---

## 3. Code Quality & Best Practices

### 3.1 Massive Files Exceed Module Size Limit (P1)

**Problem:** The ~200 lines/module rule is violated by several files:

| File                                             | Lines |
| ------------------------------------------------ | ----- |
| `src/core/run-lifecycle.ts`                      | 706   |
| `src/planner/internal-ai-planner.ts`             | 665   |
| `src/planner/ai-planner.ts`                      | 512   |
| `src/validation/validation-runner.ts`            | 488   |
| `src/ai/providers/openai-compatible-provider.ts` | 415   |
| `src/ai/providers/azure-openai-provider.ts`      | 394   |
| `src/ai/providers/gemini-provider.ts`            | 393   |
| `src/ai/openai-provider.ts`                      | 388   |
| `src/ai/providers/mistral-provider.ts`           | 380   |
| `src/cli/commands/doctor.command.ts`             | 379   |
| `src/ai/providers/anthropic-provider.ts`         | 366   |
| `src/ai/providers/ollama-provider.ts`            | 351   |
| `src/cli/commands/setup.command.ts`              | 342   |
| `src/cli/commands/logs.command.ts`               | 306   |

**Action:**

1. `run-lifecycle.ts` — Extract planner logic to a dedicated `PlannerOrchestrator`, extract task execution to a `TaskRunner`, extract quality gate to use existing `QualityGate`.
2. `validation-runner.ts` — Extract `DedupeCache` to its own file, extract `ValidationCommandResult` handling to smaller functions.
3. `internal-ai-planner.ts` — Extract streaming logic, repair logic, and output processing into separate modules.
4. All AI providers — Extract shared base class `BaseAiProvider` with common HTTP, error handling, and stream parsing.

### 3.2 Massive Duplication Between AI Providers (P2)

**Problem:** `OpenAiProvider` and `OpenAiCompatibleProvider` share ~85% of the same code: error handling, request building, response parsing, streaming, health checks. Similarly, `AnthropicProvider`, `GeminiProvider`, `MistralProvider`, `AzureOpenAiProvider`, `OllamaProvider` all duplicate the same patterns.

**Impact:** High maintenance burden. Fixing a bug in one provider requires fixing it in all.

**Action:**

1. Create `src/ai/base-provider.ts` with shared logic:
   - `BaseAiProvider` class with `generate`, `stream`, `healthCheck`
   - Abstract methods: `buildRequestBody`, `parseResponse`, `parseStreamChunk`
2. Each provider extends `BaseAiProvider` and implements only the protocol-specific parts:
   - `OpenAiProvider` — OpenAI-style chat completions
   - `AnthropicProvider` — Anthropic `/v1/messages`
   - `GeminiProvider` — Gemini `generateContent`
   - `OllamaProvider` — Ollama `/api/chat`
3. `OpenAiCompatibleProvider` becomes trivial: extends `OpenAiProvider` with configurable baseUrl + model.

### 3.3 Dead Code and Unused Parameters (P2)

**Problem:**

- `delayBetweenCommands(_concurrency, _index, _commands)` — parameters prefixed with `_` are unused. The method is a no-op (just `Promise.resolve()`).
- Several unused parameters in `parseSseStream` (`_provider`, `_model`).
- Unused React/Ink dependencies in `package.json`.
- `stream.ts` is a barrel export that re-exports from 3 files but is only imported by tests.

**Impact:** Confusing API surface, dead code to maintain.

**Action:**

1. Remove unused parameters or prefix them with `_` consistently.
2. Either implement `delayBetweenCommands` with actual concurrency control or remove the concurrency config.
3. Remove `stream.ts` barrel file if unused outside tests.
4. Remove unused dependencies.

### 3.4 Unnecessary Record<string, unknown> Casting (P2)

**Problem:** Every `readJsonFile` call is typed as `Record<string, unknown>` and then validated through zod. The intermediate generic type parameter is wasted — the function returns `unknown` already.

**Impact:** Unnecessary type assertions that hide type errors.

**Action:**

1. Change `readJsonFile<T>` to return `unknown` (caller always parses through zod anyway).
2. Remove all `<Record<string, unknown>>` casts.

### 3.5 Silent Catch Blocks (P2)

**Problem:** Multiple catch blocks with empty bodies or `// non-critical` comments:

- `src/validation/validation-runner.ts:303` — `catch (() => {})`
- `src/core/run-lifecycle.ts:306` — `catch { // persistence is non-critical }`
- `src/core/run-manager.ts:123,139,156,185` — `catch { // start fresh }`

**Impact:** Errors are silently swallowed, making debugging difficult.

**Action:**

1. Log all caught errors at `debug` or `trace` level via `LogManager`.
2. Never use empty catch blocks.

### 3.6 Magic Strings and Missing Constants (P3)

**Problem:** Strings like `"shell"`, `"manual"`, `"done"`, `"failed"`, `"passed"`, `"pending"` are used directly in many places instead of referencing the zod enum or a constants file.

**Impact:** Schema changes require hunting down every literal string.

**Action:**

1. Export constants from schemas: `export const TASK_STATUS_DONE = "done"`, etc.
2. Derive from zod enums: `TaskStatusSchema.Values.done`.

### 3.7 CLI Commands Have Business Logic (P2)

**Problem:** Despite the rule "CLI commands must be thin", several CLI files contain business logic:

- `src/cli/commands/run.command.ts` — config mutation (lines 52-78), planner selection orchestration
- `src/cli/commands/logs.command.ts` — 306 lines of filtering and display logic
- `src/cli/commands/setup.command.ts` — 342 lines of interactive setup wizard
- `src/cli/commands/doctor.command.ts` — 379 lines of system checks

**Action:**

1. Extract config mutation logic from `run.command.ts` into a `ConfigService`.
2. Extract `doctor.command.ts` logic into a `DoctorService` in `src/core/` or `src/ai/`.
3. Extract `setup.command.ts` logic into a `SetupService`.
4. Keep CLI files as thin wrappers (parse args + call service + format output).

### 3.8 Separated `generate` and `stream` on AiProvider Interface (P2)

**Problem:** The `AiProvider` interface declares both `generate()` and `stream()` methods, but every provider's `generate()` internally checks `if (request.stream)` and calls `streamInternal()`. This is interface pollution — the caller shouldn't decide the streaming mode.

**Impact:** Confusing contract where `generate` can produce streaming behavior.

**Action:**

1. Remove `stream` from `AiProviderRequest` or make it a separate interface.
2. Make `AiProvider.generate()` always non-streaming (caller uses `stream()` explicitly for streaming).
3. Or merge `generate`/`stream` into a single method that returns an async iterable.

### 3.9 Missing Task Input Size Validation (P1)

**Problem:** No limits are enforced on:

- Task count from planner output (AiPlannerOutputSchema allows 1-30)
- Context pack size (grows with rules + prompt + completed tasks)
- Command length passed to spawn (no validation before execution)
- Event JSONL file size (can grow unbounded across many runs)

**Impact:** Memory exhaustion from large planner outputs, oversized context packs, or bloated event files.

**Action:**

1. Add context pack size limit (e.g., 1MB) and truncate if exceeded.
2. Add event log rotation or size cap.
3. Validate command length before spawning (reject > 32KB commands).

---

## 4. Summary of Expected Improvements

| Area                     | Estimated Improvement                                                 |
| ------------------------ | --------------------------------------------------------------------- |
| **RAM (stream parsing)** | ~50% reduction during AI streaming (remove duplicate string storage)  |
| **RAM (task reload)**    | ~30% reduction during run execution (avoid repeated JSON parse + zod) |
| **RAM (dependencies)**   | ~80KB+ reduction in baseline memory (remove ink/react)                |
| **Disk I/O**             | ~60-70% fewer file writes (write combining + batch index updates)     |
| **Startup time**         | ~200ms faster (fewer modules to load, no React resolution)            |
| **Security**             | Covers 3 critical bypass paths, 2 secret leak vectors                 |
| **Maintainability**      | ~35% reduction in AI provider code via base class extraction          |
| **Reliability**          | All silent catch blocks log errors; input validation prevents OOM     |

**Total estimated effort:** ~3-5 days for a single developer to implement all P0-P2 items.
