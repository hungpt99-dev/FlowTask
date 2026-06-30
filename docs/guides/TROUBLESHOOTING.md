# Troubleshooting

> **Status:** maintained | **Last reviewed:** 2026-06-29 | **Audience:** users

## Quick Diagnostic

Run `flowtask doctor` to check your environment — it validates Node.js, project structure,
configuration, AI providers, executors, and more in a single command.

```bash
flowtask doctor              # Full environment check
flowtask doctor --providers  # AI provider connectivity only
```

---

## Installation & Setup

### `flowtask: command not found`

Global install did not register the binary in your PATH.

```bash
# Verify installation
npm list -g flowtask

# Add npm global bin to PATH (choose one for your shell)
echo 'export PATH=$(npm bin -g):$PATH' >> ~/.zshrc
echo 'export PATH=$(npm bin -g):$PATH' >> ~/.bashrc

# Or reinstall
npm install -g flowtask
```

### Initialization fails

`flowtask init` exits with an error or creates incomplete `.flowtask/` files.

**Common causes and fixes:**

| Cause                                  | Check               | Fix                                             |
| -------------------------------------- | ------------------- | ----------------------------------------------- |
| Directory not writable                 | `ls -la .`          | `chmod u+w .` or run from a different directory |
| Disk full                              | `df -h .`           | Free up space                                   |
| Partial `.flowtask/` from aborted init | `ls -la .flowtask/` | `flowtask init --force` to overwrite            |
| Locked by another process              | `lsof .flowtask/`   | Kill the blocking process                       |

### Global install fails with permission errors

```bash
# Option 1: Use nvm to avoid permission issues
nvm install 22 && nvm use 22

# Option 2: Change npm prefix to user directory
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
npm install -g flowtask

# Option 3: Use npx without global install
npx flowtask init
```

### Node.js version too old

FlowTask requires **Node.js 22+**.

```bash
node --version
# If < 22:
# Using nvm:
nvm install 22 && nvm use 22
# Using fnm:
fnm install 22 && fnm use 22
# Or download from https://nodejs.org
```

---

## Configuration

### Config file errors

Symptoms: `ConfigError` or `Failed to load config`.

```bash
# Validate config
flowtask doctor

# Inspect current config
flowtask config list

# Fix specific key
flowtask config set <key> <value>

# Reset to defaults (backup first!)
cp .flowtask/config.json .flowtask/config.json.bak
flowtask init --force
```

### "Unknown configuration key"

A typo or removed key in `.flowtask/config.json`.

**Fix:** Check the [Configuration reference](../reference/CONFIGURATION.md) for valid keys, or remove unknown keys.

### "Invalid config value"

A setting has an invalid value (e.g., wrong planner mode).

```bash
flowtask config set planners.type ai  # Fix planner type
```

---

## AI Providers

### "API key not set" / Missing environment variable

```bash
# Set the key for your session
export OPENAI_API_KEY=sk-...

# Or add to .env file (loaded automatically)
echo 'OPENAI_API_KEY=sk-...' >> .env

# Or configure via interactive prompt
flowtask configure ai
```

**Provider-specific key URLs:**

| Provider  | Key URL                                     |
| --------- | ------------------------------------------- |
| OpenAI    | https://platform.openai.com/api-keys        |
| Anthropic | https://console.anthropic.com/settings/keys |
| Gemini    | https://aistudio.google.com/app/apikey      |
| DeepSeek  | https://platform.deepseek.com/api_keys      |
| Groq      | https://console.groq.com/keys               |

### Provider not reachable

```bash
# Test connectivity
flowtask doctor --providers

# For local providers (Ollama, LM Studio):
# Start the service
ollama serve

# Verify it is listening
curl http://localhost:11434/api/tags

# Check firewall / VPN is not blocking localhost
```

### Rate limited or quota exceeded

**Symptoms:** `429 Too Many Requests` or `insufficient_quota`.

