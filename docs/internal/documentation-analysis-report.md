# Documentation Analysis Report

> **Status:** superseded | **Last reviewed:** 2026-06-29 | **Audience:** internal

> **Date:** 2026-06-29
> **Scope:** All markdown files in project root, `docs/`, and AI agent config directories
> **Purpose:** Identify structural issues, outdated content, inconsistencies, and gaps before restructuring

---

## 1. File Inventory

### Root-level files (4)

| File        | Lines | Purpose                                             |
| ----------- | ----- | --------------------------------------------------- |
| `README.md` | 575   | Main project README (usage, commands, architecture) |
| `AGENTS.md` | ~90   | opencode AI agent instructions                      |
| `CLAUDE.md` | ~75   | Claude Code AI agent instructions                   |
| `LICENSE`   | —     | MIT license                                         |

### `docs/` directory (16 files across 2 levels)

| File                            | Lines  | Type                      |
| ------------------------------- | ------ | ------------------------- |
| `IDEA.MD`                       | 1,556  | Product concept doc       |
| `TECHNICAL.MD`                  | 3,818  | Technical design doc      |
| `AI_AGENT_RULES.md`             | ~80    | AI agent behavior rules   |
| `CODE_QUALITY.md`               | ~85    | Code quality standards    |
| `DEVELOPMENT.md`                | ~120   | Development guide         |
| `CONTRIBUTING.md`               | 101    | Contribution guide        |
| `GIT_WORKFLOW.md`               | 40     | Git conventions           |
| `SECURITY.md`                   | 66     | Security policies         |
| `ARCHITECTURE_REVIEW.md`        | ~1,200 | Internal improvement plan |
| `OUTCOME_BASED_VALIDATION.md`   | 493    | Design proposal           |
| `STRUCTURED_OUTPUT_PLAN.md`     | 279    | Design proposal           |
| `DESIGN_STEP_APPROVAL.md`       | 506    | Design proposal           |
| `CODEGRAPH.md`                  | 42     | Codegraph usage           |
| `design/ai-validator-design.md` | 304    | Design proposal           |

### AI agent config files (2)

| File                              | Purpose                     |
| --------------------------------- | --------------------------- |
| `.github/copilot-instructions.md` | GitHub Copilot instructions |
| `.cursor/rules/flowtask.mdc`      | Cursor AI rules             |

### `.flowtask/rules/` (3)

| File          | Purpose                |
| ------------- | ---------------------- |
| `mode.md`     | Development mode rules |
| `project.md`  | Project rules          |
| `workflow.md` | Workflow rules         |

---

## 2. Critical Issues

### 2.1 Massive Information Duplication

The following content is duplicated across **7+ files** with slight variations:

- **Planner modes** (simple/ai/auto): README, AGENTS.md, CLAUDE.md, AI_AGENT_RULES.md, DEVELOPMENT.md, copilot-instructions.md, flowtask.mdc
- **AI provider architecture** (8 providers): README, AGENTS.md, CLAUDE.md, DEVELOPMENT.md, TECHNICAL.MD
- **Development rules** (strict TS, zod, path.join, getShell, spawn): AGENTS.md, CLAUDE.md, AI_AGENT_RULES.md, CODE_QUALITY.md, copilot-instructions.md, flowtask.mdc, CONTRIBUTING.md
- **Validation rule** ("never trust AI says done"): AGENTS.md, AI_AGENT_RULES.md, CLAUDE.md, copilot-instructions.md, IDEA.MD, TECHNICAL.MD
- **Lifecycle hooks** table: AGENTS.md, README.md, TECHNICAL.MD, DEVELOPMENT.md
- **Project structure** tree: README.md, DEVELOPMENT.md, CONTRIBUTING.md, TECHNICAL.MD

**Impact:** Updates must be made in 5-7 places. Inconsistencies have already appeared (see §2.2).

### 2.2 Outdated / Inconsistent Content

