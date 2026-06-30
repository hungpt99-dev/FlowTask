# Example Workflows and Configurations

> **Status:** maintained | **Last reviewed:** 2026-06-30 | **Audience:** users

## Overview

FlowTask ships with example workflows and configurations to help you get started quickly. These examples demonstrate common patterns and best practices.

## Quick Start Example

The minimal example in `examples/minimal/` is the simplest way to try FlowTask:

### Structure

```
examples/minimal/
├── flowtask.yaml              # Workflow definition
└── .flowtask/
    └── steps/
        └── default.md         # Step definitions
```

### Workflow: flowtask.yaml

```yaml
runTitle: "Hello World Example"
tasks:
  - id: hello_world
    title: "Print Hello World"
    description: "Run a shell command that prints Hello World"
    executor: shell
    dependsOn: []
    acceptanceCriteria:
      - Output contains "Hello World"
    validation:
      commands:
        - echo "Hello World"
    expectedResult: "Hello World printed to console"
```

**Fields explained:**

| Field                         | Description                                        |
| ----------------------------- | -------------------------------------------------- |
| `runTitle`                    | Human-readable title for the entire workflow       |
| `tasks`                       | List of tasks to execute sequentially              |
| `tasks[].id`                  | Unique identifier for the task                     |
| `tasks[].title`               | Short description of the task                      |
| `tasks[].executor`            | How to run the task (`shell`, `command`, `manual`) |
| `tasks[].dependsOn`           | Task IDs this task depends on (empty for root)     |
| `tasks[].acceptanceCriteria`  | Conditions that define task success                |
| `tasks[].validation.commands` | Commands to verify task completion                 |
| `tasks[].expectedResult`      | Human-readable description of expected result      |

### Steps: default.md

Steps define the approach the AI executor follows when working on a task:

```markdown
# Hello World Steps

1. Greet - Print a greeting message to the console.
2. Verify - Confirm the output contains "Hello World".
3. Report - Summarize the result.
```

Each step is a line with a number, a short name, and a description.

### Running the Example

```bash
# Navigate to the example directory
cd examples/minimal

# Initialize FlowTask (if not already initialized)
flowtask init

# Run the workflow
flowtask run --config flowtask.yaml
```

## Minimal AI Provider Configuration

FlowTask requires at least one AI provider to be configured for the planner. Here is a minimal `.flowtask/config.json` with OpenAI:

```json
{
  "version": "1.0",
  "projectMode": "development",
  "defaultExecutor": "opencode",
  "planner": {
    "default": "auto",
    "type": "internal-ai",
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "maxRetries": 1,
    "fallbackToSimple": true
  },
  "ai": {
    "providers": {
      "openai": {
        "type": "openai",
        "apiKeyEnv": "OPENAI_API_KEY",
        "baseUrl": "https://api.openai.com/v1"
      }
    }
  }
}
```

Set the API key via environment variable:

```bash
export OPENAI_API_KEY=sk-your-key-here
```

### Alternative Providers

**Anthropic:**

```json
{
  "ai": {
    "providers": {
      "anthropic": {
        "type": "anthropic",
        "apiKeyEnv": "ANTHROPIC_API_KEY"
      }
    }
  }
}
```

**OpenAI-Compatible (DeepSeek, OpenRouter, Groq, etc.):**

```json
{
  "ai": {
    "providers": {
      "deepseek": {
        "type": "openai-compatible",
        "apiKeyEnv": "DEEPSEEK_API_KEY",
        "baseUrl": "https://api.deepseek.com/v1"
      }
    }
  }
}
```

**Local (Ollama):**

No API key needed:

```json
{
  "ai": {
    "providers": {
      "ollama": {
        "type": "ollama",
        "baseUrl": "http://localhost:11434"
      }
    }
  }
}
```

## Multi-Task Workflow Example

A more realistic example with multiple tasks and dependencies:

```yaml
runTitle: "Project Setup"
tasks:
  - id: setup_env
    title: "Check environment"
    description: "Verify Node.js and pnpm are installed"
    executor: shell
    dependsOn: []
    acceptanceCriteria:
      - Node.js version >= 22
      - pnpm version >= 9
    validation:
      commands:
        - node --version
        - pnpm --version

  - id: install_deps
    title: "Install dependencies"
    description: "Run pnpm install"
    executor: shell
    dependsOn:
      - setup_env
    acceptanceCriteria:
      - All dependencies installed
    validation:
      commands:
        - pnpm install --frozen-lockfile
```

## Environment File Example

Create a `.env` file with your API keys:

```bash
# Primary AI provider
OPENAI_API_KEY=sk-your-openai-key-here

# Alternative providers (optional)
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here
DEEPSEEK_API_KEY=your-deepseek-key-here
```

Then reference it:

```bash
export $(cat .env | xargs)
flowtask run --config examples/minimal/flowtask.yaml
```

## Validation

Run `flowtask doctor` to verify your setup:

```bash
flowtask doctor
```

## Next Steps

- [Getting Started](GETTING_STARTED.md) — Install and run your first workflow
- [Configuration](../reference/CONFIGURATION.md) — Full configuration reference
- [AI Providers](../reference/PROVIDERS.md) — Provider setup guide
- [CLI Commands](../reference/COMMANDS.md) — Command reference
- [Troubleshooting](TROUBLESHOOTING.md) — Common issues
