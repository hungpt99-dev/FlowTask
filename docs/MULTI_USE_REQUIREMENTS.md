# Multi-Use AI Support — Requirements

## Overview

FlowTask's IDEA.MD states: _"FlowTask is not only for coding. It can support coding, documentation, debugging, research, testing, DevOps, planning, project setup, and other AI-assisted work."_

Currently FlowTask has four project modes (`development`, `writing`, `research`, `general`) but they are **not enforced at the runtime level**. The planner templates, validation engine, context pack builder, quality gate, and report generator all assume coding workflows.

This document defines the functional and architectural requirements to make FlowTask a truly multi-use AI runtime.

---

## 1. Current State

### What Already Exists

| Component            | Mode Awareness                                    | Details                                                      |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Project modes        | Defined in `project-modes.ts`                     | 4 modes: development, writing, research, general             |
| Mode rules           | `mode-rules.ts`                                   | Generates mode-specific markdown rules text                  |
| Mode steps           | `mode-steps.ts`                                   | Generates mode-specific workflow step text                   |
| AI planner prompt    | `internal-ai-planner.ts:getModeHint()`            | Lightweight text hint only (no structural change)            |
| Planner context      | `planner-context-builder.ts:getModeContextHint()` | Lightweight text hint only (no structural change)            |
| Simple planner       | `simple-planner.ts`                               | **No mode awareness** — always uses 7 coding tasks           |
| Context pack builder | `context-pack-builder.ts`                         | **No mode awareness** — always uses coding instructions      |
| Validation engine    | `validation-engine.ts`                            | **No mode awareness** — only process/file/command validators |
| Quality gate         | `quality-gate.ts`                                 | **No mode awareness** — always `pnpm lint/typecheck/test`    |
| Report generator     | `report-generator.ts`                             | **No mode awareness** — generic format                       |
| Default config       | `default-config.ts`                               | **No mode awareness** — always same defaults                 |

### Architectural Gaps

1. **Task schema** is coding-biased — only supports `commands`, `requiredFiles`, `requiredArtifacts`, `requireGitDiff`
2. **Validation types** — only `process`, `file`, `artifact`, `command`, `git_diff`, `manual`, `ai_review` — no document/research/content validators
3. **Context pack** — hardcoded "do not rewrite unrelated files", assumes file-editing AI CLI
4. **Simple planner** — same 7-task template regardless of mode
5. **Executor presets** — all assume coding AI tools (opencode, claude, codex, etc.)
6. **Quality gate** — hardcoded dev commands
7. **Report generator** — no mode-specific sections

---

## 2. Use Cases per Mode

### 2.1 Development Mode (existing)

**Use cases:** Coding, debugging, refactoring, testing, implementation, project setup

**Typical tasks:**

- Read rules → Understand request → Inspect project → Plan → Implement → Validate → Report

**Validation:**

- Process exit codes
- File existence
- Shell commands (lint, typecheck, test)
- Git diff

**Executors:** opencode, claude, codex, aider, shell

### 2.2 Writing Mode (needs enforcement)

**Use cases:** Technical documents, proposals, README files, prompts, scripts, blog posts, documentation

**Typical tasks:**

- Understand goal/audience → Outline → Draft → Revise → Final document → Report

**Validation:**

- Document exists and is non-empty
- Minimum content length
- Required sections present (structure check)
- Readability check (optional)
- No file-editing shell commands by default

**Executors:** opencode, claude (for drafting), internal AI provider (for direct document generation)

### 2.3 Research Mode (needs enforcement)

**Use cases:** Competitor analysis, technology comparison, source research, feasibility analysis, briefs, literature review

**Typical tasks:**

- Define research question → Collect sources → Compare/analyze → Research brief → Report

**Validation:**

- Source notes exist
- Research brief artifact exists
- Separation of facts vs. assumptions
- Source quality metadata (optional)
- No invented facts (manual review signal)

**Executors:** opencode, claude, internal AI provider

### 2.4 General Mode (needs enforcement)

**Use cases:** Generic AI workflows, analysis, planning, summarization, translation, data transformation, ad-hoc AI tasks

**Typical tasks:**

- Understand objective → Plan → Execute → Artifact → Report

**Validation:**

- Artifact exists
- Manual review
- Basic file/process checks from config

**Executors:** opencode, claude, shell, internal AI provider

---

## 3. Functional Requirements

### REQ-01: Mode-Aware Simple Planner

The `SimplePlanner` must generate different task templates per mode:

| Mode          | Task Template                                                                               |
| ------------- | ------------------------------------------------------------------------------------------- |
| `development` | 7 tasks (current): Read rules → Understand → Inspect → Plan → Implement → Validate → Report |
| `writing`     | 5 tasks: Understand goal/audience → Outline → Draft → Revise → Finalize → Report            |
| `research`    | 5 tasks: Define question → Collect sources → Analyze → Brief → Report                       |
| `general`     | 4 tasks: Understand → Plan → Execute → Report                                               |

Each task's `executor`, `acceptanceCriteria`, and `validation` config must be mode-appropriate.

