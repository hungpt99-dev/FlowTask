# FlowTask Architecture Review

> **Document Type:** Architecture Review and Improvement Plan
> **Review Date:** 2026-06-29
> **Based on:** Full codebase analysis — `src/` (18 directories, ~100+ modules), `tests/` (112 test files, 1353 tests), `docs/`, `.flowtask/`

---

## Table of Contents

1. Executive Summary
2. Architecture Overview
3. Workflow Core (1, 2, 35, 38)
4. Workflow States (2)
5. Scanning and Context Building (3, 4)
6. Structured Planning (5, 6)
7. Generic Expected Outputs and Validation (7, 8, 9)
8. Artifact Tracking (10, 11)
9. Workflow Diff and Drift Detection (12)
10. Run History and Persistence (13, 40)
11. Timeline and Audit Log (14)
12. Real-Time Visibility (15)
13. Interactive Prompt Detection (16)
14. Human Approval Gates (17)
15. Safety and Risk Control (18)
16. Error Handling (19)
17. Performance (20)
18. Plugin Architecture (21)
19. Code Plugin with CodeGraph (22, 23)
20. Docs / Research / Data / Writing / Design / BA / QA / Release Plugins (24–31)
21. Workflow Templates (32)
22. Hook System (33, 34)
23. CLI Commands (34)
24. Cost and Budget Control (36)
25. AI Provider and Role System (37)
26. Configuration (39)
27. Final Report (41)
28. Product Quality and Production Readiness (42, 43)
29. Prioritized Improvement Roadmap

---

## 1. Executive Summary

FlowTask is a sophisticated, well-architected AI workflow orchestrator with strong foundations. The codebase demonstrates excellent module separation, schema validation via zod, extensive test coverage (1353 tests), and thoughtful architectural decisions (planner/executor separation, atomic writes, cross-platform support).

### Core Strengths

- **Clean modular architecture** — CLI thin layer, core domain managers, utility modules
- **Strong schema validation** — All domain objects validated with zod at boundaries
- **Excellent test coverage** — 112 test files, unit + integration + E2E
- **Sound architectural principles** — Planner/executor separation, atomic writes, event sourcing
- **Cross-platform design** — `getShell()`, `path.join`, no hardcoded Unix paths
- **Safety-first** — Command classification, secret redaction, approval gates
- **AI provider diversity** — 8 provider types with response_format fallback
- **Dual storage** — JSONL primary + SQLite secondary for query performance

### Critical Gaps

| Area                         | Status                                                                  | Priority |
| ---------------------------- | ----------------------------------------------------------------------- | -------- |
| Workflow state machine       | Limited — 8 run states, 9 task states vs 21+ required                   | High     |
| Generic workflow model       | Task-based only — no generic step/workflow abstraction                  | High     |
| Scanning                     | Keyword-based only — no PDF, spreadsheet, image, run history scan       | High     |
| Structured planning          | Basic outputPlan exists, but no structured step model                   | High     |
| Plugin architecture          | Non-existent — all logic in core                                        | High     |
| Code intelligence            | Uses basic keyword scan — no CodeGraph integration                      | High     |
| AI validation                | Exists but limited — single AiValidator, no general evidence validation | Medium   |
| Artifact tracking            | File-based only — no diff, expected/unexpected, validation status       | Medium   |
| File change tracking         | Git snapshots only — no per-step diff, no unexpected change detection   | Medium   |
| Workflow diff/drift          | Not implemented                                                         | Medium   |
| Run history search/filter    | Basic SQLite queries, no export/compare                                 | Medium   |
| Timeline/audit log           | Event store exists but no structured timeline view                      | Medium   |
| Interactive prompt detection | Not implemented                                                         | Medium   |
| Cost/budget control          | Not implemented                                                         | Medium   |
| Workflow templates           | Basic use case templates, no extensible template system                 | Low      |
| Hook system                  | Limited lifecycle points                                                | Low      |

---

## 2. Architecture Overview

### Current Architecture

```
CLI (Commander)
  └─ FlowTaskAPI
       ├─ ProjectManager
       ├─ ConfigLoader
       ├─ RuleLoader
       ├─ RunManager
       ├─ RunLifecycle
       │    ├─ HookManager
       │    ├─ Planner (SimplePlanner / InternalAiPlanner)
       │    ├─ ContextPackBuilder / ProjectScanner / TaskContextBuilder
       │    ├─ ExecutorRegistry (Shell / Command / Manual)
       │    ├─ ValidationEngine
       │    ├─ StepManager
       │    ├─ GitService
       │    ├─ SafetyChecker / ApprovalManager
       │    ├─ ProcessManager
       │    └─ ReportGenerator
       ├─ StateManager
       ├─ EventStore (JSONL + SQLite)
       ├─ WorkflowManager / WorkflowReplanner
       ├─ ArtifactManager
       ├─ CheckpointService
       ├─ QualityGate
       └─ DatabaseManager (SQLite)

Schema Layer: zod schemas in src/schemas/
AI Layer: ProviderRegistry → ProviderService → 8 provider implementations
```

### Key Observations

1. **No plugin system** — All domain logic lives in core. Adding a Docs plugin or Data plugin requires editing core code.
2. **RunLifecycle is a God class** — It orchestrates everything: scanning, planning, execution, validation, hooks, retry, reports. ~800+ lines.
3. **Workflow/Task/Step model is concrete** — No abstract workflow state machine, no generic step lifecycle. States are simple enum values.
4. **Context building is code-biased** — `ProjectScanner` focuses on code files via keyword matching. No support for PDFs, spreadsheets, images, or non-code artifacts.
5. **Validation is deterministic-only** — AI validation exists but runs only as fallback. No general evidence-based validation framework.

---

## 3. Workflow Core (1, 2, 35, 38)

### Current State

- **Workflow model**: `WorkflowFile` schema with task list. Managed by `WorkflowManager` (list, show, diff, apply, add, remove, reorder, edit, replan).
- **Step model**: `Step` schema with type, status, command. Managed by `StepManager`. Steps belong to tasks.
- **Task model**: `Task` schema with status, executor, dependencies, validation config.
- **Run model**: `Run` schema with status, mode, progress tracking.
- **Lifecycle**: `RunLifecycle.executeRun()` → `executeTasks()` → `executeTask()` → validation → retry loop.

### Gap Analysis

| Feature                    | Status  | Issue                                                                     |
| -------------------------- | ------- | ------------------------------------------------------------------------- |
| Generic workflow model     | Partial | `WorkflowFile` is flat task list, no nested/sub-workflow support          |
| Generic step model         | Partial | Steps have types but no lifecycle state machine, no input/output contract |
| Workflow lifecycle         | Present | Handled by `RunLifecycle` but tightly coupled                             |
| Step lifecycle             | Present | Steps flow through `StepManager` but no formal lifecycle hooks per step   |
| Workflow state machine     | Missing | No formal FSM — status is a simple enum                                   |
| Step state machine         | Missing | No formal FSM for step transitions                                        |
| Step dependencies          | Basic   | Task-level `dependsOn` only — no step-level dependencies                  |
| Conditional steps          | Missing | No conditional branching (if/then/else)                                   |
| Retry policy               | Basic   | Task-level `maxRetries` only — no per-step retry, no backoff              |
| Timeout policy             | Basic   | Run/task-level timeout in config — no per-step timeout                    |
| Pause/resume               | Partial | Run-level pause via checkpoint service, no step-level pause               |
| Cancel support             | Partial | Run-level cancel, no graceful step cancellation                           |
| Skip step support          | Present | Task can be skipped via status                                            |
| Continue after failure     | Present | Retry mechanism continues after failure                                   |
| Resume from checkpoint     | Present | CheckpointService captures task execution state                           |
| Recovery after crash       | Present | Resume logic detects interrupted tasks                                    |
| Long-running workflow      | Basic   | Timeout limits exist, no progress persistence for long steps              |
| Step input/output contract | Missing | Steps have no defined input/output schema                                 |
| Workflow final report      | Present | ReportGenerator produces final-report.md                                  |

### Improvement Suggestions

1. **Introduce a formal StateMachine class** for workflows and steps with defined transitions, guards, and events. Define all 21+ states with valid transitions.

2. **Extend RunLifecycle into smaller orchestrators**:
   - `WorkflowOrchestrator` — manages workflow lifecycle (scan → plan → approve → execute → validate → report)
   - `StepOrchestrator` — manages step lifecycle within a task
   - Keep `RunLifecycle` as a coordinator that delegates to these

3. **Add step input/output contracts**:

   ```typescript
   interface StepInput {
     schema: z.ZodSchema;
     source: "previous_step" | "user" | "planner" | "file";
   }
   interface StepOutput {
     schema: z.ZodSchema;
     target: "next_step" | "artifact" | "report";
   }
   ```

