# Documentation Structure Plan

> **Status:** implemented
> **Last reviewed:** 2026-06-29
> **Scope:** Complete restructure of all project documentation and README, aligned with software project best practices and AI agent documentation standards

---

## 1. Guiding Principles

| Principle                  | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| **Single source of truth** | Each concept lives in exactly one file; other files reference it         |
| **Progressive disclosure** | README is a concise landing page; detail lives in `docs/`                |
| **Consistent metadata**    | Every doc has status, last-reviewed date, and scope header               |
| **AI-agent friendly**      | Agent instruction files are thin entry points referencing canonical docs |
| **Separation of concerns** | User docs, design docs, internal plans, and agent configs are distinct   |

---

## 2. Target File Hierarchy

```
.flowtask/                         # Internal runtime files (no change)
  rules/
    mode.md
    project.md
    workflow.md

docs/                              # All project documentation
  README.md                        # Docs landing page / index

  # ── User-facing guides ──
  guides/
    GETTING_STARTED.md             # Quick start (extracted from README)
    DEVELOPMENT.md                 # Development setup and workflow
    CONTRIBUTING.md                # How to contribute
    TROUBLESHOOTING.md             # Common issues and solutions

  # ── Reference documentation ──
  reference/
    COMMANDS.md                    # Full CLI command reference (extracted from README)
    CONFIGURATION.md               # Full config.json schema and defaults
    EXECUTORS.md                   # Executor configuration and presets
    PROVIDERS.md                   # AI provider setup and management
    HOOKS.md                       # Lifecycle hooks reference
    WORKFLOW.md                    # Workflow management reference
    SECURITY.md                    # Security model and practices
    API.md                         # Programmatic API reference
    ENV_VARS.md                    # Environment variable reference

  # ── Product / design docs ──
  design/
    IDEA.md                        # Product concept and vision (renamed from IDEA.MD)
    TECHNICAL.md                   # Full technical design (renamed from TECHNICAL.MD)
    OUTCOME_BASED_VALIDATION.md    # Design proposal (add status badge)
    STRUCTURED_OUTPUT_PLAN.md      # Design proposal (add status badge)
    DESIGN_STEP_APPROVAL.md        # Design proposal (add status badge)
    ai-validator-design.md         # Design proposal (add status badge)

  # ── Internal / planning ──
  internal/
    ARCHITECTURE_REVIEW.md         # Internal improvement plan
    documentation-analysis-report.md
    documentation-structure-plan.md

  # ── AI agent guidance ──
  agents/
    AI_AGENT_RULES.md              # Shared AI agent rules (single source of truth)
    CODEGRAPH.md                   # Codegraph usage guide

# Root-level files (consolidated)
README.md                          # Concise project landing page (~200 lines)
AGENTS.md                          # opencode entry point → references docs/
CLAUDE.md                          # Claude Code entry point → references docs/
CHANGELOG.md                       # Auto-generated from conventional commits (NEW)
CODE_OF_CONDUCT.md                 # GitHub community standard (NEW)
SUPPORT.md                         # How to get help (NEW)
ROADMAP.md                         # Future direction (NEW)

# AI agent config files (minimal pointers)
.github/copilot-instructions.md    # Minimal → references docs/agents/AI_AGENT_RULES.md
.cursor/rules/flowtask.mdc         # Minimal → references docs/agents/AI_AGENT_RULES.md
```

---

## 3. README.md — Concise Landing Page (~200 lines)

The new README follows the **Make a README** best-practice pattern:

| Section               | Content                                                                  | Source         |
| --------------------- | ------------------------------------------------------------------------ | -------------- |
| **Title + badges**    | Project name, icon, CI/release/license badges                            | Keep           |
| **One-liner**         | "Prompt → Rules → Tasks → Execution → Validation → Report"               | Keep           |
| **What is FlowTask?** | 2-3 paragraph elevator pitch                                             | Keep, condense |
| **Key features**      | Bullet list of 6-8 major features                                        | Keep, condense |
| **Quick start**       | `pnpm install && pnpm dev init && pnpm dev run "prompt"`                 | Keep           |
| **How it works**      | Pipeline diagram (2-3 lines)                                             | Keep, minimal  |
| **Commands overview** | Table of 10-12 most-used commands (list is `docs/reference/COMMANDS.md`) | Extract        |
| **Learn more**        | Links to key docs: Getting Started, Configuration, Providers, etc.       | Restructure    |
| **Project status**    | Badge or short note                                                      | Keep           |
| **License**           | MIT                                                                      | Keep           |

