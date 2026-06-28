# Security

## Reporting Vulnerabilities

Report security issues by opening a GitHub issue with the `security` label.

Do not post security vulnerabilities in public discussions.

## Security Principles

### 1. No Secret Exposure

FlowTask must never print environment variables, tokens, passwords, or keys.
The `SecretRedactor` class handles redaction before logging in `LogManager`.

Sensitive values are masked when keys contain:

- `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `PRIVATE_KEY`, `DATABASE_URL`

### 2. Command Safety

All commands are classified before execution via `SafetyChecker`:

| Risk Level | Behavior               |
| ---------- | ---------------------- |
| Safe       | Runs automatically     |
| Risky      | Requires user approval |
| Blocked    | Never executed         |

### 3. Blocked Commands

These commands are blocked by default:

- `rm -rf /`
- `rm -rf .git`
- `printenv`
- Reading `.env` or SSH keys directly
- Uploading secrets
- Disabling tests

### 4. Sensitive Files

Access to files like `.env`, `.env.local`, `id_rsa`, `id_ed25519`, `*.pem`, `*.key`, and credential files requires explicit user approval.

### 5. Atomic Writes

State files use atomic writes (write to `.tmp`, rename) to prevent corruption.

### 6. No Network by Default

FlowTask is local-first. No data is sent to external services unless configured by the user.

### 7. Cross-Platform Safety

- `getShell()` detects the correct shell per platform (`sh` on Unix, `cmd.exe` on Windows).
- All paths use `path.join` to prevent path separator injection.
- `path.isAbsolute` used for path detection (not `startsWith("/")`).

## Code Review Checklist

- [ ] No secrets or tokens in code or logs
- [ ] All external commands classified by `SafetyChecker`
- [ ] State files use atomic writes
- [ ] Logs pass through `SecretRedactor`
- [ ] No hardcoded shell paths
- [ ] No `exec` usage (only `spawn`)