4. **Support conditional steps** via a `condition` field that references previous step outputs:

   ```typescript
   interface ConditionalStep extends Step {
     condition?: {
       if: string; // expression referencing previous outputs
       then?: string[]; // step IDs to run if true
       else?: string[]; // step IDs to run if false
     };
   }
   ```

5. **Add per-step timeout and retry policy**:
   ```typescript
   interface StepRetryPolicy {
     maxRetries: number;
     backoffMs: number;
     backoffMultiplier: number;
   }
   ```

---

## 4. Workflow States (2)

### Current States

| Entity | Current States                                                                             | Required States                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run    | created, planning, running, paused, completed, failed, cancelled, interrupted              | CREATED, SCANNING, PLANNING, PLANNED, WAITING_PLAN_APPROVAL, APPROVED, READY, RUNNING, PAUSED, SUCCEEDED, FAILED, CANCELLED, PARTIALLY_COMPLETED                              |
| Task   | pending, running, done, failed, skipped, blocked, cancelled, waiting_approval, interrupted | pending, running, done, failed, skipped, blocked, cancelled, waiting_approval, interrupted, WAITING_INPUT, WAITING_DEPENDENCY, VALIDATING, RETRYING, STUCK, NEEDS_USER_REVIEW |
| Step   | pending, pending_approval, approved, denied, running, done, failed, cancelled, interrupted | pending, pending_approval, approved, denied, running, done, failed, cancelled, interrupted, WAITING_INPUT, VALIDATING, RETRYING, STUCK                                        |

### Gap Analysis

- **No scanning state** — Run goes directly from `created` to `planning`, skipping an explicit SCANNING phase
- **No plan approval state** — After planning, no WAITING_PLAN_APPROVAL state
- **No READY state** — After approval, no READY state before execution
- **No VALIDATING state** — Validation is a side-effect of task execution
- **No RETRYING state** — Retry is implicit in the retry counter
- **No STUCK state** — No detection of stuck workflows/steps
- **No NEEDS_USER_REVIEW state** — No formal flag for user review
- **No ROLLBACK_REQUIRED / ROLLED_BACK** — No rollback support
- **No WAITING_INPUT state** — No way to indicate a step is waiting for user input
- **No WAITING_DEPENDENCY state** — No way to indicate a step is waiting on a dependency

### Improvement Suggestions

1. **Define a state machine with enums and transition guards**:

```typescript
enum WorkflowState {
  CREATED,
  SCANNING,
  PLANNING,
  PLANNED,
  WAITING_PLAN_APPROVAL,
  APPROVED,
  READY,
  RUNNING,
  WAITING_APPROVAL,
  WAITING_INPUT,
  WAITING_DEPENDENCY,
  VALIDATING,
  RETRYING,
  PAUSED,
  SUCCEEDED,
  FAILED,
  SKIPPED,
  CANCELLED,
  STUCK,
  NEEDS_USER_REVIEW,
  PARTIALLY_COMPLETED,
  ROLLBACK_REQUIRED,
  ROLLED_BACK,
}

const WORKFLOW_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  [WorkflowState.CREATED]: [WorkflowState.SCANNING, WorkflowState.CANCELLED],
  [WorkflowState.SCANNING]: [WorkflowState.PLANNING, WorkflowState.FAILED, WorkflowState.CANCELLED],
  [WorkflowState.PLANNING]: [WorkflowState.PLANNED, WorkflowState.FAILED],
  [WorkflowState.PLANNED]: [WorkflowState.WAITING_PLAN_APPROVAL, WorkflowState.APPROVED],
  [WorkflowState.WAITING_PLAN_APPROVAL]: [
    WorkflowState.APPROVED,
    WorkflowState.FAILED,
    WorkflowState.CANCELLED,
  ],
  [WorkflowState.APPROVED]: [WorkflowState.READY, WorkflowState.CANCELLED],
  [WorkflowState.READY]: [WorkflowState.RUNNING, WorkflowState.CANCELLED],
  [WorkflowState.RUNNING]: [
    WorkflowState.WAITING_APPROVAL,
    WorkflowState.WAITING_INPUT,
    WorkflowState.WAITING_DEPENDENCY,
    WorkflowState.VALIDATING,
    WorkflowState.RETRYING,
    WorkflowState.PAUSED,
    WorkflowState.SUCCEEDED,
    WorkflowState.FAILED,
    WorkflowState.STUCK,
    WorkflowState.CANCELLED,
  ],
  // ... etc
};
```

2. **Create a `WorkflowStateMachine` class** that enforces valid transitions and emits events on state change.

3. **Migrate the existing enum-based status to the formal state machine** in all schemas.

---

## 5. Scanning and Context Building (3, 4)

### Current State

- **ProjectScanner** (`src/context/project-scanner.ts`): Keyword-based file scanning. Extracts keywords from user prompt, finds matching files by name and content (via `rg`), reads up to 500KB per file.
- **TaskContextBuilder** (`src/context/task-context-builder.ts`): Builds a TaskContext with project metadata, matched files, git context.
- **ContextPackBuilder** (`src/context/context-pack-builder.ts`): Builds context packs for AI executors with prompt, rules, task info.
- **PlannerContextBuilder**: Passes project files context to the AI planner.

### Gap Analysis

| Source Type          | Supported | Notes                          |
| -------------------- | --------- | ------------------------------ |
| Code files           | Yes       | Via keyword matching           |
| Markdown files       | Yes       | Via keyword matching           |
| Documentation        | Partial   | docs/ folder detection only    |
| PDFs                 | No        | Not supported                  |
| Spreadsheets         | No        | Not supported                  |
| CSV files            | No        | Not supported                  |
| JSON/YAML/XML        | Yes       | Via file extension allowlist   |
| Config files         | Yes       | Via findConfigFiles            |
| Images/screenshots   | No        | Not supported                  |
| Previous artifacts   | No        | Not scanned                    |
| Previous run history | No        | Not scanned                    |
| Existing logs        | No        | Not scanned                    |
| Command outputs      | No        | Not scanned                    |
| Git changes          | Yes       | Git branch + changes detection |
| Project structure    | Yes       | Directory scanning             |
| User requirements    | Yes       | Prompt keyword extraction      |
| Notes                | No        | Not scanned                    |
| External sources     | No        | Not supported                  |

### TaskContext Limitations

The current `TaskContext` (from `task-context-builder.ts`) includes:

- Project metadata (name, type, PM, languages, frameworks)
- Matched files with content
- Git context
- No confidence score
- No constraints
- No related commands
- No previous decisions
- No existing risks
- No expected outputs
- No validation methods
- No planning hints

### Improvement Suggestions

1. **Create a ScanResult schema** that stores what was scanned, what was found, and confidence:

   ```typescript
   interface ScanResult {
     sources: ScanSource[];
     totalFiles: number;
     totalSize: number;
     matchedKeywords: string[];
     confidence: number;
     errors: string[];
   }
   interface ScanSource {
     type: "code" | "document" | "data" | "image" | "artifact" | "history" | "log" | "git";
     filesFound: number;
     contextContributed: boolean;
   }
   ```

2. **Add plugin-based scanners** — Each plugin registers a scanner that can process specific file types:

   ```typescript
   interface ScannerPlugin {
     name: string;
     supportedTypes: string[];
     scan(projectRoot: string, context: ScanContext): Promise<ScanPluginResult>;
   }
   ```

3. **Build a richer TaskContext**:

   ```typescript
   interface TaskContext {
     goal: string;
     taskType: string;
     workflowType: string;
     relevantContext: ContextItem[];
     relevantFiles: string[];
     relevantDocuments: string[];
     relevantArtifacts: string[];
     relevantData: string[];
     relatedCommands: string[];
     previousDecisions: Decision[];
     risks: Risk[];
     constraints: string[];
     expectedOutputs: ExpectedOutput[];
     validationMethods: ValidationMethod[];
     planningHints: string[];
     confidence: number; // 0-1
   }
   ```

4. **Support progressive scanning** — Start with lightweight scan, deepen if needed (lazy/incremental).

---

## 6. Structured Planning (5, 6)

### Current State

- **SimplePlanner**: Fixed 7-task template, no AI.
- **InternalAiPlanner**: Calls AI provider with structured prompt, receives JSON with task list.
- **AiPlannerOutput** schema: `{ title, summary, tasks[] }` where each task has title, description, executor, dependsOn, riskLevel, acceptanceCriteria, commands, validation, expectedResult, outputPlan.
- **OutputPlan** schema: Array of `{ action, target, description, validationMethod, acceptanceCriteria }`.
- **ProcessPlannerOutput**: Validates and normalizes planner output.

### Gap Analysis

The planner output has many required fields but is missing:

