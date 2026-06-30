# Deployment Guide

> **Status:** maintained | **Last reviewed:** 2026-06-30 | **Audience:** ops, self-hosters

## Overview

FlowTask can be deployed on a VPS or cloud VM. The recommended approach is **Docker**, but a manual Node.js installation is also supported.

## Prerequisites

- A Linux server (Ubuntu 22.04+ or Debian 12+ recommended)
- Docker and Docker Compose (recommended) OR Node.js 22+ and pnpm 9+
- API keys for the AI providers you plan to use
- A domain or subdomain (optional, for HTTPS endpoints)

## Environment Variables

FlowTask reads API keys from environment variables:

| Variable                    | Provider     | Required |
| --------------------------- | ------------ | -------- |
| `OPENAI_API_KEY`            | OpenAI       | Yes\*    |
| `ANTHROPIC_API_KEY`         | Anthropic    | No       |
| `GEMINI_API_KEY`            | Gemini       | No       |
| `DEEPSEEK_API_KEY`          | DeepSeek     | No       |
| `GROQ_API_KEY`              | Groq         | No       |
| `MISTRAL_API_KEY`           | Mistral      | No       |
| `OPENROUTER_API_KEY`        | OpenRouter   | No       |
| `TOGETHER_API_KEY`          | Together     | No       |
| `FIREWORKS_API_KEY`         | Fireworks    | No       |
| `AZURE_OPENAI_API_KEY`      | Azure OpenAI | No       |
| `BYTEPLUS_MODELARK_API_KEY` | BytePlus     | No       |

\* At least one provider is required.

### Environment File

Create a `.env` file in the project root:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

> **Security:** Add `.env` to `.gitignore`. Never commit API keys.

---

## Option 1: Docker Deployment (Recommended)

### Build the Image

```bash
docker build -t flowtask:latest .
```

### Run with Docker

```bash
docker run -it --rm \
  -v $(pwd):/project \
  -v flowtask-data:/app/.flowtask \
  -e OPENAI_API_KEY=${OPENAI_API_KEY} \
  flowtask:latest init
```

### Run with Docker Compose

```bash
# Start with interactive session
docker compose run --rm flowtask run "update readme"

# Start as interactive shell
docker compose run --rm flowtask doctor
```

### Docker Compose in Production

For long-running usage, create a `docker-compose.prod.yml`:

```yaml
services:
  flowtask:
    image: flowtask:latest
    container_name: flowtask
    volumes:
      - ./project:/project
      - flowtask-data:/app/.flowtask
    working_dir: /project
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    restart: "no"
    stdin_open: true
    tty: true

volumes:
  flowtask-data:
```

### Docker Health Check

The image includes `CMD ["--help"]` as the default. For custom health checks, extend the Dockerfile:

```dockerfile
FROM flowtask:latest
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT:-3000}/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
```

---

## Option 2: Manual VPS Deployment

### Install Dependencies

```bash
# Install Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs git

# Install pnpm
corepack enable && corepack prepare pnpm@9.14.0 --activate

# Clone the project
git clone https://github.com/your-org/flowtask.git /opt/flowtask
cd /opt/flowtask
pnpm install --frozen-lockfile
pnpm build
```

### Configure

```bash
# Create project directory and initialize
mkdir -p /opt/my-project
cd /opt/my-project
/opt/flowtask/dist/index.js init

# Set up API keys
cat <<EOF > /opt/my-project/.env
OPENAI_API_KEY=sk-...
EOF
```

### Run as a Service (systemd)

Example systemd service files are available in `examples/systemd/`:

```
examples/systemd/
├── flowtask.service      # Production systemd unit
└── .env.example          # Environment file template
```

Copy them to your server:

```bash
# Install the service unit
sudo cp examples/systemd/flowtask.service /etc/systemd/system/

# Create and edit the environment file
cp examples/systemd/.env.example /opt/my-project/.env
# Edit /opt/my-project/.env with your API keys
```

The service unit (`examples/systemd/flowtask.service`):

```ini
[Unit]
Description=FlowTask AI Task Runtime
Documentation=https://github.com/thanhhung-98/FlowTask
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=flowtask
Group=flowtask
WorkingDirectory=/opt/my-project
ExecStart=/usr/bin/node /opt/flowtask/dist/index.js run --watch
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
EnvironmentFile=/opt/my-project/.env
AmbientCapabilities=
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/my-project /opt/flowtask

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable flowtask
sudo systemctl start flowtask
sudo systemctl status flowtask
```

---

## Health Checks

### Docker Health

```bash
# Check container is running
docker ps --filter name=flowtask

# Verify the binary starts correctly
docker run --rm flowtask:latest doctor
```

### Manual Health

```bash
# Check Node.js version
node --version

# Verify FlowTask works
/opt/flowtask/dist/index.js doctor

# Check project integrity
/opt/flowtask/dist/index.js doctor --verbose
```

---

## Logging

### Docker Logs

```bash
docker compose logs -f flowtask
docker compose logs --tail=100 flowtask
```

### systemd Logs

```bash
sudo journalctl -u flowtask -f
sudo journalctl -u flowtask --since "1 hour ago"
```

---

## Troubleshooting

| Symptom                     | Likely Cause                   | Solution                                      |
| --------------------------- | ------------------------------ | --------------------------------------------- |
| `Connection refused`        | Ollama/LM Studio not running   | Start the local service or configure a remote |
| `API key not set`           | Missing environment variable   | Check `.env` and `docker compose config`      |
| `403 Forbidden`             | Invalid or expired API key     | Regenerate the key in the provider dashboard  |
| Container exits immediately | No command or TTY flag missing | Use `docker run -it` or `docker compose run`  |
| `Permission denied`         | Volume ownership mismatch      | Ensure container user matches host UID        |
| Out of memory               | Large task with many files     | Increase Docker memory limit or swap          |

---

## Upgrading

### Docker

```bash
git pull
docker build --no-cache -t flowtask:latest .
docker compose run --rm flowtask doctor
```

### Manual

```bash
cd /opt/flowtask
git pull
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart flowtask
```

---

## Security Notes

- Run FlowTask as an unprivileged user (Docker images use `flowtask` user by default)
- Store API keys in environment variables, not in code
- Use `--frozen-lockfile` in CI/CD to prevent dependency drift
- Pin the base image tag (use `node:22-alpine` instead of `node:latest`)
- Regularly audit `pnpm audit` and rebuild the Docker image

---

## Next Steps

- [Getting Started](GETTING_STARTED.md) — Run your first workflow
- [Doctor command](../reference/COMMANDS.md#doctor) — Validate the environment
- [Configuration](../reference/CONFIGURATION.md) — Advanced config options