**Files:** `src/planner/simple-planner.ts`, `src/planner/templates/`

### REQ-02: Mode-Aware AI Planner Prompts

The `InternalAiPlanner` system prompt and user prompt must adjust structurally per mode:

- **Writing mode:** Include audience/structure guidance; suppress coding assumptions; allow executor=ai for document generation
- **Research mode:** Include source-tracking, fact-vs-assumption separation; allow executor=ai for analysis
- **General mode:** Remove all coding bias; focus on artifact generation

The JSON schema in the prompt should mention mode-relevant validation fields.

**Files:** `src/planner/internal-ai-planner.ts`, `src/context/planner-context-builder.ts`

### REQ-03: Extended Task Schema

Add fields to `TaskSchema` for non-coding use cases:

```
outputType: z.enum(["code", "document", "research", "analysis", "artifact", "generic"]).default("code")
```

Extend `ValidationConfigSchema`:

```
minContentLength: z.number().optional()         // writing: document must be N chars
requireSections: z.array(z.string()).optional()  // writing: required section headers
requireSources: z.boolean().optional()           // research: must cite sources
checkList: z.array(z.string()).optional()         // general: checklist items
```

**Files:** `src/schemas/task.schema.ts`, `src/schemas/planner.schema.ts`

### REQ-04: Additional Validation Check Types

Add to `ValidationCheckSchema.type`:

```
"document" | "content" | "research" | "checklist"
```

Implement new validators:

| Validator           | Applies To | Checks                                                |
| ------------------- | ---------- | ----------------------------------------------------- |
| `DocumentValidator` | writing    | File exists, min length, required sections, non-empty |
| `ResearchValidator` | research   | Source notes exist, fact/assumption separation        |
| `ContentValidator`  | general    | Custom checklist items, artifact presence             |

**Files:** `src/schemas/validation.schema.ts`, `src/validation/document-validator.ts`, `src/validation/research-validator.ts`, `src/validation/content-validator.ts`

### REQ-05: Mode-Aware Validation Engine

`ValidationEngine` must select validators based on project mode:

```
development → ProcessValidator + FileValidator + CommandValidator + optional GitDiffValidator
writing     → ProcessValidator + DocumentValidator
research    → ProcessValidator + ResearchValidator + FileValidator
general     → ProcessValidator + ContentValidator
```

**Files:** `src/validation/validation-engine.ts`

### REQ-06: Mode-Aware Context Pack Builder

`ContextPackBuilder.build()` must accept a `projectMode` parameter and adjust content:

- **Development:** Current behavior (validation commands as bash blocks, "do not rewrite unrelated files")
- **Writing:** Include audience/goal context, writing guidelines, structure requirements; omit coding instructions
- **Research:** Include research question, source tracking template, fact/assumption guidance
- **General:** Include objective description, deliverable format guidance

**Files:** `src/context/context-pack-builder.ts`

### REQ-07: Mode-Aware Quality Gate

`QualityGate` must return mode-appropriate default commands:

```
development → ["pnpm lint", "pnpm typecheck", "pnpm test"]
writing     → [] (no shell commands; validation via DocumentValidator)
research    → [] (no shell commands; validation via ResearchValidator)
general     → [] (no shell commands; validation via ContentValidator)

All modes: configuration can override defaults via config.json quality.commands
```

**Files:** `src/quality/quality-gate.ts`, `src/config/default-config.ts`

### REQ-08: Mode-Aware Report Generator

`ReportGenerator` must include mode-specific sections:

| Mode          | Extra Report Sections                                                   |
| ------------- | ----------------------------------------------------------------------- |
| `development` | Changed files, validation results, quality results                      |
| `writing`     | Document statistics, section completeness, audience notes               |
| `research`    | Source list, confidence levels, open questions, fact/assumption summary |
| `general`     | Artifact list, deliverable description, process notes                   |

**Files:** `src/core/report-generator.ts`

### REQ-09: Non-Coding Executor Presets

Add executor presets suitable for non-coding AI tasks:

```json
"internal-ai": {
  "type": "internal-ai",
  "inputMode": "stdin",
  "timeoutMs": 600000
}
```