| Issue                    | Location                                                                                                               | Detail                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Test count format        | `README.md:49`                                                                                                         | "1353 tests"                                                     |
| Test count format        | `TECHNICAL.MD`                                                                                                         | "1352 passed, 1 failed (1353 total)" — inconsistent presentation |
| "Uses SQLite"            | `IDEA.MD:95`                                                                                                           | Says SQLite is fully implemented                                 |
| "No database"            | `TECHNICAL.MD:157`                                                                                                     | Says "No database required for MVP" then mentions SQLite         |
| Architecture Review date | `ARCHITECTURE_REVIEW.md:4`                                                                                             | Dated 2026-06-29, appears newly created, unclear if implemented  |
| Design docs vs. reality  | `OUTCOME_BASED_VALIDATION.md`, `STRUCTURED_OUTPUT_PLAN.md`, `DESIGN_STEP_APPROVAL.md`, `design/ai-validator-design.md` | No status indicator — impossible to tell implemented vs. planned |
| `Gemini` typo            | `README.md:203`                                                                                                        | "Gemin" instead of "Gemini"                                      |
| MVP language             | `IDEA.MD:1228`, `TECHNICAL.MD:34`                                                                                      | Refers to MVP as future while features are already built         |

### 2.3 Naming Inconsistency

| Convention        | Files                     |
| ----------------- | ------------------------- |
| `.MD` (uppercase) | `IDEA.MD`, `TECHNICAL.MD` |
| `.md` (lowercase) | All other docs            |

**Impact:** Case-sensitive filesystems (Linux) may cause broken links. Inconsistent with conventions.

### 2.4 Missing Standard Documents

| Document             | Reason Required                                                                         |
| -------------------- | --------------------------------------------------------------------------------------- |
| `CHANGELOG.md`       | Standard for any released project                                                       |
| `CODE_OF_CONDUCT.md` | GitHub community standard                                                               |
| `ROADMAP.md`         | No single place for future direction (scattered across IDEA.MD §32, TECHNICAL.MD §35.3) |
| `SUPPORT.md`         | Where to get help / GitHub community standards                                          |

---

## 3. Structural Issues

### 3.1 No Clear Separation: Design Docs vs. User Docs

Design proposals and user-facing documentation are mixed in the same directory:

- **User-facing**: `DEVELOPMENT.md`, `CONTRIBUTING.md`, `GIT_WORKFLOW.md`, `SECURITY.md`, `CODEGRAPH.md`
- **Design docs**: `OUTCOME_BASED_VALIDATION.md`, `STRUCTURED_OUTPUT_PLAN.md`, `DESIGN_STEP_APPROVAL.md`, `design/ai-validator-design.md`, `ARCHITECTURE_REVIEW.md`

**Recommendation:** Move design docs to `docs/design/` or a separate `design/` directory, or add explicit status badges.

### 3.2 README is Too Large (575 lines)

The README contains detailed command references, executor config JSON, lifecycle hook tables, and workflow output examples that belong in separate reference docs. A good README should be **concise** with signposts to detailed documentation.

### 3.3 No Documentation Index

No `docs/README.md` or `docs/INDEX.md` to guide readers through the documentation tree.

### 3.4 No Consistent Metadata

No document has:

- Document status (`implemented` / `in-progress` / `planned`)
- Last reviewed date
- Version/iteration number
- Owner/maintainer

---

## 4. Missing Best Practices

### 4.1 Missing Reference Documentation

| Document                                   | Purpose                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `docs/API.md`                              | Programmatic API reference                                         |
| `docs/ENV_VARS.md`                         | Environment variable reference                                     |
| `docs/FAQ.md` or `docs/TROUBLESHOOTING.md` | Common issues and solutions                                        |
| `docs/UPGRADE.md` or `docs/MIGRATION.md`   | Version upgrade/migration guide                                    |
| `docs/ARCHITECTURE.md`                     | Clean architecture overview (separate from 3818-line TECHNICAL.MD) |
| `docs/CONFIGURATION.md`                    | Complete config.json reference                                     |

### 4.2 Missing AI Agent Alignment

| Feature                                                       | Status  |
| ------------------------------------------------------------- | ------- |
| `.opencode.json` or dedicated AI agent config                 | Missing |
| Subagent definitions for specialized tasks                    | Missing |
| Skill configurations                                          | Missing |
| MCP server documentation                                      | Missing |
| Cross-agent consistency (all agent files duplicate same info) | Poor    |

### 4.3 Documentation Testing / CI

- `pnpm validate:docs` exists but what it validates is unclear
- No broken link checking
- No rendering preview check
- No linting for markdown style

---

## 5. AI Agent File Analysis

### 5.1 File Proliferation

Five separate AI agent instruction files exist:

