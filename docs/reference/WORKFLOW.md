# Workflow Management Reference

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** users

## Workflow Commands

```bash
flowtask workflow list                        # List tasks in active run
flowtask workflow list <runId>                # List tasks in a specific run
flowtask workflow list --status pending       # Filter by status
flowtask workflow show                        # Export as YAML
flowtask workflow show --json                 # Export as JSON
flowtask workflow diff <runId> <file>         # Show diff between workflow and file
flowtask workflow apply <runId> <file>        # Apply changes from file
flowtask workflow add                         # Add a new task
flowtask workflow remove <taskId>             # Remove a task
flowtask workflow reorder <ids...>            # Reorder tasks
flowtask workflow edit                        # Open in $EDITOR
flowtask workflow replan                      # Replan with AI
```

## Example Output

```
  Workflow: My Project Run
  Run ID: run_abc123
  ────────────────────────────────────────────
  Progress: ████████░░░░░░░░░░░░ 4/10 (40%)
  Status:   ● running

  Tasks (10 shown):
  ────────────────────────────────────────────
  ✓  task_001  done           Setup environment
  ✓  task_002  done           Run tests
        depends: task_001
        retries: 1/3
  ✗  task_003  failed         Build project
        depends: task_002
        retries: 2/2
        via:     opencode
  ○  task_004  pending        Deploy
        depends: task_003
```
