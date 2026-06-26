# Stream Enhancements Design

## Current State

The previous run (`run_20260626T102250`) fixed 3 of 5 identified CLI display issues:

| #   | Issue                              | Status                  |
| --- | ---------------------------------- | ----------------------- |
| 1   | No newline appended                | ✅ Fixed                |
| 2   | No stream/task prefix in live view | ✅ Fixed (RichRenderer) |
| 3   | No color/formatting                | ✅ Fixed                |
| 4   | No timestamp in terminal output    | ❌ Not addressed        |
| 5   | No separation between tasks        | ❌ Not addressed        |

Additionally, the analysis revealed **deeper architectural issues** with streaming across the AI provider layer that were out of scope for the previous run.

---

## Phase 1: CLI Display Enhancements

### 1.1 Timestamp Support

**Problem**: `PlainRenderer` and `RichRenderer` write output without timestamps. Disk logs have timestamps via `LogManager`, but terminal output does not.

**Solution**: Add optional `showTimestamp` flag to renderers. When enabled, prepend `[HH:MM:SS]` before each output line.

**Files**:

- `src/ui/renderers/plain-renderer.ts` — Add `showTimestamp` option, prepend `time.toLocaleTimeString()` if enabled
- `src/ui/renderers/rich-renderer.ts` — Same, with dim color for timestamp
- `src/cli/commands/run.command.ts` — Wire `--timestamp` flag
- `src/ui/output-mode.ts` — Add `showTimestamp` to `OutputOptions`

**Test plan**:

- PlainRenderer: verify timestamp appears when flag set, absent when not
- RichRenderer: same, verify timestamp is dimmed

### 1.2 Task Separation Headers

**Problem**: When multiple tasks run, output from different tasks streams into the same terminal with no visual delimiter.

**Solution**: When a new task starts, write a header like:

```
── [2/5] Implement feature ──────────────────────
```

**Files**:

- `src/core/run-lifecycle.ts` (line 476) — Modify `console.log` to emit a formatted separator via EventBus or directly
- `src/ui/renderers/rich-renderer.ts` — Handle `task_started` events with a separator line
- `src/ui/renderers/plain-renderer.ts` — Handle `task_started` with a simple `---` separator

**Test plan**:

- RichRenderer: verify `task_started` event renders a header
- PlainRenderer: verify `task_started` renders a simple separator

### 1.3 ANSI Escape Code Stripping in Plain Mode

**Problem**: Raw ANSI escape codes from subprocess output leak into plain/CI mode logs, making them unreadable.

**Solution**: In `PlainRenderer` and `LineBuffer`, strip ANSI escape sequences when in plain mode.

**Files**:

- `src/utils/stream-lines.ts` — Add optional `stripAnsi` flag to `LineBuffer`
- `src/ui/renderers/plain-renderer.ts` — Enable stripping
- `tests/utils/stream-lines.test.ts` — Add ANSI stripping tests

### 1.4 Line Truncation

**Problem**: Very long single-line output wraps poorly in terminal.

**Solution**: In `RichRenderer`, add configurable `maxLineLength` (default 2000 chars) that truncates long lines with `…` suffix.

**Files**:

- `src/ui/renderers/rich-renderer.ts` — Add truncation logic
- `tests/ui/rich-renderer.test.ts` — Add truncation tests

---

## Phase 2: Shared SSE Streaming Infrastructure

### 2.1 Problem

Every AI provider duplicates SSE parsing logic:

| Provider                                  | Lines                        | Format          |
| ----------------------------------------- | ---------------------------- | --------------- |
| `openai-provider.ts`                      | `parseSseStream` (91 lines)  | `data: {...}`   |
| `providers/openai-compatible-provider.ts` | `parseSseStream` (91 lines)  | `data: {...}`   |
| `providers/azure-openai-provider.ts`      | `parseSseStream` (60 lines)  | `data: {...}`   |
| `providers/anthropic-provider.ts`         | `parseSseStream` (99 lines)  | SSE events      |
| `providers/gemini-provider.ts`            | `parseSseStream` (113 lines) | NDJSON          |
| `providers/mistral-provider.ts`           | `parseSseStream` (60 lines)  | `data: {...}`   |
| `providers/ollama-provider.ts`            | Custom NDJSON                | `{"done":true}` |

Each implementation handles:

- Raw byte stream → text decoding
- Line splitting + buffering
- SSE event parsing (`data: ` prefix)
- JSON parsing of each chunk
- Provider-specific response shape extraction
- `[DONE]` sentinel handling

### 2.2 Design

Create a shared streaming utility in `src/utils/stream-parser.ts`:

```typescript
export type SseChunk = Record<string, unknown>;

export interface StreamParserOptions {
  contentType?: string; // "text/event-stream", "application/x-ndjson"
  onChunk?: (chunk: SseChunk) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (chunk: Record<string, unknown>) => void | Promise<void>,
  contentType?: string,
): Promise<SseChunk[]> {
  // Shared SSE/NDJSON parser
}
```

Support:

- `text/event-stream` (OpenAI-style: `data: {...}\n\n`)
- `application/x-ndjson` (Ollama-style: `{...}\n`)
- Automatic line buffering
- Chunk callback with `done` detection
- Returns all chunks for final assembly

