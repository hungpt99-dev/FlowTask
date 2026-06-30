# Docker Setup Guide

> **Status:** maintained | **Last reviewed:** 2026-06-30 | **Audience:** users, ops

## Overview

Running FlowTask in a container provides an isolated, reproducible environment without installing Node.js or pnpm on your host machine. You can use:

- **Docker** — Build and run FlowTask as a standalone container
- **Docker Compose** — Multi-service setup with optional Ollama sidecar

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/install/) v2+ (included with Docker Desktop)
- API keys for at least one AI provider

## Quick Start

```bash
# Clone the project
git clone https://github.com/phamthanhhung/flowtask.git
cd flowtask

# Build the image
docker build -f docker/Dockerfile -t flowtask:latest .

# Run a command
docker run --rm -it \
  -v $(pwd):/project \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  flowtask:latest init --name "My Project"
```

## Project Structure

```
flowtask/
├── docker/
│   ├── Dockerfile           # Multi-stage build definition
│   └── docker-compose.yml   # Compose configuration with health checks
├── .dockerignore        # Files excluded from Docker build context
└── docs/guides/DOCKER.md # This guide
```

## Docker Image

### Building

```bash
docker build -f docker/Dockerfile -t flowtask:latest .
```

The `Dockerfile` (`docker/Dockerfile`) uses a multi-stage build:

| Stage     | Base             | Purpose                               |
| --------- | ---------------- | ------------------------------------- |
| `builder` | `node:24-alpine` | Install deps, compile TypeScript      |
| (final)   | `node:24-alpine` | Copy compiled output, run as non-root |

The final image includes:

- Compiled JS in `/app/dist`
- Production `node_modules` (pruned)
- A `flowtask` unprivileged user
- `HEALTHCHECK` — runs `flowtask doctor` every 30s
- Default command: `--help`

### Environment Variables

Pass API keys via `-e` or `--env-file`:

```bash
docker run --rm -it \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  flowtask:latest doctor
```

### Volume Mounts

FlowTask reads/writes to the current project directory. Mount it so state persists:

```bash
docker run --rm -it \
  -v $(pwd):/project \
  -v flowtask-data:/app/.flowtask \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  flowtask:latest run "your prompt"
```

| Mount           | Container Path   | Purpose                         |
| --------------- | ---------------- | ------------------------------- |
| `$(pwd)` (host) | `/project`       | Project files, `.flowtask/`     |
| `flowtask-data` | `/app/.flowtask` | Persistent run/task data (opt.) |

### Using an Environment File

```bash
# .env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

docker run --rm -it --env-file .env \
  -v $(pwd):/project \
  flowtask:latest doctor
```

> **Security:** Add `.env` to `.gitignore`. Never commit secrets.

## Docker Compose

### Basic Usage

```bash
# Build and run a one-off command
docker compose -f docker/docker-compose.yml run --rm flowtask init --name "My Project"

# Run system health check
docker compose -f docker/docker-compose.yml run --rm flowtask doctor

# Start an interactive workflow
docker compose -f docker/docker-compose.yml run --rm flowtask run "Update README"
```

The `docker-compose.yml` defines the `flowtask` service with:

- Current directory mounted at `/project`
- Persistent volume for `.flowtask` data
- All AI provider API keys from host environment or `.env`
- `stdin_open: true` + `tty: true` for interactive CLI
- Health check via `flowtask doctor`

### With Ollama Sidecar

FlowTask can use a local Ollama instance for AI planning. Start both services:

```bash
# Start Ollama in background, then run FlowTask
docker compose -f docker/docker-compose.yml --profile ollama up -d ollama
docker compose -f docker/docker-compose.yml run --rm flowtask doctor

# Or run everything in one go
docker compose -f docker/docker-compose.yml --profile ollama run --rm flowtask run "your prompt"
```

The Ollama service:

- Name: `flowtask-ollama`
- Port: `11434`
- Persistent volume: `ollama-data`
- Health check: `ollama list`
- Only starts with `--profile ollama`

FlowTask's `OLLAMA_BASE_URL` defaults to `http://ollama:11434` in the compose environment.

