# Code Quality Standards

## TypeScript

- Strict mode enabled in `tsconfig.json`.
- No `any` types allowed.
- Use TypeScript 5.6+ features.
- Prefer `interface` for public APIs, `type` for unions/primitives.
- All exports are named (no default exports).

## Schema Validation

- All runtime data must be validated with `zod`.
- Schemas live in `src/schemas/`.
- Parse inputs at boundaries; trust validated data internally.
- Schema-derived types (`z.infer`) used instead of manual types.

## Module Rules

- One module per file. Max ~200 lines per file.
- No circular dependencies.
- No duplicated logic.
- CLI commands are thin — parse args, call services, format output.
- Business logic never lives in CLI files.
- Core modules do not import presentation-layer libraries (picocolors, ora).
- No dead code or unused exports.
- No hidden global state.

## Error Handling

- Use typed error classes from `src/utils/errors.ts`.
- Errors are never silently swallowed in catch blocks.
- User-facing CLI errors are formatted with picocolors in CLI layer only.
- Detailed errors always go to logs.

## Testing

- Use `vitest` for all tests.
- Tests live in `tests/` mirroring `src/` structure.
- Use `tests/fixtures/` for complex test data.
- Tests must be deterministic, isolated, and cross-platform.
- Do not hardcode Unix-only paths like `/tmp` in tests — use `testDir` from setup.
- Every core module has a corresponding test file.

## Logging

- `LogManager` redacts secrets via `SecretRedactor` before writing.
- Logs are written to `logs/runtime.log`, `logs/validation.log`, and `logs/task_<id>.log`.
- stdout/stderr from child processes are streamed to terminal and saved to logs.
- Logs include timestamps, run IDs, and task IDs.

## Security

- Secrets are redacted from logs and console output via `SecretRedactor`.
- All commands are classified as `safe`, `risky`, or `blocked` by `SafetyChecker`.
- Blocked commands (`rm -rf /`, `printenv`, `cat .env`, etc.) are never executed.
- Risky commands require approal.
- Sensitive files (`.env`, `id_rsa`, `*.pem`, `*.key`) require approval.
- Environment variable masking: keys containing `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `PRIVATE_KEY`, `DATABASE_URL` are masked.

## Cross-Platform

- Use `path.join` for all file paths (never string concatenation).
- Use `path.isAbsolute` for path detection (not `startsWith("/")`).
- Use `getShell()` / `getShellCommandFlag()` from `src/utils/shell.ts` for shell invocation (not hardcoded `"sh"` or `"-c"`).
- Use `child_process.spawn` (never `exec`).
- Tests use `testDir` from temp directory, never hardcoded paths.

## Build

- `tsup` produces ESM output targeting Node.js 22.
- Source maps included for debugging.
- Type declarations generated automatically.
- `dist/` has correct shebang line for direct execution.

## Git

- Use conventional commits (`feat:`, `fix:`, `chore:`, etc.).
- Pre-commit hooks run `lint-staged`, `typecheck`, and `codegraph trigger`.
- Commit messages are validated by `commitlint`.

## File Organization

- One module per file.
- Index files re-export public API.
- Tests mirror source files exactly (`src/foo.ts` → `tests/foo.test.ts`).