1. `AGENTS.md` (opencode)
2. `CLAUDE.md` (Claude Code)
3. `docs/AI_AGENT_RULES.md` (shared rules)
4. `.github/copilot-instructions.md` (GitHub Copilot)
5. `.cursor/rules/flowtask.mdc` (Cursor)
6. `.flowtask/rules/mode.md` (FlowTask internal)
7. `.flowtask/rules/project.md` (FlowTask internal)
8. `.flowtask/rules/workflow.md` (FlowTask internal)

**Problem:** Each file repeats 70-80% of the same information (planner modes, code standards, validation rules). Updates are fragile. Solution: Have _one_ authoritative source (`docs/CODE_QUALITY.md`, `docs/AI_AGENT_RULES.md`) and have agent files reference them.

### 5.2 Specific Inconsistencies

| Item                | AGENTS.md           | CLAUDE.md           | copilot-instructions.md |
| ------------------- | ------------------- | ------------------- | ----------------------- |
| Language            | Strict TS, no `any` | Strict TS, no `any` | Strict TS, no `any`     |
| Schema tool         | zod                 | zod                 | zod                     |
| Export style        | Named only          | Named only          | Named only              |
| Shell detection     | getShell()          | getShell()          | getShell()              |
| Planning fallback   | auto default        | auto default        | auto default            |
| `fast-glob` mention | Missing             | Missing             | Present                 |

**Minor inconsistency:** `copilot-instructions.md` mentions `fast-glob` requirement not present in other agent files.

---

## 6. Recommendations for Restructuring

### 6.1 Proposed Directory Layout

```
docs/
  README.md              # Documentation index/landing page
  ARCHITECTURE.md        # Concise architecture overview (extracted from TECHNICAL.MD)
  CONFIGURATION.md       # Full config.json reference
  API.md                 # Programmatic API reference
  ENV_VARS.md            # Environment variable reference

  guides/
    GETTING_STARTED.md   # Quick start (extracted from README)
    DEVELOPMENT.md       # Development setup and workflow
    CONTRIBUTING.md      # Contributing guide
    TROUBLESHOOTING.md   # Common issues and solutions

  reference/
    COMMANDS.md          # Complete CLI command reference (extracted from README)
    EXECUTORS.md         # Executor configuration reference
    PROVIDERS.md         # AI provider configuration
    HOOKS.md             # Lifecycle hooks reference
    WORKFLOW.md          # Workflow management reference

  design/                # Design documents (keep but add status badges)
    TECHNICAL.MD         # Full technical design (as-is or split)
    OUTCOME_BASED_VALIDATION.md
    STRUCTURED_OUTPUT_PLAN.md
    DESIGN_STEP_APPROVAL.md
    ai-validator-design.md
    ARCHITECTURE_REVIEW.md

  internal/              # Internal improvement plans
    ARCHITECTURE_REVIEW.md  # Move here
```

### 6.2 Consolidate Agent Files

- Keep `AGENTS.md` and `CLAUDE.md` as thin entry points that reference `docs/`
- Move shared rules to `docs/AI_AGENT_RULES.md` (single source of truth)
- Have agent-specific files focus only on agent-specific instructions
- Reduce `.github/copilot-instructions.md` and `.cursor/rules/flowtask.mdc` to minimal pointers

### 6.3 Add Missing Documents

- `CHANGELOG.md` — auto-generated from conventional commits
- `CODE_OF_CONDUCT.md` — standard GitHub template
- `SUPPORT.md` — how to get help
- `ROADMAP.md` — future direction (extracted from IDEA.MD §32 and TECHNICAL.MD §35.3)
- `UPGRADE.md` — migration path between versions

### 6.4 Fix Naming

- Rename `IDEA.MD` → `IDEA.md`
- Rename `TECHNICAL.MD` → `TECHNICAL.md`

### 6.5 Standardize Document Metadata

Every document should have a header block:

```markdown
> **Status:** implemented | in-progress | planned | draft
> **Last reviewed:** 2026-06-29
> **Scope:** [brief description]
```

---

## 7. Summary of Findings

| Category                         | Count                  | Severity |
| -------------------------------- | ---------------------- | -------- |
| Duplicated content areas         | 7+                     | High     |
| Files with inconsistent naming   | 2                      | Low      |
| Missing standard documents       | 4                      | Medium   |
| Outdated/inconsistent statements | 8                      | Medium   |
| AI agent instruction files       | 5 (duplicating 70-80%) | High     |
| Design docs without status       | 5                      | Medium   |
| No documentation index           | 1                      | Medium   |
| README too large (575 lines)     | 1                      | Low      |