| Field                     | Status                  | Needed For                           |
| ------------------------- | ----------------------- | ------------------------------------ |
| Step ID                   | Not in planner output   | Step-level tracking                  |
| Task type                 | Missing                 | Workflow type classification         |
| Action type               | In outputPlan only      | Per-step action type                 |
| Input context             | Missing                 | What context each step needs         |
| Target files              | In outputPlan only      | Per-step file targets                |
| Target artifacts          | In outputPlan only      | Per-step artifact tracking           |
| Expected output           | `expectedResult` exists | Validation baseline                  |
| Acceptance criteria       | Present                 | Pass/fail determination              |
| Evidence to validate      | Missing                 | What counts as proof                 |
| Validation method         | In outputPlan only      | How to validate                      |
| Verification command      | In validation.commands  | Deterministic verification           |
| Risk level                | Present                 | Safety classification                |
| Approval requirement      | Missing                 | Per-step approval gates              |
| Retry policy              | Missing                 | Per-step retry config                |
| Timeout                   | Missing                 | Per-step timeout                     |
| Dependencies              | `dependsOn` exists      | Task ordering                        |
| Final output contribution | Missing                 | How step contributes to final output |

### Improvement Suggestions

1. **Extend `AiPlannerTask` schema** with:
   - `inputContext: string[]` — references to context items needed
   - `evidenceRequired: string[]` — what evidence proves completion
   - `approvalRequired: boolean` — whether step needs approval
   - `retryPolicy: { maxRetries, backoffMs, backoffMultiplier }`
   - `timeout: number` — per-step timeout in ms
   - `contributionToFinal: string` — how this step feeds the final report

2. **Create a `StructuredPlan` type** that the planner returns instead of raw JSON:
   ```typescript
   interface StructuredPlan {
     title: string;
     summary: string;
     workflowType: string;
     confidence: number;
     steps: StructuredStep[];
   }
   interface StructuredStep {
     id: string;
     title: string;
     description: string;
     taskType: string; // "code" | "research" | "write" | "validate" | etc.
     actionType: string; // "create" | "modify" | "analyze" | "report"
     inputContext: string[];
     targetFiles: string[];
     targetArtifacts: string[];
     expectedOutput: string;
     acceptanceCriteria: string[];
     evidence: string[];
     validationMethod: string;
     verificationCommand: string;
     riskLevel: "safe" | "risky" | "dangerous";
     approvalRequired: boolean;
     retryPolicy: RetryPolicy;
     timeout: number;
     dependencies: string[];
     finalOutputContribution: string;
   }
   ```

---

## 7. Generic Expected Outputs and Validation (7, 8, 9)

### Current State

- **OutputPlan** supports: create, modify, delete with validation methods: file_exists, file_content, file_diff, command_output, test, ai_review, manual.
- **ValidationEngine** runs: process, file, command, acceptance criteria, content, output plan, outcome comparison, git diff, AI review.
- **AiValidator** (`src/validation/ai-validator.ts`): AI-based validation that compares task description + executor output + error output + changed files against expected results.
- **Validation modes**: off, fallback, always, high_risk_only.

### Gap Analysis

| Validation Type          | Supported | Notes                        |
| ------------------------ | --------- | ---------------------------- |
| Process exit code        | Yes       | ProcessValidator             |
| File existence           | Yes       | FileValidator                |
| File change              | Partial   | Git diff only                |
| Document validation      | No        | No content quality checks    |
| Research validation      | No        | No source/citation checks    |
| Data validation          | No        | No schema/row count checks   |
| Command result           | Yes       | CommandValidator             |
| Test/build/lint          | Yes       | Via command validation       |
| Log validation           | No        | No log pattern analysis      |
| UI result                | No        | No screenshot comparison     |
| Checklist validation     | No        | No checklist coverage checks |
| Requirement coverage     | No        | No traceability matrix       |
| AI semantic validation   | Yes       | AiValidator (limited)        |
| Deterministic validation | Yes       | Multiple validators          |
| Hybrid validation        | No        | AI + deterministic combined  |
| Validation confidence    | No        | No confidence scoring        |
| Retry suggestion         | No        | No automated retry reasoning |
| User review suggestion   | Partial   | needs_review status exists   |

### Output Type Support

| Output Type     | Supported | Notes                  |
| --------------- | --------- | ---------------------- |
| Code change     | Partial   | File diff tracking     |
| File            | Yes       | Artifact storage       |
| Document        | Partial   | Markdown artifacts     |
| Report          | Yes       | Final report           |
| Summary         | Partial   | Task summaries         |
| Research result | No        | Not tracked            |
| Data file       | No        | Not tracked            |
| Data change     | No        | Not tracked            |
| Config change   | Partial   | File diff              |
| Command result  | Yes       | Execution output       |
| Test result     | Yes       | Via command validation |
| Build result    | Partial   | Exit code + output     |
| Log output      | Yes       | Log files              |
| Decision        | No        | Not tracked            |
| Checklist       | No        | Not tracked            |
| Analysis        | Partial   | Task descriptions      |
| Recommendation  | No        | Not tracked            |
| Translation     | No        | Not tracked            |
| Design artifact | No        | Not tracked            |
| UI change       | No        | Not tracked            |
| Screenshot      | No        | Not tracked            |
| Mixed artifact  | No        | Not tracked            |

### Improvement Suggestions

1. **Extend AiValidator for general evidence-based validation** — not just code tasks. For example, validate a document exists and has required sections, validate a research result cites sources.

2. **Add a ValidationContext** that tracks:

   ```typescript
   interface ValidationContext {
     taskDescription: string;
     expectedResult: string;
     acceptanceCriteria: string[];
     expectedOutputs: ExpectedOutput[];
     artifacts: ArtifactRecord[];
     fileChanges: FileChange[];
     commandOutputs: CommandOutput[];
     testResults: TestResult[];
     logs: string[];
     previousValidationResults: ValidationResult[];
     outputPlan?: OutputPlan;
   }
   ```

3. **Add validation confidence scoring** — each check returns a confidence score (0-1) and the overall result is weighted.

4. **Support hybrid validation** — deterministic checks + AI review with weighted scoring:
   ```typescript
   interface HybridValidationResult {
     deterministicScore: number; // 0-1
     aiScore: number; // 0-1
     combinedScore: number; // weighted average
     verdict: "passed" | "failed" | "needs_review";
     reasoning: string;
   }
   ```

---

## 8. Artifact Tracking (10, 11)

### Current State

- **ArtifactRecord** schema: `{ artifactId, runId, taskId, title, type, filePath, fileSize, mimeType, hashSha256, createdAt }`.
- **ArtifactManager**: Saves artifacts to `.flowtask/runs/<runId>/artifacts/<taskId>/`, stores metadata in SQLite.
- **File tracking**: Git snapshot before/after run (`git-before.txt`, `git-diff-stat.txt`).

### Gap Analysis

| Artifact Feature    | Status  | Notes              |
| ------------------- | ------- | ------------------ |
| Created files       | Partial | File artifacts     |
| Modified files      | Partial | Git diff stat      |
| Deleted files       | No      | Not tracked        |
| Documents           | Partial | Markdown artifacts |
| Reports             | Yes     | Final report       |
| Summaries           | Partial | Task descriptions  |
| Logs                | Yes     | Log files          |
| Data files          | No      | Not tracked        |
| Research notes      | No      | Not tracked        |
| Decisions           | No      | Not tracked        |
| Checklists          | No      | Not tracked        |
| Screenshots         | No      | Not tracked        |
| Code changes        | Partial | Git diff           |
| Generated artifacts | Partial | ArtifactManager    |

Artifact metadata gaps:

- **Expected vs unexpected** — No flag indicating if artifact was in the plan
- **Source step** — Only task ID, not step ID
- **Diff** — No per-artifact diff
- **Validation status** — No per-artifact validation status
- **Modified time** — Missing from schema

### File Change Tracking Gaps

| Change Type            | Tracked | Notes                    |
| ---------------------- | ------- | ------------------------ |
| Created files          | Partial | Git snapshot             |
| Modified files         | Partial | Git diff stat            |
| Deleted files          | No      | Not tracked              |
| Renamed files          | No      | Not tracked              |
| Expected changes       | No      | Not matched against plan |
| Unexpected changes     | No      | Not detected             |
| Empty changes          | No      | Not flagged              |
| Unrelated changes      | No      | Not detected             |
| Sensitive file changes | No      | Not tracked              |
| Env/config changes     | No      | Not tracked              |
| Lockfile changes       | No      | Not tracked              |
| Large changes          | No      | Not flagged              |
| Before/after snapshots | Partial | Git snapshots only       |
| Per-step diff          | No      | Run-level only           |
| Full diff              | Partial | Git diff stat            |

### Improvement Suggestions

1. **Extend `ArtifactRecord` schema**:

   ```typescript
   interface ExtendedArtifact {
     ...ArtifactRecord,
     sourceStepId?: string;
     expected: boolean;         // Was this in the plan?
     validationStatus?: ValidationCheckStatus;
     diffSummary?: string;
     metadata: Record<string, unknown>;
     modifiedAt: string;
   }
   ```

