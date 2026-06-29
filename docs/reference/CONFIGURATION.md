# Configuration Reference

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** users

## Config File

FlowTask configuration is stored in `.flowtask/config.json`.

## Schema

### Top-Level Options

```json
{
  "version": "1.0",
  "projectMode": "development",
  "defaultExecutor": "opencode",
  "autoResume": true
}
```

### Rules

```json
{
  "rules": {
    "enabled": true,
    "paths": [".flowtask/rules/*.md", "AGENTS.md", "CLAUDE.md", "docs/agents/AI_AGENT_RULES.md"],
    "required": false,
    "maxFileSizeKb": 256
  }
}
```

### Approval

```json
{
  "approval": {
    "enabled": true,
    "autoApprove": false,
    "stepLevel": true,
    "requireFor": [
      "delete_file",
      "install_dependency",
      "git_push",
      "deploy",
      "database_migration",
      "read_sensitive_file"
    ]
  }
}
```

### Validation

```json
{
  "validation": {
    "profile": "safe",
    "concurrency": 1,
    "timeoutMs": 300000,
    "killGraceMs": 5000,
    "dedupeCommands": true,
    "resourceGuard": true
  }
}
```

### Limits

```json
{
  "limits": {
    "maxRunMinutes": 120,
    "maxTaskMinutes": 30,
    "maxRetries": 2,
    "maxLogSizeMb": 20
  }
}
```

### Hooks

```json
{
  "hooks": {
    "beforeRun": [],
    "afterRun": [],
    "beforeTask": [],
    "afterTask": [],
    "beforeRetry": [],
    "afterRetry": [],
    "onFailure": [],
    "failOnError": false
  }
}
```

### Planner

```json
{
  "planner": {
    "default": "auto",
    "type": "internal-ai",
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "maxRetries": 1,
    "fallbackToSimple": true
  }
}
```

### Logging

```json
{
  "logging": {
    "maxInMemoryLines": 500,
    "maxLineLength": 4000
  }
}
```

### AI Providers

```json
{
  "ai": {
    "providers": {}
  }
}
```

### Executors

```json
{
  "executors": {}
}
```

For full executor defaults, see [EXECUTORS.md](EXECUTORS.md).

## CLI Config Management

```bash
flowtask config list              # List all configurable settings
flowtask config get               # Show all current values
flowtask config get <key>         # Show specific value
flowtask config set <key> <value> # Set a value
```