**Removed from README** (moved to reference docs):

- Full command list (→ `docs/reference/COMMANDS.md`)
- Executor JSON config (→ `docs/reference/EXECUTORS.md`)
- Lifecycle hooks table (→ `docs/reference/HOOKS.md`)
- Workflow output examples (→ `docs/reference/WORKFLOW.md`)
- AI provider setup details (→ `docs/reference/PROVIDERS.md`)
- Project structure tree (→ `docs/guides/DEVELOPMENT.md`)
- Planner mode details (→ `docs/design/TECHNICAL.md`)
- Troubleshooting (→ `docs/guides/TROUBLESHOOTING.md`)

---

## 4. Document Content Outlines

### 4.1 `docs/README.md` — Documentation Index

```
# Documentation

> Status: maintained

[Guides]     [Reference]     [Design]     [Internal]     [AI Agents]

## Quick Links
- Getting Started
- CLI Commands
- Configuration
- AI Providers
- Contributing

## Documentation Map
- Brief description of each section
- When to read which doc
```

### 4.2 `docs/guides/GETTING_STARTED.md`

````
# Getting Started

> Status: maintained

## Prerequisites
- Node.js 22+, pnpm 9+

## Installation
```bash
git clone <repo>
pnpm install
````

## First Run

```bash
pnpm dev init --name "My Project" --mode development
pnpm dev run "your prompt"
```

## Next Steps

- Link to DEVELOPMENT.md, CONFIGURATION.md, COMMANDS.md

```

### 4.3 `docs/guides/TROUBLESHOOTING.md`

```

# Troubleshooting

> Status: maintained

## AI Planner Returns Non-JSON

- How FlowTask handles it (extraction → retry → fallback)
- Debug commands

## Run Won't Resume

- Check state files
- Manual resume flags

## Executor Not Found

- Check executors config
- Verify binary is installed

## Common Errors

- Table of error messages, causes, solutions

```

### 4.4 `docs/reference/COMMANDS.md`

```

# CLI Command Reference

> Status: maintained

## Global Options

--help, --version, --debug

## Command Groups

- **Project**: init, setup, status, doctor
- **Run**: run, resume, retry, stop, cancel, clean
- **Tasks**: tasks, tasks-edit, tasks-approve
- **Workflow**: workflow list, show, diff, apply, add, remove, reorder, edit, replan
- **Steps**: steps, step edit, step approve, step deny, step approve-all
- **Providers**: providers list, current, test, configure, remove, doctor
- **Config**: config get, set, list
- **Rules**: rules list, scan, add, validate
- **Logs**: logs, logs --follow

(Each command with full syntax, options, examples)

```

### 4.5 `docs/reference/CONFIGURATION.md`

```

# Configuration Reference

> Status: maintained

## Config File Location

.flowtask/config.json

## Schema

Full config.json schema with all sections:

- version, projectMode, defaultExecutor
- rules (paths, required, maxFileSizeKb)
- approval (enabled, autoApprove, requireFor)
- validation (profile, concurrency, timeout, commands)
- limits (maxRunMinutes, maxTaskMinutes, maxRetries)
- hooks (beforeRun, afterRun, ..., failOnError)
- logging (maxInMemoryLines, maxLineLength)
- planner (default, type, provider, model)
- ai (providers)
- executors (all presets)

```

### 4.6 `docs/agents/AI_AGENT_RULES.md` — Single Source of Truth