2. **Create a `FileChangeTracker`** that captures per-step file state:

   ```typescript
   interface FileChange {
     path: string;
     action: "create" | "modify" | "delete" | "rename";
     oldPath?: string;
     sizeBefore?: number;
     sizeAfter?: number;
     hashBefore?: string;
     hashAfter?: string;
     gitDiff?: string;
     expected: boolean;
     sensitive: boolean;
   }
   ```

3. **Track changes at step granularity** — Save file snapshot before each step, compare after.

4. **Add unexpected change detection** — Compare actual changes against outputPlan targets. Flag changes not in the plan.

---

## 9. Workflow Diff and Drift Detection (12)

### Current State

- **Workflow diff** (`WorkflowDiff` schema): Added, removed, modified, unchanged tasks.
- **WorkflowManager**: Can diff current workflow against a file.
- **No drift detection** — No comparison of expected vs actual execution.

### Gap Analysis

| Diff Type                     | Supported | Notes        |
| ----------------------------- | --------- | ------------ |
| Expected vs actual outputs    | No        | Not compared |
| Expected vs actual files      | No        | Not compared |
| Expected vs actual artifacts  | No        | Not compared |
| Expected vs actual commands   | No        | Not compared |
| Expected vs actual validation | No        | Not compared |
| Expected vs actual risk       | No        | Not compared |

### Drift Detection Gaps

| Drift Type              | Detected | Notes                         |
| ----------------------- | -------- | ----------------------------- |
| Missing outputs         | No       | Not compared                  |
| Extra outputs           | No       | Not detected                  |
| Unexpected file changes | No       | Not detected                  |
| Skipped verification    | No       | Not detected                  |
| Plan drift              | No       | Plan vs actual                |
| Executor drift          | No       | Task vs execution             |
| Validation drift        | No       | Expected vs actual validation |

### Improvement Suggestions

1. **Create an `ExecutionDiff` class** that compares:
   - The run's `outputPlan` against actual artifacts created
   - Expected files against actual file changes
   - Expected commands against actual commands executed
   - Expected validation against actual validation results

2. **Add drift reporting** to the final report — highlight discrepancies between plan and execution.

---

## 10. Run History and Persistence (13, 40)

### Current State

- **File-based storage**: `run-index.json`, `task-index.json`, per-run directories
- **SQLite database**: Events, task results, artifacts, checkpoints
- **JSONL event log**: Append-only event stream
- **RunManager**: Load/save run data
- **EventStore**: Dual write to JSONL + SQLite

### Gap Analysis

| Feature            | Supported | Notes                 |
| ------------------ | --------- | --------------------- |
| Run ID             | Yes       | Generated IDs         |
| User goal          | Yes       | Prompt stored         |
| Plan               | Yes       | plan.md               |
| Steps              | Yes       | Per-run steps         |
| Status             | Yes       | Run status            |
| Timeline           | Partial   | Events stored         |
| AI output          | Partial   | Executor output saved |
| Command output     | Yes       | Log files             |
| Logs               | Yes       | Multiple log files    |
| Artifacts          | Yes       | File + DB             |
| File changes       | Partial   | Git snapshots         |
| Validation results | Yes       | JSON + log            |
| Approvals          | Partial   | Events only           |
| Errors             | Partial   | Log files             |
| Retries            | Partial   | Retry count in tasks  |
| Cost usage         | No        | Not tracked           |
| Token usage        | Partial   | Planner metadata      |
| Duration           | Partial   | startedAt/finishedAt  |
| Final report       | Yes       | final-report.md       |

### History Management Gaps

| Feature            | Supported | Notes             |
| ------------------ | --------- | ----------------- |
| Search run history | Partial   | DB queries        |
| Filter run history | Partial   | By status         |
| Resume old run     | Yes       | Resume by ID      |
| Duplicate old run  | No        | No fork/clone     |
| Compare runs       | No        | No run comparison |
| Export run         | No        | No export format  |

### Improvement Suggestions

1. **Add cost/token tracking** to the run schema:

   ```typescript
   interface RunCost {
     totalTokens: number;
     inputTokens: number;
     outputTokens: number;
     estimatedCost: number;
     costByProvider: Record<string, number>;
   }
   ```

2. **Add run export/import** — Export a run as JSON/YAML for sharing or backup.

3. **Add run comparison** — Diff two runs by their artifacts, file changes, validation results.

4. **Add history retention policies** — Auto-clean old runs based on age, status, or size.

---

## 11. Timeline and Audit Log (14)

### Current State

- **EventStore**: Append-only JSONL with ~90 event types.
- **Events** have: `time`, `type`, `runId`, `taskId`, `stepId`, `message`, `details`.
- **SQLite query**: `queryEvents` for efficient filtering.

### Gap Analysis

Current events cover most lifecycle points but are missing:

| Event Type                  | Present | Notes                                    |
| --------------------------- | ------- | ---------------------------------------- |
| Workflow created            | Yes     | `run_created`                            |
| Scan started/ended          | No      | No scan events                           |
| Plan created                | Yes     | `plan_generated`                         |
| Plan approved/rejected      | No      | No plan approval events                  |
| Step started/completed      | No      | Only task-level events                   |
| Step failed/retried/skipped | No      | No step-level events                     |
| Approval requested          | Yes     | `approval_requested`                     |
| Approval accepted/rejected  | Yes     | `approval_approved`, `approval_rejected` |
| Artifact created            | Partial | `artifact_created`                       |
| File changed                | No      | No file change events                    |
| Validation started          | Yes     | `validation_started`                     |
| Validation passed/failed    | Yes     | `validation_passed`, `validation_failed` |
| Workflow paused/resumed     | Yes     | `run_paused`                             |
| Cancel requested            | Yes     | `run_cancel_requested`                   |
| Cost update                 | No      | No cost events                           |

### Improvement Suggestions

1. **Add missing event types** for scan, plan approval, step lifecycle, file changes, cost updates.

2. **Create a TimelineView** that formats events as a human-readable timeline:

   ```
   10:30:00  Run created
   10:30:01  Scan started (3 files matched)
   10:30:02  Scan completed
   10:30:05  Plan created (8 tasks)
   10:30:06  Plan auto-approved
   10:30:10  Task 1: "Read project rules" started
   10:30:15  Task 1 completed
   10:30:16  Task 2: "Inspect project" started
   ...
   ```

3. **Make timeline queryable** by event type, time range, task, and step.

---

## 12. Real-Time Visibility (15)

### Current State

- **EventBus** (`src/ui/event-bus.ts`): Pub/sub system for UI events.
- **Log streaming**: `--follow` flag for live log viewing.
- **Status display**: `flowtask status` shows current step.
- **Workflow list**: Shows progress bar, task statuses.

### Gap Analysis

| Visibility Feature      | Supported | Notes                       |
| ----------------------- | --------- | --------------------------- |
| Current workflow status | Yes       | `flowtask status`           |
| Current step            | Yes       | Task-level only             |
| AI CLI output           | Partial   | Log streaming               |
| Command output          | Yes       | Real-time stdout/stderr     |
| Status changes          | Partial   | Event bus but limited UI    |
| Files changed           | No        | No real-time file change UI |
| Artifacts created       | No        | No real-time artifact UI    |
| Validation progress     | No        | No real-time validation UI  |
| Approval requests       | Partial   | Interactive prompt          |
| Retry attempts          | Partial   | Console messages            |
| Errors                  | Yes       | Error display               |
| Final result            | Yes       | Final report                |

### Improvement Suggestions

1. **Add real-time status bar** showing:

   ```
   [RUNNING] Task 5/8: "Implement OCR service" [====>    ] 2m 30s elapsed
   Artifacts: 3 | Changes: 2 files | Validations: 2/4 passed
   ```

2. **Stream file changes and artifacts** as they happen — show `File created: src/ocr/ocr.service.ts` in real-time.

3. **Add validation progress** — Show which checks passed/failed as they complete.

---

## 13. Interactive Prompt Detection (16)

### Current State

**Not implemented.** FlowTask currently treats all AI CLI output as text. There is no detection of interactive prompts.

### Gap Analysis

| Prompt Type         | Detected | Action         |
| ------------------- | -------- | -------------- |
| Continue?           | No       | Would hang     |
| Approve?            | No       | Would hang     |
| y/n?                | No       | Would hang     |
| Press enter         | No       | Would hang     |
| Login required      | No       | Would hang     |
| Permission required | No       | Would hang     |
| API key missing     | No       | Would hang     |
| Password prompt     | No       | Would hang     |
| Sudo prompt         | No       | Would hang     |
| OAuth prompt        | No       | Would hang     |
| No-output timeout   | No       | Would hang     |
| Stuck process       | No       | Would time out |

### Improvement Suggestions

1. **Add a `InteractivePromptDetector`** that watches AI CLI output for patterns:

   ```typescript
   const PROMPT_PATTERNS = [
     /[Cc]ontinue\?/,
     /[Aa]pprove\?/,
     /[Yy]\/[Nn]\?/,
     /[Pp]ress [Ee]nter/,
     /[Pp]assword:/,
     /[Ss]udo/,
     /[Ll]ogin/,
     /[Aa]pi [Kk]ey/,
     /[Oo]auth/,
     /[Pp]ermission/,
   ];
   ```

