# Health Checks & Logging

> **Status:** maintained | **Last reviewed:** 2026-06-30 | **Audience:** users

## Health Check Command

FlowTask provides a `flowtask health` command to verify environment readiness and diagnose configuration issues.

### Usage

```bash
flowtask health
```

Checks performed:

- Node.js version (22+ required)
- Project initialization
- Git availability
- `.flowtask` directory structure
- Configuration validity
- AI provider connectivity (key presence + endpoint reachability)
- Log directory access

### Options

| Option   | Description                                |
| -------- | ------------------------------------------ |
| `--json` | Output results as JSON for machine parsing |
| `--log`  | Save results to the active run's logs      |

### Exit Codes

| Code | Meaning             |
| ---- | ------------------- |
| 0    | Healthy or degraded |
| 1    | Failing checks      |

### JSON Output

```bash
flowtask health --json
```

Example output:

```json
{
  "timestamp": "2026-06-30T10:00:00.000Z",
  "overall": "degraded",
  "checks": [
    { "name": "Node.js version", "ok": true, "status": "healthy", "message": "v24.13.0 (22+)" },
    {
      "name": "Provider: groq",
      "ok": false,
      "status": "degraded",
      "message": "GROQ_API_KEY not set",
      "suggestion": "Set GROQ_API_KEY=your-api-key"
    }
  ],
  "summary": { "total": 7, "healthy": 5, "degraded": 2, "failing": 0 }
}
```

### Related Commands

```bash
flowtask doctor          # Detailed system and provider diagnostics
flowtask doctor --providers  # AI provider connectivity only
flowtask providers doctor   # Same as --providers
```

## Logging

FlowTask writes structured logs to `.flowtask/runs/<runId>/logs/` for each run.

### Log Files

| File               | Content                                 |
| ------------------ | --------------------------------------- |
| `runtime.log`      | Plain-text runtime events               |
| `runtime.jsonl`    | JSONL runtime events (machine-readable) |
| `validation.log`   | Plain-text validation output            |
| `validation.jsonl` | JSONL validation output                 |
| `<taskId>.log`     | Plain-text per-task logs                |
| `<taskId>.jsonl`   | JSONL per-task logs                     |

### Log Format (plain text)

```
[2026-06-30T10:00:00.000Z] [INFO] FlowTask startup | Node.js: v24.13.0 | ...
[2026-06-30T10:00:01.000Z] [WARN] AI provider: GROQ_API_KEY not set
[2026-06-30T10:00:02.000Z] [ERROR] ECONNREFUSED: Connection refused
```

### Log Levels

Each log entry includes a level: `INFO`, `WARN`, `ERROR`, `DEBUG`.

### Log Rotation

Log files are automatically rotated when they exceed **10 MB**. Up to **5 rotated files** are kept per log file:

```
runtime.log         # current (active)
runtime.1.log       # oldest rotated
runtime.2.log
runtime.3.log
runtime.4.log
runtime.5.log       # newest rotated
```

Rotation is performed before each write if the current file exceeds the size limit. Rotation is best-effort and never blocks execution.

### Security

- Secrets matching `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `PRIVATE_KEY`, `DATABASE_URL` patterns are automatically redacted (replaced with `****`) in all log output.
- Log files are created with `600` permissions (owner read/write only).
- Log directories are created with `700` permissions.

### Viewing Logs

```bash
flowtask logs                  # Show active run logs
flowtask logs <runId>          # Show logs for a specific run
flowtask logs <runId> --task <taskId>  # Show logs for a specific task
flowtask logs <runId> --tail 50        # Show last 50 lines
flowtask logs <runId> --follow         # Tail -f mode
```

## Troubleshooting

| Symptom                    | Likely Cause              | Solution                                  |
| -------------------------- | ------------------------- | ----------------------------------------- |
| `flowtask health` exits 1  | Failing checks            | Read the output; fix each failing item    |
| AI provider shows degraded | Missing API key           | Set the corresponding `*_API_KEY` env var |
| Logs directory not found   | No runs have been created | Run `flowtask run "your prompt"` first    |
| Log rotation errors        | Permission denied         | Check log directory permissions           |