```

# AI Agent Rules

> Status: maintained
> Audience: All AI coding agents (opencode, Claude Code, Copilot, Cursor)

## 1. Read Design First

Before making changes, read: IDEA.md, TECHNICAL.md

## 2. Code Standards

- Strict TypeScript, no `any`
- zod for schemas
- Named exports only
- path.join, path.isAbsolute, getShell(), spawn (not exec)
- Atomic writes
- Small modules, thin CLI layer

## 3. Planner Modes

simple | ai | auto (default)

## 4. AI Planner Contract

- Planner returns clean JSON
- Executor is external AI CLI
- Invalid output → extract → retry → fallback/fail

## 5. Validation Rule

Never trust "AI says done". Trust evidence.

## 6. Quality

pnpm quality must pass before commit.

## 7. Scope Discipline

No databases, web UIs, cloud features, unnecessary deps.

## 8. Testing

Every feature needs tests. Regression tests for bugs.

```

### 4.7 Agent Entry Points (thin)

**`AGENTS.md`** (opencode):
```

# FlowTask — opencode Instructions

Read these docs before working:

- `docs/agents/AI_AGENT_RULES.md` — all shared rules
- `docs/design/IDEA.md` — product concept
- `docs/design/TECHNICAL.md` — architecture
- `README.md` — project overview

## opencode-Specific Instructions

[any opencode-specific guidance]

````

**`CLAUDE.md`** (Claude Code): same pattern, references `docs/agents/AI_AGENT_RULES.md`.

**`.github/copilot-instructions.md`**: minimal, references same.

**`.cursor/rules/flowtask.mdc`**: minimal, references same.

---

## 5. Migration Steps

| Step | Action | Files Affected |
|------|--------|---------------|
| 1 | Rename `IDEA.MD` → `IDEA.md` | `docs/IDEA.MD` |
| 2 | Rename `TECHNICAL.MD` → `TECHNICAL.md` | `docs/TECHNICAL.MD` |
| 3 | Move to `docs/design/` | `IDEA.md`, `TECHNICAL.md`, design proposals |
| 4 | Create `docs/guides/` | GETTING_STARTED, TROUBLESHOOTING (from README) |
| 5 | Create `docs/reference/` | COMMANDS, CONFIGURATION, EXECUTORS, PROVIDERS, HOOKS, WORKFLOW, SECURITY, API, ENV_VARS |
| 6 | Create `docs/agents/` | AI_AGENT_RULES.md (consolidated), CODEGRAPH.md |
| 7 | Create `docs/internal/` | ARCHITECTURE_REVIEW, analysis reports, this plan |
| 8 | Create `docs/README.md` | Documentation index |
| 9 | Rewrite root `README.md` | Condense to ~200 lines, link to reference docs |
| 10 | Thin agent entry points | AGENTS.md, CLAUDE.md → reference docs/agents/ |
| 11 | Thin AI config files | copilot-instructions.md, flowtask.mdc → reference docs/agents/ |
| 12 | Update all cross-references | Every file that links to renamed/moved docs |
| 13 | Add status badges | All design docs, all existing docs |
| 14 | Create missing root docs | CHANGELOG.md, CODE_OF_CONDUCT.md, SUPPORT.md, ROADMAP.md |
| 15 | Update agent config `rules.paths` | `.flowtask/config.json` rules paths |

---

## 6. Status Badge Convention

Every document starts with a metadata header:

```markdown
> **Status:** maintained | draft | in-progress | deprecated
> **Last reviewed:** 2026-06-29
> **Audience:** users | contributors | maintainers | ai-agents
````

---

## 7. Key Benefits

- **Single source of truth** — Code standards, planner modes, validation rule each exist in exactly one place
- **Reduced duplication** — From 7+ redundant sources to 1 canonical source + thin entry points
- **Progressive disclosure** — README fits on one screen; details in reference docs
- **Standard compliance** — CHANGELOG, CODE_OF_CONDUCT, SUPPORT, ROADMAP match GitHub community standards
- **AI-agent friendly** — Agent files are minimal; authoritative content is shared
- **Consistent naming** — All `.md`, no `.MD`
- **Clear separation** — User docs vs design docs vs internal plans
- **Easy to maintain** — One place to update per concept; references auto-update