2. **When detected, pause the task and emit `WAITING_INPUT` or `WAITING_APPROVAL`** state.

3. **Allow user to provide input, approve, reject, retry, cancel, or kill**.

4. **Add a timeout for stuck processes** — If no output for N seconds and process is still running, flag as STUCK.

---

## 14. Human Approval Gates (17)

### Current State

- **ApprovalManager**: Interactive approval for risky commands.
- **Risk-based approval**: Risky commands require approval, blocked commands are rejected.
- **ApprovalConfig**: `enabled`, `autoApprove`, `requireFor` list.
- **Interactive mode**: TTY prompt via `enquirer`.

### Gap Analysis

| Approval Gate                 | Supported | Notes                      |
| ----------------------------- | --------- | -------------------------- |
| Plan execution                | Implicit  | Run mode (auto/manual)     |
| Risky step execution          | Yes       | Via command classification |
| File deletion                 | Yes       | Risky command              |
| Dependency installation       | Yes       | Risky command              |
| Migration                     | Yes       | Risky command              |
| Env/config changes            | No        | Not specifically tracked   |
| External API calls            | No        | Not detected               |
| Network operations            | No        | Not detected               |
| Git commit                    | No        | Not detected               |
| Git push                      | Yes       | Risky command              |
| High-cost AI usage            | No        | No cost tracking           |
| Continuing after failure      | Partial   | Interactive retry approval |
| Skipping validation           | No        | Not handled                |
| Overriding validation failure | No        | Not handled                |

### Improvement Suggestions

1. **Add step-level approval requirement** (`Step.requiresApproval` already exists, but not enforced by ApprovalManager).

2. **Add environment/config change detection** — Check if `.env`, `config.json`, or similar files were modified.

3. **Add cost-based approval** — Require approval if estimated cost exceeds threshold.

4. **Extend `ApprovalManager`** to support approval policies:
   ```typescript
   interface ApprovalPolicy {
     action: string;
     condition?: string; // expression
     message: string;
     timeout: number; // approval timeout
   }
   ```

---

## 15. Safety and Risk Control (18)

### Current State

- **SafetyChecker**: Pattern-based command classification (safe/risky/blocked).
- **SecretRedactor**: Regex-based secret masking in logs and output.
- **ApprovalManager**: Interactive approval for risky actions.
- **ResourceGuard**: Vitest worker limits, heavy command detection.

### Gap Analysis

| Safety Feature              | Supported | Notes                                |
| --------------------------- | --------- | ------------------------------------ |
| Risk scoring                | Basic     | 4 levels only                        |
| Dangerous command detection | Yes       | Pattern matching                     |
| Secret detection            | Yes       | Regex patterns                       |
| Credential leak detection   | Yes       | URL, Bearer, AWS keys                |
| Env file protection         | Partial   | Reading blocked, changes not tracked |
| Production config warning   | No        | Not detected                         |
| File deletion protection    | Partial   | `rm` is risky                        |
| Sudo command warning        | No        | Not detected                         |
| Migration warning           | Yes       | DB migration risky                   |
| Git push warning            | Yes       | Git push risky                       |
| External network warning    | No        | curl/wget not detected               |
| Large file change warning   | No        | Not tracked                          |
| Dependency install warning  | Yes       | Risky command                        |
| Max retry limit             | Yes       | Configurable                         |
| Max execution time          | Yes       | Timeout limits                       |
| Max cost limit              | No        | Not implemented                      |
| Safe mode                   | No        | Not implemented                      |
| Read-only mode              | No        | Not implemented                      |

### Improvement Suggestions

1. **Add network command detection** — `curl`, `wget`, `ssh`, `nc` as risky patterns.

2. **Add large file change detection** — Warn if file changes exceed size threshold.

3. **Add safe mode and read-only mode** — Configurable modes that restrict execution:

   ```json
   {
     "safeMode": {
       "enabled": false,
       "blockCommands": true,
       "blockFileWrites": false,
       "blockNetworkAccess": true
     }
   }
   ```

4. **Add risk scoring** — Numeric risk score (0-100) combining multiple factors:
   ```typescript
   interface RiskScore {
     total: number; // 0-100
     command: number; // command risk
     fileChange: number; // file change risk
     network: number; // network risk
     cost: number; // cost risk
     reasoning: string[];
   }
   ```

---

## 16. Error Handling (19)

### Current State

- **Typed errors**: `src/utils/errors.ts` with custom error classes.
- **ProcessManager**: Handles process exit, timeout, signal.
- **RunLifecycle**: Catches errors during execution, logs them, triggers retry or failure.
- **CheckpointService**: Saves state for resume after crash.

### Gap Analysis

| Error Type           | Handled | Notes                           |
| -------------------- | ------- | ------------------------------- |
| Step failure         | Partial | Task-level retry                |
| Command failure      | Yes     | Exit code handling              |
| Test failure         | Yes     | Validation failure              |
| Build failure        | Partial | Via command validation          |
| Timeout              | Yes     | Process timeout                 |
| Stuck process        | No      | Not detected                    |
| Missing dependency   | No      | Not checked                     |
| Missing env variable | No      | Not checked                     |
| Permission error     | No      | No detection                    |
| Network error        | No      | No detection                    |
| API error            | Partial | AI provider errors              |
| AI provider error    | Partial | Response format fallback        |
| AI CLI error         | Partial | Executor exit code              |
| Invalid plan         | Yes     | Planner output validation       |
| Invalid artifact     | No      | No artifact validation          |
| Invalid validation   | No      | No validation output validation |
| Corrupted run state  | Partial | State validation via zod        |

Error quality gaps:

| Error Feature        | Supported | Notes               |
| -------------------- | --------- | ------------------- |
| Clear reason         | Partial   | Error messages vary |
| Evidence             | No        | No error evidence   |
| Suggested fix        | No        | No fix suggestions  |
| Retry option         | Yes       | Retry mechanism     |
| User decision option | Partial   | Approval prompts    |

### Improvement Suggestions

1. **Create a structured `ErrorReport`**:

   ```typescript
   interface ErrorReport {
     errorId: string;
     type: ErrorType;
     message: string;
     evidence: string;
     suggestedFix: string;
     retryAvailable: boolean;
     userDecision: "retry" | "skip" | "stop" | "fix";
     source: "executor" | "validator" | "planner" | "safety" | "system";
   }
   ```

2. **Add error suggestion mapping** — Map error patterns to suggested fixes:

   ```typescript
   const ERROR_SUGGESTIONS: Record<string, string> = {
     "command not found": "Install the required tool or check PATH",
     "permission denied": "Check file permissions or run with appropriate access",
     ENOENT: "File not found. Check the path exists",
     timeout: "Consider increasing the timeout or optimizing the command",
   };
   ```

3. **Add pre-flight checks** in `RunLifecycle` before execution to detect common issues (missing tools, missing env vars, permission problems).

---

## 17. Performance (20)

### Current State

- **Ring buffer**: `RingBuffer` in `src/utils/ring-buffer.ts` bounds in-memory log size.
- **Scan caching**: `ScanCache` in `src/context/project-scanner.ts` caches scan results.
- **Validation dedupe**: `DedupeCache` in `src/validation/validation-runner.ts` prevents re-running same commands.
- **Git snapshots**: Before/after run only (not per-step).
- **SQLite**: Efficient event querying.

### Gap Analysis

| Performance Feature              | Supported | Notes                                      |
| -------------------------------- | --------- | ------------------------------------------ |
| Full workspace scan avoidance    | Partial   | Caching helps                              |
| Incremental scan/index updates   | No        | No incremental scan                        |
| Scan result caching              | Yes       | ScanCache                                  |
| Context index caching            | Partial   | Metadata caching                           |
| Code intelligence caching        | No        | No codegraph cache                         |
| Huge AI prompt avoidance         | Partial   | Context compression via TaskContextBuilder |
| Context compression              | Basic     | Truncation + keyword extraction            |
| Log size limiting                | Yes       | maxLogSizeMb, maxInMemoryLines             |
| Streaming AI/command output      | Yes       | Real-time streaming                        |
| Lazy-loading artifacts/logs      | No        | All data loaded eagerly                    |
| Avoiding repeated file reads     | Partial   | Some caching                               |
| Avoiding duplicated validation   | Partial   | ValidationRunner dedupe                    |
| Memory usage for large workflows | No        | All tasks loaded in memory                 |
| Large-run storage efficiency     | No        | No pagination/streaming for large runs     |
| Cleanup/retention policies       | Partial   | `flowtask clean` command                   |

### Improvement Suggestions

1. **Add lazy loading** for tasks, artifacts, and logs — Load only what's needed for the current view.