### Viewing Logs

```bash
# Stream logs
docker compose -f docker/docker-compose.yml logs -f flowtask

# Last 100 lines
docker compose -f docker/docker-compose.yml logs --tail=100 flowtask
```

## Commands Reference

| Task                     | Command                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| Initialize a project     | `docker compose -f docker/docker-compose.yml run --rm flowtask init ...` |
| Run a workflow           | `docker compose -f docker/docker-compose.yml run --rm flowtask run ...`  |
| Check system health      | `docker compose -f docker/docker-compose.yml run --rm flowtask doctor`   |
| List tasks               | `docker compose -f docker/docker-compose.yml run --rm flowtask tasks`    |
| Resume interrupted run   | `docker compose -f docker/docker-compose.yml run --rm flowtask resume`   |
| Retry a failed task      | `docker compose -f docker/docker-compose.yml run --rm flowtask retry`    |
| Configure AI provider    | `docker compose -f docker/docker-compose.yml run --rm flowtask setup`    |
| List AI providers        | `docker compose -f docker/docker-compose.yml run --rm flowtask ...`      |
| Show help                | `docker compose -f docker/docker-compose.yml run --rm flowtask --help`   |
| Access interactive shell | `docker compose -f docker/docker-compose.yml run --rm flowtask /bin/sh`  |

## Health Checks

### Container Health

```bash
# Check container status
docker ps --filter name=flowtask

# Inspect health
docker inspect --format='{{json .State.Health}}' flowtask

# Run doctor explicitly
docker compose -f docker/docker-compose.yml run --rm flowtask doctor
```

### Dockerfile HEALTHCHECK

The `Dockerfile` includes:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node dist/index.js doctor > /dev/null 2>&1 || exit 1
```

This runs `flowtask doctor` every 30 seconds. The container is `healthy` when the doctor check exits 0.

## Production Considerations

### Image Tagging

```bash
# Tag with version
docker build -f docker/Dockerfile -t flowtask:0.1.0 .
docker tag flowtask:0.1.0 flowtask:latest

# Or use git commit hash
docker build -f docker/Dockerfile -t flowtask:$(git rev-parse --short HEAD) .
```

### Resource Limits

```yaml
# docker-compose.override.yml
services:
  flowtask:
    deploy:
      resources:
        limits:
          cpus: "2"
          memory: "4G"
        reservations:
          cpus: "1"
          memory: "1G"
```

### Non-Interactive Mode

In CI/CD, omit `-it` flags:

```bash
docker run --rm \
  -v $(pwd):/project \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  flowtask:latest doctor
```

### Rebuilding

```bash
git pull
docker build --no-cache -f docker/Dockerfile -t flowtask:latest .
docker compose -f docker/docker-compose.yml run --rm flowtask doctor
```

## Troubleshooting

| Symptom                       | Likely Cause                   | Solution                                                                               |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| `command not found`           | Image not built                | Run `docker build -f docker/Dockerfile -t flowtask:latest .`                           |
| `API key not set`             | Missing env variable           | Pass `-e` flag or use `--env-file`                                                     |
| Container exits immediately   | No TTY for interactive command | Use `docker run -it` or `docker compose -f docker/docker-compose.yml run`              |
| Permission denied             | Volume ownership mismatch      | Ensure container user matches host UID                                                 |
| `Connection refused` (Ollama) | Ollama not running             | Start with `docker compose -f docker/docker-compose.yml --profile ollama up -d ollama` |
| Slow build                    | Missing `.dockerignore`        | Ensure `.dockerignore` excludes `node_modules`, `.git`                                 |
| `Health check timed out`      | First run takes longer         | Increase `start_period` in HEALTHCHECK                                                 |

## Next Steps

- [Getting Started](GETTING_STARTED.md) — Run your first workflow
- [Installation](INSTALLATION.md) — Native install (no Docker)
- [Deployment Guide](deployment.md) — VPS and production deployment
- [Configuration](../reference/CONFIGURATION.md) — Advanced config options
- [Troubleshooting](TROUBLESHOOTING.md) — Common issues and solutions