### 2.3 Migration

Each provider's `parseSseStream` → calls shared utility, keeps only the response-specific extraction.

Example simplification for `openai-provider.ts`:

```typescript
private async parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (chunk: AiProviderStreamChunk) => void | Promise<void>,
  contentType: string,
): Promise<AiProviderResponse> {
  const chunks = await sharedParseSseStream(reader, (raw) => {
    const delta = extractDelta(raw);
    if (delta) { /* emit chunk */ }
    const usage = extractUsage(raw);
    if (usage) { /* emit done + usage */ }
  }, contentType);
  return buildResponse(chunks);
}
```

### 2.4 Provider Extraction Helpers

Each provider extracts text differently:

```typescript
// OpenAI-style
function extractOpenAiDelta(raw: SseChunk): string | null {
  return (raw as any)?.choices?.[0]?.delta?.content ?? null;
}

// Anthropic-style
function extractAnthropicDelta(raw: SseChunk): string | null {
  return (raw as any)?.delta?.text ?? null;
}

// Ollama-style
function extractOllamaDelta(raw: SseChunk): string | null {
  return (raw as any)?.response ?? null;
}

// Gemini-style
function extractGeminiDelta(raw: SseChunk): string | null {
  return (raw as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}
```

These helpers live alongside each provider or in a shared `src/utils/provider-stream.ts`.

---

## Phase 3: AiProvider Stream Integration with EventBus

### 3.1 Problem

The `AiProvider` interface has `stream?()` method that returns chunks via callback, but these chunks are NOT emitted through the EventBus, meaning they cannot be observed by renderers or loggers.

The `UiEvent` type already defines `ai_provider_stream_started`, `ai_provider_stream_delta`, `ai_provider_stream_completed`, and `ai_provider_stream_failed`.

### 3.2 Solution

Add a convenience wrapper in `src/ai/ai-provider.ts`:

```typescript
export function streamToEventBus(
  provider: AiProvider,
  request: AiProviderRequest,
  eventBus: EventBus,
): Promise<AiProviderResponse> {
  const stream = provider.stream;
  if (!stream) {
    return provider.generate(request);
  }

  eventBus.emit({
    type: "ai_provider_stream_started",
    provider: provider.name,
    model: request.model ?? "unknown",
    timestamp: new Date().toISOString(),
  });

  return stream(request, (chunk) => {
    if (!chunk.done) {
      eventBus.emit({
        type: "ai_provider_stream_delta",
        provider: chunk.provider,
        model: chunk.model,
        textDelta: chunk.textDelta,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
```

### 3.3 Test Plan

- Unit test for `streamToEventBus` that mocks provider and verifies EventBus emits
- Integration test verifying EventBus receives deltas during streaming

---

## Phase 4: Stream Test Utilities

### 4.1 Mock Stream Helpers

Add `src/utils/test-streams.ts` for testing streaming behavior:

```typescript
export function mockReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

export function mockSseChunks(events: Record<string, unknown>[]): string[] {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
}
```

### 4.2 Usage

All provider and shared parser tests use these utilities instead of raw buffer construction.

---

## Implementation Order

| Step                               | Phase | Effort | Risk   |
| ---------------------------------- | ----- | ------ | ------ |
| 1.4 Line truncation (RichRenderer) | 1     | small  | low    |
| 1.1 Timestamp support              | 1     | small  | low    |
| 1.3 ANSI stripping                 | 1     | small  | low    |
| 1.2 Task separation headers        | 1     | medium | low    |
| 4.1 Stream test utilities          | 4     | small  | low    |
| 2.2 Shared SSE parser              | 2     | medium | medium |
| 2.3 Migrate providers              | 2     | large  | medium |
| 3.2 EventBus integration           | 3     | medium | low    |

---

## Files Modified

| File                                 | Phase | Change                              |
| ------------------------------------ | ----- | ----------------------------------- |
| `src/ui/renderers/plain-renderer.ts` | 1     | Timestamp, ANSI strip, task headers |
| `src/ui/renderers/rich-renderer.ts`  | 1     | Timestamp, truncation, task headers |
| `src/ui/output-mode.ts`              | 1     | Add `showTimestamp` option          |
| `src/cli/commands/run.command.ts`    | 1     | Wire `--timestamp` flag             |
| `src/core/run-lifecycle.ts`          | 1     | Task header format                  |
| `src/utils/stream-lines.ts`          | 1     | ANSI stripping                      |
| `src/utils/stream-parser.ts`         | 2     | **New** — shared SSE/NDJSON parser  |
| `src/utils/provider-stream.ts`       | 2     | **New** — provider delta extractors |
| `src/ai/openai-provider.ts`          | 2     | Use shared parser                   |
| `src/ai/providers/*.ts`              | 2     | Use shared parser                   |
| `src/ai/ai-provider.ts`              | 3     | Add `streamToEventBus`              |
| `src/utils/test-streams.ts`          | 4     | **New** — mock streams for tests    |
| `tests/**`                           | All   | New/updated tests                   |