2. **Add incremental scanning** — Track file modification times and only re-scan changed files.

3. **Add pagination** for large runs — Don't load all events/logs/artifacts into memory at once.

4. **Add retention policies** in config:

   ```json
   {
     "retention": {
       "maxRuns": 100,
       "maxRunsPerStatus": { "completed": 50, "failed": 20 },
       "maxArtifactSizeMb": 500,
       "autoCleanDays": 90
     }
   }
   ```

5. **Add memory monitoring** — Warn if workflow data exceeds memory threshold.

---

## 18. Plugin Architecture (21)

### Current State

**No plugin architecture.** All logic is in the core. Domain-specific behavior is scattered:

| Domain             | Where It Lives                                                  |
| ------------------ | --------------------------------------------------------------- |
| Code scanning      | `src/context/project-scanner.ts`                                |
| Code validation    | `src/validation/` (generic validators)                          |
| Use case detection | `src/usecase/usecase-detector.ts`                               |
| Task templates     | `src/usecase/task-templates.ts`                                 |
| Project modes      | `src/config/project-modes.ts`, `mode-rules.ts`, `mode-steps.ts` |

### What a Plugin Should Provide

| Capability         | Current Approach                       | Plugin Approach                 |
| ------------------ | -------------------------------------- | ------------------------------- |
| Scanners           | `ProjectScanner` (code-only)           | Plugin registers scanner        |
| Planner hints      | `UseCaseDetector` (hardcoded patterns) | Plugin provides planner guide   |
| Validators         | `ValidationEngine` (generic)           | Plugin registers validators     |
| Artifact detectors | `ArtifactManager` (generic)            | Plugin detects domain artifacts |
| Risk rules         | `SafetyChecker` (hardcoded patterns)   | Plugin provides risk patterns   |
| Commands           | `ExecutorConfig` (hardcoded)           | Plugin provides presets         |
| Templates          | `task-templates.ts` (hardcoded)        | Plugin registers templates      |
| Output parsers     | None                                   | Plugin parses domain output     |
| Context builders   | `TaskContextBuilder` (code-only)       | Plugin builds domain context    |

### Improvement Suggestions

1. **Define plugin interfaces**:

   ```typescript
   interface FlowTaskPlugin {
     name: string;
     version: string;
     scanners?: ScannerPlugin[];
     plannerHints?: PlannerHintProvider;
     validators?: ValidatorPlugin[];
     artifactDetectors?: ArtifactDetector[];
     riskRules?: RiskRule[];
     executors?: ExecutorPreset[];
     templates?: TaskTemplate[];
     outputParsers?: OutputParser[];
     contextBuilders?: ContextBuilder[];
   }
   ```

2. **Create a `PluginRegistry`** that loads plugins from config and provides them to core components.

3. **Move code-specific logic** out of core into a Code Plugin.

4. **Keep core completely generic** — No import of code-specific modules in core.

---

## 19. Code Plugin with CodeGraph (22, 23)

### Current State

- **No CodeGraph integration**. The `ProjectScanner` does basic keyword and file-name matching.
- **No dedicated Code Plugin**. Code intelligence is spread across core.
- **`codegraph-scanner.ts`** exists in `src/context/` but is a simple keyword scanner, not a CodeGraph integration.

### Code Plugin Feature Support

| Feature                                  | Current       | Target             |
| ---------------------------------------- | ------------- | ------------------ |
| Project structure scan                   | Yes (basic)   | Yes (improved)     |
| Package manager detection                | Yes           | Yes                |
| Script detection                         | Yes           | Yes                |
| Test command detection                   | Yes           | Yes                |
| Build command detection                  | Yes           | Yes                |
| Lint command detection                   | Yes           | Yes                |
| CodeGraph integration                    | No            | Yes                |
| Related file discovery                   | Basic keyword | CodeGraph-based    |
| Related test detection                   | No            | Yes                |
| Entrypoint detection                     | Yes           | Yes                |
| API route detection                      | No            | Yes (if available) |
| Config usage detection                   | Basic         | Improved           |
| Git diff validation                      | Basic         | Improved           |
| Test/build/lint validation               | Yes           | Yes                |
| Code change artifact tracking            | Basic         | Improved           |
| Code impact analysis                     | No            | Yes                |
| Safe fallback when CodeGraph unavailable | No            | Yes                |

### Improvement Suggestions

1. **Create `CodeGraphProvider` interface**:

   ```typescript
   interface CodeGraphProvider {
     isAvailable(): Promise<boolean>;
     getProjectStructure(root: string): Promise<ProjectStructure>;
     getSymbol(name: string, file?: string): Promise<SymbolInfo | null>;
     getRelatedFiles(file: string): Promise<string[]>;
     getRelatedTests(file: string): Promise<string[]>;
     getCallers(symbol: string): Promise<Caller[]>;
     getImportGraph(file: string): Promise<ImportGraph>;
     getEntryPoints(root: string): Promise<string[]>;
     getAPIRoutes(root: string): Promise<APIRoute[]>;
     getImpactAnalysis(changedFiles: string[]): Promise<ImpactAnalysis>;
   }
   ```

2. **Implement `CodeGraphProvider`** that shells out to CodeGraph CLI.

3. **Create a `FallbackCodeGraphProvider`** that uses basic file scanning when CodeGraph is unavailable.

4. **Integrate into `TaskContextBuilder`** — For code tasks, use `CodeGraphProvider` to build richer context. For non-code tasks, skip.

5. **Move all code-specific logic** into a `FlowTaskCodePlugin` that registers:
   - Code scanner
   - Code planner hints
   - Code validators (diff-based, test-based)
   - Code artifact detectors
   - Code risk rules

---

## 20. Docs / Research / Data / Writing / Design / BA / QA / Release Plugins (24-31)

### Current State

**None of these plugins exist.** There are no specialized plugins for:

| Plugin            | Status          | Would Provide                                                                      |
| ----------------- | --------------- | ---------------------------------------------------------------------------------- |
| Docs              | Not implemented | Markdown scanning, structure validation, broken link detection, document artifacts |
| Research          | Not implemented | Research question extraction, source tracking, citation validation                 |
| Data              | Not implemented | CSV/JSON scanning, schema detection, data diff, data quality checks                |
| Writing           | Not implemented | Tone/grammar/clarity validation, revision tracking                                 |
| Design            | Not implemented | Image artifact tracking, design checklist validation                               |
| Business Analysis | Not implemented | Requirement extraction, gap analysis, decision tracking                            |
| QA                | Not implemented | Test scenario generation, defect summary, risk-based QA                            |
| Release           | Not implemented | Release checklist, deployment readiness review, rollback checklist                 |

### Improvement Suggestions

1. **Implement plugins incrementally**, starting with Docs and Data plugins (most general).

2. **Each plugin follows the same pattern**:

   ```
   src/plugins/<name>/
     index.ts            (plugin registration)
     scanner.ts          (file scanning)
     validators.ts       (domain-specific validators)
     templates.ts        (workflow templates)
     planner-hints.ts    (AI planner hints)
     artifact-detector.ts (domain artifact detection)
     schema.ts           (domain-specific schemas)
   ```

3. **Docs Plugin** should provide:
   - Markdown structure validation (heading hierarchy, required sections)
   - File existence validation for referenced documents
   - Summary/report completeness checks
   - Broken link detection (if external tools available)

4. **Research Plugin** should provide:
   - Research question extraction from prompt
   - Source citation tracking and format validation
   - Claim/evidence mapping
   - Research completeness validation

5. **Data Plugin** should provide:
   - CSV/JSON/YAML file scanning with schema inference
   - Row count and data quality checks
   - Data diff (before/after transformation)
   - Schema drift detection

---

## 21. Workflow Templates (32)

### Current State

- **UseCaseDetector**: Detects use case type from prompt keywords.
- **TaskTemplates** (`src/usecase/task-templates.ts`): Hardcoded templates for each use case type.

### Template Support

| Template             | Supported | Notes                   |
| -------------------- | --------- | ----------------------- |
| General task         | Yes       | Default 7-task template |
| Code feature         | Yes       | Via use case            |
| Bug fix              | Yes       | Via use case            |
| Refactor             | No        | Not a distinct use case |
| Test fix             | Partial   | Via testing use case    |
| Documentation        | Yes       | Via use case            |
| Research             | Yes       | Via use case            |
| Business analysis    | No        | Not a use case          |
| Product planning     | Partial   | Via planning use case   |
| Data analysis        | Yes       | Via use case            |
| Data cleanup         | No        | Not a use case          |
| Report generation    | No        | Not a use case          |
| Writing              | Yes       | Via use case            |
| Translation          | No        | Not a use case          |
| Design               | Partial   | Via ui-design use case  |
| QA checklist         | No        | Not a use case          |
| Release checklist    | No        | Not a use case          |
| Meeting summary      | No        | Not a use case          |
| Requirement analysis | No        | Not a use case          |
| Prompt engineering   | No        | Not a use case          |
| Operations           | No        | Not a use case          |
| Mixed workflow       | No        | Not a use case          |