The `internal-ai` executor type would use the configured AI provider (same as the planner's provider) for direct response generation — useful for writing, research, and general modes where the AI produces content directly via API rather than editing files through a CLI tool.

**Files:** `src/executor/executor-presets.ts`, `src/executor/executor.ts`, `src/executor/` (new executor)

### REQ-10: Mode-Aware `run` Command

The `run` command should accept `--mode` override:

```
flowtask run "Write README" --mode writing
flowtask run "Research competitors" --mode research
```

If not specified, use the project's configured mode from `config.json`.

### REQ-11: Default Config per Mode

`generateDefaultConfig()` should return mode-appropriate defaults when `projectMode` is set:

| Setting                    | dev                 | writing     | research    | general  |
| -------------------------- | ------------------- | ----------- | ----------- | -------- |
| `defaultExecutor`          | opencode            | internal-ai | internal-ai | opencode |
| `quality.enabledByDefault` | true                | false       | false       | false    |
| `quality.commands`         | lint/typecheck/test | []          | []          | []       |
| `validation.profile`       | safe                | basic       | basic       | basic    |

**Files:** `src/config/default-config.ts`

---

## 4. Schema Changes

### 4.1 Task Schema (`task.schema.ts`)

```typescript
export const ValidationConfigSchema = z.object({
  commands: z.array(z.string()).optional(),
  requiredFiles: z.array(z.string()).optional(),
  requiredArtifacts: z.array(z.string()).optional(),
  requireGitDiff: z.boolean().optional(),
  // NEW
  minContentLength: z.number().int().positive().optional(),
  requireSections: z.array(z.string()).optional(),
  requireSources: z.boolean().optional(),
  checkList: z.array(z.string()).optional(),
});

export const TaskSchema = z.object({
  // ... existing ...
  // NEW
  outputType: z
    .enum(["code", "document", "research", "analysis", "artifact", "generic"])
    .default("code"),
});
```

### 4.2 Validation Schema (`validation.schema.ts`)

```typescript
export const ValidationCheckSchema = z.object({
  type: z.enum([
    "process",
    "file",
    "artifact",
    "command",
    "git_diff",
    "manual",
    "ai_review",
    // NEW
    "document",
    "content",
    "research",
    "checklist",
  ]),
  // ... existing ...
});
```

### 4.3 Planner Task Schema (`planner.schema.ts`)

```typescript
export const PlannerTaskValidationSchema = z.object({
  commands: z.array(z.string()).optional().default([]),
  requiredFiles: z.array(z.string()).optional().default([]),
  requiredArtifacts: z.array(z.string()).optional().default([]),
  requireGitDiff: z.boolean().optional().default(false),
  // NEW
  minContentLength: z.number().int().positive().optional(),
  requireSections: z.array(z.string()).optional(),
  requireSources: z.boolean().optional(),
  checkList: z.array(z.string()).optional(),
});

export const AiPlannerTaskSchema = z.object({
  // ... existing ...
  // NEW
  outputType: z
    .enum(["code", "document", "research", "analysis", "artifact", "generic"])
    .optional()
    .default("code"),
});
```

### 4.4 Config Schema (`config.schema.ts`)

Add `projectMode` enforcement in validation — certain keys should be validated conditionally based on mode.

---

## 5. Architecture Diagram (Mode Dispatch)

```
                          ┌──────────────────────┐
                          │    FlowTask Config    │
                          │  projectMode: string  │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │   Mode Dispatcher    │
                          │ (policy per mode)    │
                          └────┬────┬────┬───────┘
                               │    │    │
           ┌───────────────────┘    │    └───────────────────┐
           │                        │                        │
    ┌──────▼──────┐         ┌───────▼───────┐        ┌──────▼──────┐
    │  Simple     │         │  Validation   │        │  Context    │
    │  Planner    │         │  Engine       │        │  Pack       │
    │             │         │               │        │  Builder    │
    │ mode-aware  │         │ mode-         │        │             │
    │ templates   │         │ aware         │        │ mode-aware  │
    └─────────────┘         │ validators    │        │ sections    │
                            └───────┬───────┘        └─────────────┘
                                    │
                         ┌──────────▼──────────┐
                         │   Quality Gate      │
                         │   mode-aware         │
                         │   default commands   │
                         └─────────────────────┘
```

---

## 6. Implementation Order

### Phase 1: Foundation (Schema + Config)

1. Extend `ValidationConfigSchema` with new fields (`minContentLength`, `requireSections`, `requireSources`, `checkList`)
2. Extend `TaskSchema` with `outputType`
3. Extend `ValidationCheckSchema.type` with new types
4. Extend `PlannerTaskValidationSchema` and `AiPlannerTaskSchema`
5. Update `generateDefaultConfig()` for mode-appropriate defaults

### Phase 2: Validation (New Validators)

6. Implement `DocumentValidator`
7. Implement `ResearchValidator`
8. Implement `ContentValidator`
9. Make `ValidationEngine` mode-aware

### Phase 3: Planning (Mode-Aware Planners)

10. Update `SimplePlanner` with mode-specific templates
11. Update `InternalAiPlanner` with mode-specific system prompts
12. Update `PlannerContextBuilder` with mode context

### Phase 4: Execution (Mode-Aware Context + Executors)

13. Update `ContextPackBuilder` to be mode-aware
14. Implement `InternalAiExecutor` (uses AI provider directly for non-coding output)
15. Register new executor type in defaults

### Phase 5: Reporting (Mode-Aware Output)

16. Update `ReportGenerator` with mode-specific sections
17. Update `QualityGate` for mode-appropriate defaults

---

## 7. Key Design Principles

1. **Backward compatibility**: `development` mode must produce identical behavior to current code
2. **Schema evolution**: New schema fields must all be optional with sensible defaults
3. **Mode propagation**: `projectMode` flows from Config → Planner → Context → Executor → Validation → Report; each layer reads it independently
4. **No forced validation**: Non-development modes default to lighter validation; users can override
5. **Executor neutrality**: Non-coding modes should support `internal-ai` executor that generates content via API, not just via file-editing CLI tools
