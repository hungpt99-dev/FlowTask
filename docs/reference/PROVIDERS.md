# AI Provider Reference

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** users

## Supported Providers

| Provider          | Type                 | Endpoint            |
| ----------------- | -------------------- | ------------------- |
| OpenAI            | `openai`             | `/chat/completions` |
| OpenAI-Compatible | `openai-compatible`  | `/chat/completions` |
| Anthropic         | `anthropic`          | `/v1/messages`      |
| Gemini            | `gemini`             | `generateContent`   |
| Mistral           | `mistral`            | `/chat/completions` |
| Azure OpenAI      | `azure-openai`       | deployment-based    |
| Ollama            | `ollama`             | `/api/chat`         |
| Custom            | via registration API | configurable        |

## Provider Features

All providers support:

- `response_format` fallback (retries without JSON mode if unsupported)
- SSE/NDJSON streaming
- Health checks (`flowtask doctor --providers`)
- Custom provider registration API

## Setup

### Interactive Setup

```bash
flowtask setup
```

Guided setup supports: OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, Groq, Ollama, LM Studio.

### Manual Configuration

Configure in `.flowtask/config.json`:

```json
{
  "ai": {
    "providers": {
      "openai": {
        "type": "openai",
        "apiKey": "sk-...",
        "model": "gpt-4.1-mini"
      }
    }
  }
}
```

API keys are stored in `~/.flowtask/secrets.json` — not in the project config. Environment variables like `OPENAI_API_KEY` also work.

### CLI Examples

```bash
# Use specific provider/model
flowtask run "update readme" --planner ai --planner-provider anthropic --planner-model claude-3-5-sonnet-latest

# Use Ollama (local, no API key)
flowtask run "update docs" --planner ai --planner-provider ollama --planner-model llama3.1

# Use OpenAI-compatible (OpenRouter, DeepSeek, Groq, etc.)
flowtask run "refactor" --planner ai --planner-provider openai-compatible --planner-model openai/gpt-4o-mini
```

## Provider Management

```bash
flowtask providers list                    # List configured providers
flowtask providers current                 # Show active provider
flowtask providers test                    # Test connection
flowtask providers configure               # Interactive wizard
flowtask providers remove <name>           # Remove provider
flowtask providers doctor                  # Check provider health
```

## Custom Provider Registration

```typescript
import { ProviderRegistry, type AiProviderFactory } from "flowtask";

const registry = new ProviderRegistry();
registry.registerProviderType("my-vendor", myFactory: AiProviderFactory);
registry.registerProvider("my-model", { type: "my-vendor", ...config });
```