### Improvement Suggestions

1. **Add missing use case types**: `refactor`, `data-cleanup`, `report-generation`, `translation`, `qa-checklist`, `release-checklist`, `meeting-summary`, `requirement-analysis`, `prompt-engineering`, `operations`, `mixed`.

2. **Make templates extensible** — Allow plugins to register templates.

3. **Add template metadata**:
   ```typescript
   interface WorkflowTemplate {
     name: string;
     description: string;
     useCase: string;
     minSteps: number;
     maxSteps: number;
     defaultSteps: TaskDefinition[];
     plannerGuide: string; // AI planner instructions
     validationGuide: string;
   }
   ```

---

## 22. Hook System (33)

### Current State

- **HookManager** (`src/core/hook-manager.ts`): Executes shell commands at lifecycle points.
- **Configured in config**: `beforeRun`, `afterRun`, `beforeTask`, `afterTask`, `beforeRetry`, `afterRetry`, `onFailure`.
- **Context via env vars**: `HOOK_RUN_ID`, `HOOK_TASK_ID`, etc.
- **Error handling**: `failOnError` flag controls whether hook failure stops execution.

### Gap Analysis

| Hook Point         | Supported | Notes            |
| ------------------ | --------- | ---------------- |
| beforeScan         | No        | Not in hook list |
| afterScan          | No        | Not in hook list |
| beforePlan         | No        | Not in hook list |
| afterPlan          | No        | Not in hook list |
| beforeStep         | No        | Task-level only  |
| afterStep          | No        | Task-level only  |
| onStepFail         | No        | Task-level only  |
| onStepRetry        | No        | Task-level only  |
| onApprovalRequired | No        | Not in hook list |
| beforeValidate     | No        | Not in hook list |
| afterValidate      | No        | Not in hook list |
| onArtifactCreated  | No        | Not in hook list |
| onFileChanged      | No        | Not in hook list |
| onRunComplete      | Yes       | as afterRun      |
| onRunFail          | No        | Not in hook list |
| onRunCancel        | No        | Not in hook list |

### Improvement Suggestions

1. **Add missing hook points**: `beforeScan`, `afterScan`, `beforePlan`, `afterPlan`, `beforeStep`, `afterStep`, `onStepFail`, `onStepRetry`, `onApprovalRequired`, `beforeValidate`, `afterValidate`, `onArtifactCreated`, `onFileChanged`, `onRunFail`, `onRunCancel`.

2. **Support webhook hooks** in addition to shell commands:

   ```json
   {
     "hooks": {
       "onRunComplete": [
         { "type": "shell", "command": "echo done" },
         { "type": "webhook", "url": "https://api.example.com/hooks/flowtask", "method": "POST" }
       ]
     }
   }
   ```

3. **Add hook timeout** (individual hook timeout, not just failOnError).

---

## 23. CLI Commands (34)

### Current State

23 CLI commands implemented in `src/cli/commands/`. Well-structured with thin command files calling `FlowTaskAPI`.

### Command Coverage

| Command                | Implemented                  | Notes                                    |
| ---------------------- | ---------------------------- | ---------------------------------------- |
| flowtask init          | Yes                          |                                          |
| flowtask setup         | Yes                          | AI provider setup                        |
| flowtask run           | Yes                          | Core run command                         |
| flowtask scan          | No                           | No standalone scan command               |
| flowtask plan          | No                           | Planning not exposed as separate command |
| flowtask status        | Yes                          |                                          |
| flowtask runs          | Yes                          |                                          |
| flowtask tasks         | Yes                          |                                          |
| flowtask tasks-edit    | Yes                          |                                          |
| flowtask tasks-approve | Yes                          |                                          |
| flowtask logs          | Yes                          |                                          |
| flowtask resume        | Yes                          |                                          |
| flowtask retry         | No `--failed-only`, `--from` | Missing options                          |
| flowtask inspect       | Yes                          |                                          |
| flowtask stop          | Yes                          |                                          |
| flowtask cancel        | Yes                          |                                          |
| flowtask clean         | Yes                          |                                          |
| flowtask doctor        | Yes                          |                                          |
| flowtask rules         | Yes                          |                                          |
| flowtask providers     | Yes                          | Multiple subcommands                     |
| flowtask config        | Yes                          |                                          |
| flowtask workflow      | Yes                          | Multiple subcommands                     |
| flowtask steps / step  | Yes                          |                                          |
| flowtask artifacts     | No                           | No artifact command                      |
| flowtask diff          | No                           | No workflow diff command                 |
| flowtask validate      | No                           | No standalone validate                   |
| flowtask pause         | No                           | No pause command                         |
| flowtask skip          | No                           | No skip command                          |
| flowtask approve       | No (step approve only)       | No run-level approve                     |
| flowtask reject        | No (step deny only)          | No run-level reject                      |
| flowtask history       | No                           | No history command                       |
| flowtask show          | No                           | No run detail command                    |
| flowtask graph         | No                           | No workflow graph command                |
| flowtask templates     | No                           | No template command                      |

### Improvement Suggestions

1. **Add missing commands**: `scan`, `plan`, `artifacts`, `diff`, `validate`, `pause`, `skip`, `history`, `show`, `graph`, `templates`.

2. **Add `--failed-only` and `--from <stepId>`** options to `flowtask retry`.

3. **Add `flowtask approve <runId>` and `flowtask reject <runId>`** for run-level approval.

---

## 24. Cost and Budget Control (36)

### Current State

**Not implemented.** No cost tracking, token tracking, or budget controls exist.

### Gap Analysis

| Feature                            | Supported | Notes                         |
| ---------------------------------- | --------- | ----------------------------- |
| Token tracking                     | Partial   | Planner metadata stores usage |
| Cost tracking                      | No        | No cost calculation           |
| Step cost estimate                 | No        | Not implemented               |
| Workflow cost estimate             | No        | Not implemented               |
| Actual cost report                 | No        | Not implemented               |
| Max token limit                    | No        | Not implemented               |
| Max cost limit                     | No        | Not implemented               |
| Stop when budget exceeded          | No        | Not implemented               |
| Ask approval when budget exceeded  | No        | Not implemented               |
| Cost by step                       | No        | Not implemented               |
| Cost by run                        | No        | Not implemented               |
| Cost by provider                   | No        | Not implemented               |
| Cheaper model for scanning         | No        | Single model per role         |
| Stronger model for planning/review | No        | Single model per role         |
| Configurable model by role         | No        | No role system                |

### Improvement Suggestions

1. **Add cost tracking** to the run and task schemas:

   ```typescript
   interface CostUsage {
     totalTokens: number;
     inputTokens: number;
     outputTokens: number;
     estimatedCost: number; // in USD
     providerCosts: Record<string, number>;
     byStep: Record<string, number>;
   }
   ```

2. **Add cost limits** in config:

   ```json
   {
     "cost": {
       "maxCostPerRun": 5.0,
       "maxCostPerTask": 1.0,
       "maxTokensPerRun": 1000000,
       "costPerInputToken": 0.0000025,
       "costPerOutputToken": 0.00001,
       "onExceeded": "ask" // "stop" | "ask" | "warn"
     }
   }
   ```

3. **Add model selection by role**:
   ```json
   {
     "ai": {
       "roles": {
         "scanner": { "provider": "openai", "model": "gpt-4.1-mini" },
         "planner": { "provider": "openai", "model": "gpt-4.1-nano" },
         "executor": { "provider": "openai", "model": "gpt-4.1" },
         "validator": { "provider": "openai", "model": "gpt-4.1-mini" },
         "reviewer": { "provider": "anthropic", "model": "claude-3-5-sonnet-latest" }
       }
     }
   }
   ```

---

## 25. AI Provider and Role System (37)

### Current State

- **8 provider types**: OpenAI, Anthropic, Gemini, Mistral, Azure OpenAI, Ollama, OpenAI-Compatible, Custom.
- **ProviderRegistry**: Manages provider instances.
- **ProviderService**: Routes requests to providers.
- **Single model per provider** in config. No role separation.

### Gap Analysis

| Feature                   | Supported | Notes                               |
| ------------------------- | --------- | ----------------------------------- |
| Planner model             | Yes       | Configurable                        |
| Executor model            | No        | External AI CLI (not API)           |
| Validator model           | Partial   | AI validation uses planner provider |
| Reviewer model            | No        | Not supported                       |
| Scanner model             | No        | Not supported                       |
| Fallback model            | Yes       | Planner retry                       |
| Retry with stronger model | No        | Uses same model                     |
| AI CLI adapter            | Yes       | Via executor system                 |
| API model adapter         | Yes       | Via AI providers                    |
| Local model adapter       | Partial   | Ollama supported                    |
| Custom provider adapter   | Yes       | Registration API                    |

### Improvement Suggestions