```bash
# Reduce concurrency in config
flowtask config set validation.concurrency 1

# Increase delay between API calls
# (Adjust in .flowtask/config.json under ai.providers.<name>.rateLimit)

# Check billing at your provider's dashboard
```

### AI planner returns non-JSON

FlowTask handles non-JSON output automatically:

1. Extracts JSON from common formats (raw, fenced \`\`\`json, balanced braces)
2. Saves raw output to `.flowtask/runs/<runId>/outputs/` for debugging
3. Retries once with a repair prompt
4. Falls back to simple planner in `auto` mode, or fails in `ai` mode

```bash
# Skip AI planning entirely
flowtask run "update readme" --planner simple

# Debug planner output
cat .flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-1.txt
```

### Provider returns 401 Unauthorized

Your API key is invalid, expired, or does not have access to the requested model.

```bash
# Verify key is set
echo ${OPENAI_API_KEY:0:8}...  # Shows first 8 chars

# Regenerate key at provider dashboard
# Update env var or .env file, then retry
```

---

## Network & Connectivity

### ECONNREFUSED / ENOTFOUND

The target endpoint is not reachable.

```bash
# Test basic connectivity
curl -I https://api.openai.com/v1/models

# Check proxy settings
echo $HTTP_PROXY $HTTPS_PROXY $NO_PROXY

# Check DNS
nslookup api.openai.com

# For local providers, ensure service is running
ollama serve     # Start Ollama
# or start LM Studio local inference server
```

### ECONNRESET / socket hang up

The connection was interrupted (proxy timeout, firewall, or unstable network).

```bash
# Increase timeout in config
flowtask config set validation.timeoutMs 600000

# Retry with backoff — FlowTask retries automatically for retryable errors
```

### Proxy issues

If behind a corporate proxy:

```bash
# Set proxy env vars
export HTTP_PROXY=http://proxy.company.com:8080
export HTTPS_PROXY=http://proxy.company.com:8080
export NO_PROXY=localhost,127.0.0.1
```

---

## Runtime & Execution

### "Executor not found"

The executor command is not installed or not in PATH.

```bash
# Check configured executors
flowtask doctor

# Verify CLI tool is installed
which opencode    # or claude, codex, aider
# If not found, install globally
npm install -g @opencode/cli

# Or use the shell executor
flowtask run --executor shell "your prompt"
```

### Task timeout

The task exceeded the configured timeout limit.

```bash
# Increase timeout
flowtask config set validation.timeoutMs 600000  # 10 minutes

# Split large tasks into smaller steps
flowtask config set planners.maxTasks 10

# Check for stuck child processes
lsof -i :<port>  # Find hanging processes
```

### Stuck process — no output for a long time

```bash
# Kill and retry (FlowTask retries automatically if configured)
# Increase output timeout
flowtask config set validation.timeoutMs 600000

# Use shell executor for better visibility
flowtask run --executor shell "your prompt"
```

### "Command blocked by safety"

FlowTask blocked a risky command.

```bash
# Check safety settings
flowtask config list | grep safety

# Add command to allowed list in .flowtask/config.json:
# "safety": { "allowedCommands": ["your-command"] }

# Or run with explicit approval
flowtask run --approve "your prompt"
```

### Process tree kill fails

FlowTask could not clean up child processes.

```bash
# Manually kill remaining processes
pkill -f <process-name>

# Check resource guard settings in config
```

---

## Permission & File System

### EACCES / permission denied

```bash
# Fix file permissions
chmod +r <file-path>
chmod +x <script-path>

# Fix directory permissions
chmod -R u+w .flowtask/

# Run with current user (not sudo)
npm install -g flowtask  # Use nvm or prefix instead of sudo
```

### ENOENT / file not found

```bash
# Check file exists
ls -la <path>

# Check .flowtask structure
ls -la .flowtask/

# Recreate missing files
flowtask init --force
```

### ENOSPC / no space left

```bash
# Check disk usage
df -h .

# Clean node_modules
rm -rf node_modules
pnpm install

# Clean pnpm store
pnpm store prune

# Clean npm cache
npm cache clean --force

# Remove old FlowTask run data
rm -rf .flowtask/runs/*  # ⚠️ Deletes all run history
```

---

## Docker & Deployment

### Docker not found

```bash
# Install Docker Desktop (macOS)
brew install --cask docker

# Install Docker Engine (Linux)
curl -fsSL https://get.docker.com | sh

# Verify installation
docker info
```

### Docker container exits immediately

Check container logs and resource limits.

```bash
docker logs <container-name>
docker stats <container-name>

# Increase memory limit in docker-compose.yml:
# services:
#   flowtask:
#     deploy:
#       resources:
#         limits:
#           memory: 2g
```

### Docker port conflict

```bash
# Check what is using the port
lsof -i :8080

# Stop the conflicting container
docker stop <container-name>

# Or use a different port
docker run -p 8081:8080 flowtask
```

---

## Logs & Debugging

### Finding log files

Logs are stored in `.flowtask/runs/<runId>/logs/`.

```bash
# List all runs
flowtask history

# View logs for latest run
ls -la .flowtask/runs/*/logs/

# Read runtime log
cat .flowtask/runs/<runId>/logs/runtime.log
```

### Enabling verbose output

```bash
# Run with verbose flag
flowtask run "your prompt" --verbose

# Or set in config
flowtask config set logging.level debug
```

### Reading AI planner raw output

If the AI planner fails, raw responses are saved for debugging:

```bash
ls .flowtask/runs/<runId>/outputs/
cat .flowtask/runs/<runId>/outputs/internal-ai-planner-raw-attempt-*.txt
```

### Checking environment

```bash
flowtask doctor                             # Full diagnostics
flowtask doctor --providers                 # AI provider check only
flowtask config list                        # Show all config
```

---

## Common Error Messages Reference

| Error Message                    | Category                | Likely Cause            | Quick Fix              |
| -------------------------------- | ----------------------- | ----------------------- | ---------------------- |
| `command not found`              | missing_dependency      | Tool not installed      | Install or check PATH  |
| `ENOENT`                         | missing_dependency      | File not found          | Check path exists      |
| `EACCES` / `EPERM`               | permission_error        | Permission denied       | Fix file permissions   |
| `ECONNREFUSED`                   | network_error           | Service not running     | Start the service      |
| `ENOTFOUND`                      | network_error           | DNS resolution failed   | Check network/DNS      |
| `ECONNRESET`                     | network_error           | Connection interrupted  | Check proxy/firewall   |
| `ETIMEDOUT`                      | timeout                 | Operation took too long | Increase timeout       |
| `429` / `too many requests`      | ai_provider_error       | Rate limited            | Reduce frequency       |
| `401` / `unauthorized`           | ai_provider_error       | Invalid API key         | Update API key         |
| `insufficient_quota`             | ai_provider_error       | Quota exhausted         | Check billing          |
| `JSON parse` / `invalid`         | invalid_plan            | Non-JSON from AI        | Use simple planner     |
| `not initialized`                | project_not_initialized | Missing `.flowtask/`    | Run `flowtask init`    |
| `PLANNER_INVALID_OUTPUT`         | invalid_plan            | Bad AI response         | Retry or use simple    |
| `npm ERR` / `ERR_PNPM`           | command_failure         | Package install failed  | Reinstall dependencies |
| `EADDRINUSE`                     | command_failure         | Port already in use     | Change port            |
| `ENOSPC`                         | command_failure         | Disk full               | Free up space          |
| `init fail` / `could not create` | init_failed             | Init blocked            | Check permissions      |

---

## Still Stuck?

1. Run `flowtask doctor` for a full environment health check
2. Check `docs/reference/COMMANDS.md` for the command you are using
3. Open an issue at [github.com/thanhhung-98/FlowTask/issues](https://github.com/thanhhung-98/FlowTask/issues)
