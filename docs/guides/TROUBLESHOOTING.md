# Troubleshooting

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** users

## AI Planner Returns Non-JSON

FlowTask handles non-JSON output automatically:

1. Extracts JSON from common formats (raw, fenced ```json, balanced braces)
2. Saves raw output to `.flowtask/runs/<runId>/outputs/` for debugging
3. Retries once with a repair prompt
4. Falls back to simple planner in `auto` mode, or fails in `ai` mode

```bash
# Skip AI planning entirely
flowtask run "update readme" --planner simple

# Debug planner output
cat .flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-1.txt
```

## Run Won't Resume

- Check that run state files exist in `.flowtask/runs/<runId>/`
- Try explicit resume: `flowtask resume <runId>`
- Try resume from specific task: `flowtask resume <runId> --from <taskId>`

## Executor Not Found

- Check executor configuration in `.flowtask/config.json`
- Verify the executable is installed and in PATH
- Try `flowtask doctor` for system health check

## Common Errors

| Error               | Cause                      | Solution                          |
| ------------------- | -------------------------- | --------------------------------- |
| `command not found` | Missing tool               | Install the tool or check PATH    |
| `permission denied` | File permission issue      | Check file permissions            |
| Timeout             | Task exceeded time limit   | Increase timeout in config        |
| AI provider error   | API key missing or invalid | Run `flowtask setup` to configure |