1. **Add role-based provider config** as described in section 24.

2. **Add retry with stronger model** — On planner failure, retry with a fallback model that is more capable.

3. **Add provider health ranking** — Track successful/failed calls per provider and auto-failover.

---

## 26. Configuration (39)

### Current State

- **`flowtask.config.json`** schema covers: version, projectMode, defaultExecutor, rules, approval, quality, validation, limits, hooks, logging, process, planner, ai, useCase, executors.
- **ConfigLoader**: Validates config with zod schema, merges defaults.

### Gap Analysis

| Config Section             | Present | Notes                      |
| -------------------------- | ------- | -------------------------- |
| Default provider           | Yes     |                            |
| Default models             | Partial | Planner only               |
| Default workflow mode      | Yes     | run mode                   |
| Default approval rules     | Yes     |                            |
| Default retry rules        | Partial | Task-level only            |
| Default timeout rules      | Partial | Run/task-level             |
| Default validation rules   | Yes     |                            |
| Default scan rules         | No      | Not configurable           |
| Include patterns           | No      | Not configurable           |
| Ignore patterns            | No      | Not configurable           |
| Protected file patterns    | No      | Not configurable           |
| Dangerous command patterns | No      | Hardcoded in SafetyChecker |
| Plugin config              | No      | No plugin system           |
| Hook config                | Yes     |                            |
| Template config            | No      | Not configurable           |
| Cost limits                | No      | Not implemented            |
| History retention          | No      | Not configurable           |
| Artifact retention         | No      | Not configurable           |

### Improvement Suggestions

1. **Add scan configuration**:

   ```json
   {
     "scan": {
       "maxFiles": 50,
       "maxFileSizeKb": 500,
       "includePatterns": ["**/*.ts", "**/*.md", "**/*.csv"],
       "excludePatterns": ["node_modules/**", "dist/**"],
       "enableCodegraph": true,
       "enablePdfScan": false
     }
   }
   ```

2. **Make safety patterns configurable**:

   ```json
   {
     "safety": {
       "blockedPatterns": ["rm -rf /"],
       "riskyPatterns": ["pnpm add", "git push"],
       "protectedFiles": [".env", "**/*.key", "**/*.pem"],
       "sensitiveEnvKeys": ["API_KEY", "SECRET", "TOKEN"]
     }
   }
   ```

3. **Add plugin configuration**:
   ```json
   {
     "plugins": {
       "enabled": ["code", "docs", "data"],
       "code": {
         "codegraphEnabled": true,
         "codegraphPath": "/usr/local/bin/codegraph"
       }
     }
   }
   ```

---

## 27. Final Report (41)

### Current State

- **ReportGenerator**: Produces `Report` interface and `generateMarkdown()`.
- **Report includes**: prompt, rules, summary, plan, completed/failed/skipped tasks, changed files, commands, artifacts, validation/quality results, errors, manual next steps.

### Gap Analysis

| Report Section           | Included | Notes                          |
| ------------------------ | -------- | ------------------------------ |
| Original user goal       | Yes      | prompt                         |
| Workflow summary         | Yes      | summary                        |
| Steps executed           | Yes      | completed tasks                |
| Steps skipped            | Yes      | skipped tasks                  |
| Steps failed             | Yes      | failed tasks                   |
| Artifacts created        | Partial  | From events only               |
| Files changed            | Yes      | From plan, not actual git diff |
| Validation results       | Partial  | From events                    |
| Approvals required       | No       | Not tracked                    |
| Errors encountered       | Partial  | Failed task errors             |
| Retry history            | No       | Not tracked                    |
| Cost/time usage          | No       | Not tracked                    |
| Remaining issues         | No       | Not tracked                    |
| Recommended next actions | Partial  | Manual next steps              |

### Improvement Suggestions

1. **Extend `Report` interface** with:
   - `approvalsRequired: number` and `approvalsGranted: number`
   - `retryHistory: { taskId, retries, lastError }[]`
   - `costUsage: CostUsage`
   - `duration: number` (execution time)
   - `remainingIssues: string[]`
   - `riskScore: number`
   - `driftSummary: string`

2. **Add retry history tracking** in task schema.

3. **Include actual git diff** in report, not just planned file changes.

---

## 28. Product Quality and Production Readiness (42, 43)

### Current Quality Assessment

| Quality Dimension                 | Rating | Notes                                                       |
| --------------------------------- | ------ | ----------------------------------------------------------- |
| Architecture clarity              | 8/10   | Good modular separation, some tight coupling (RunLifecycle) |
| Module boundaries                 | 8/10   | Clear interface contracts                                   |
| Type safety                       | 9/10   | Strict mode, zod schemas, no `any`                          |
| Test coverage                     | 9/10   | 1353 tests across 112 files                                 |
| Integration tests                 | 8/10   | Strong integration coverage                                 |
| Error messages                    | 6/10   | Inconsistent quality                                        |
| Logging                           | 8/10   | Comprehensive with redaction                                |
| Documentation                     | 7/10   | Good design docs, thin inline docs                          |
| Config examples                   | 7/10   | Good default config                                         |
| Developer experience              | 7/10   | Clear scripts, but complex codebase to navigate             |
| Extensibility                     | 4/10   | No plugin system, no extension points                       |
| Performance under large workflows | 5/10   | No lazy loading, all data in memory                         |
| Stability under failure           | 7/10   | Checkpoint + resume help                                    |

### Production Readiness

| Readiness Dimension | Rating | Notes                                    |
| ------------------- | ------ | ---------------------------------------- |
| Reliable            | 7/10   | Good validation, state persistence       |
| Recoverable         | 8/10   | Resume + checkpoint work well            |
| Observable          | 7/10   | Good logs, timeline events               |
| Safe                | 8/10   | Command classification, secret redaction |
| Extensible          | 4/10   | No plugin system                         |
| Fast enough         | 6/10   | OK for small/medium workflows            |
| Useful for non-code | 5/10   | Code-biased design                       |
| Clear for users     | 7/10   | Good CLI output                          |
| Easy to debug       | 6/10   | Mixed error quality                      |
| Easy to configure   | 7/10   | Config schema is clear                   |
| Easy to test        | 8/10   | Test infrastructure is solid             |
| Easy to extend      | 4/10   | Must edit core to extend                 |

---

## 29. Prioritized Improvement Roadmap

### Phase 1 — Foundation (High Priority)

1. **Workflow State Machine** — Formal FSM for workflows, tasks, and steps with all 21+ states
2. **Plugin Architecture** — Plugin interfaces, registry, config loading
3. **Generic Workflow Model** — Abstract step/workflow model with input/output contracts
4. **Extend Run Statuses** — Add missing states: SCANNING, WAITING_PLAN_APPROVAL, VALIDATING, RETRYING, STUCK, NEEDS_USER_REVIEW, WAITING_INPUT, WAITING_DEPENDENCY

### Phase 2 — Core Enhancement (High Priority)

5. **Structured Planning** — Extend planner output with evidence, approval, timeout, retry policy per step
6. **CodeGraph Integration** — CodeGraphProvider + FallbackProvider + Code Plugin
7. **Generic Validation** — Extend AiValidator with full evidence context, confidence scores, hybrid validation
8. **Artifact Tracking** — Extended artifact schema with expected/unexpected, diff, validation status

### Phase 3 — Visibility (Medium Priority)

9. **File Change Tracking** — Per-step file snapshots, diff, unexpected change detection
10. **Workflow Diff/Drift** — Expected vs actual comparison
11. **Timeline View** — Structured, queryable timeline from events
12. **Real-Time Status** — Enhanced real-time UI with file/artifact/validation progress
13. **Interactive Prompt Detection** — Pattern detection + WAITING_INPUT state

### Phase 4 — Safety and Control (Medium Priority)

14. **Cost/Budget Control** — Token tracking, cost estimation, budget limits
15. **Role-Based AI Models** — Different models for scan/plan/execute/validate/review
16. **Enhanced Safety** — Network command detection, large file warnings, safe/read-only modes
17. **Extended Approval Gates** — Env changes, cost threshold, validation override

### Phase 5 — Domain Plugins (Medium Priority)

18. **Docs Plugin** — Markdown scanning, structure validation
19. **Data Plugin** — CSV/JSON scanning, schema detection, data diff
20. **Research Plugin** — Source tracking, citation validation
21. **Additional CLI Commands** — scan, plan, artifacts, diff, validate, pause, history, templates

### Phase 6 — Performance and Polish (Low Priority)

22. **Lazy Loading** — Pagination for tasks, artifacts, logs
23. **Incremental Scanning** — File watch + delta updates
24. **Retention Policies** — Auto-cleanup
25. **Remaining Plugins** — Writing, Design, BA, QA, Release
26. **Additional Templates** — Refactor, data-cleanup, translation, meeting-summary, mixed
27. **Run Export/Compare** — JSON export, run-to-run comparison

---

_End of Architecture Review_
