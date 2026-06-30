# Installation Guide

> **Status:** maintained | **Last reviewed:** 2026-06-30 | **Audience:** users

## Prerequisites

- **Node.js** 22+ — [Download](https://nodejs.org/)
- **npm**, **pnpm**, or **yarn** — One package manager is required

Verify your environment:

```bash
node --version   # Must be >= v22.0.0
npm --version    # or pnpm --version, or yarn --version
```

## Global Installation

### Install via npm

```bash
npm install -g flowtask
```

### Install via pnpm

> **Note:** If you haven't run `pnpm setup` before, pnpm may not have a global bin directory configured. Run it once, or set `PNPM_HOME` manually:

```bash
pnpm setup      # One-time setup (configures global bin in PATH)
pnpm add -g flowtask
```

### Install via yarn

```bash
yarn global add flowtask
```

### Install from source

```bash
git clone https://github.com/phamthanhhung/flowtask.git
cd flowtask
pnpm install
pnpm build
npm install -g .
```

## Verify Installation

```bash
flowtask --version
```

You should see the installed version (e.g. `0.1.0`).

## Quick Start

```bash
# Initialize a project
flowtask init --name "My Project" --mode development

# Check system health
flowtask doctor

# Run your first workflow
flowtask run "your prompt here"
```

## Common Issues

| Issue                         | Cause                          | Solution                                |
| ----------------------------- | ------------------------------ | --------------------------------------- |
| `command not found: flowtask` | Global bin not in PATH         | Ensure npm global bin is in your `PATH` |
| `Node.js version mismatch`    | Node.js < 22                   | Upgrade to Node.js 22+                  |
| `Permission denied`           | Global install without sudo    | Retry with `sudo` (Unix/macOS)          |
| `Cannot find module`          | Build not run (source install) | Run `pnpm build` before global install  |

### Fixing PATH

Add npm global binaries to your shell profile:

**macOS / Linux (bash/zsh):**

```bash
# npm
export PATH="$(npm config get prefix)/bin:$PATH"

# pnpm
export PATH="$(pnpm config get prefix)/bin:$PATH"

# yarn
export PATH="$(yarn global bin):$PATH"
```

**Windows (PowerShell):**

```powershell
# npm
$env:Path += ";$(npm config get prefix)\bin"

# pnpm
$env:Path += ";$(pnpm config get prefix)\bin"

# yarn
$env:Path += ";$(yarn global bin)"
```

## Upgrading

```bash
# npm
npm update -g flowtask

# pnpm
pnpm update -g flowtask

# yarn
yarn global upgrade flowtask
```

## Uninstalling

```bash
# npm
npm uninstall -g flowtask

# pnpm
pnpm remove -g flowtask

# yarn
yarn global remove flowtask
```

## Next Steps

- [Getting Started](GETTING_STARTED.md) — Install and run your first workflow
- [CLI Commands](../reference/COMMANDS.md) — Full command reference
- [Configuration](../reference/CONFIGURATION.md) — Configure FlowTask
- [Troubleshooting](TROUBLESHOOTING.md) — Common issues and solutions
