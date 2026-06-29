# Structured Output Plan

## 1. Overview

A structured output plan defines **what a task or step should produce** — files, artifacts, configs, reports — with explicit action type (`create`, `modify`, `delete`), validation method, and acceptance criteria. This replaces free-text `expectedResult` with a machine-verifiable list of expected outputs.

```
Task → Output Plan Items → Execution → Action-Aware Validation → Plan-vs-Reality Check
```

## 2. Schema

`src/schemas/output-plan.schema.ts`

### OutputActionType

```typescript
z.enum(["create", "modify", "delete"]);
```

| Action   | Meaning                                  |
| -------- | ---------------------------------------- |
| `create` | The target should exist after execution  |
| `modify` | The target should exist and have changes |
| `delete` | The target should no longer exist        |

### OutputValidationMethod

```typescript
z.enum([
  "file_exists",
  "file_content",
  "file_diff",
  "command_output",
  "test",
  "ai_review",
  "manual",
]);
```

| Method           | What it checks                                             |
| ---------------- | ---------------------------------------------------------- |
| `file_exists`    | Target exists on disk (action-aware: create/modify/delete) |
| `file_content`   | Target exists with non-empty, meaningful content           |
| `file_diff`      | Target has git diff changes (or was created)               |
| `command_output` | Executor output mentions target + action                   |
| `test`           | Executor exit code 0 or target file exists                 |
| `ai_review`      | Flags item for AI-based review (returns warning)           |
| `manual`         | Flags item for manual verification (returns warning)       |

### OutputPlanItem

```typescript
{
  action: OutputActionType;          // "create" | "modify" | "delete"
  target: string;                    // file path (relative or absolute)
  description?: string;              // human-readable description
  validationMethod: OutputValidationMethod;  // how to validate (default: "file_exists")
  acceptanceCriteria?: string[];     // additional criteria strings
}

// A plan is an array of items:
type OutputPlan = OutputPlanItem[];
```

## 3. Integration Points

### 3.1 Task Schema (`src/schemas/task.schema.ts`)

Each `Task` carries an optional `outputPlan` field:

```typescript
outputPlan: OutputPlanSchema.optional();
```

Coexists with legacy `validation.requiredFiles` — both are checked during validation.

### 3.2 WorkflowTaskSchema (`src/schemas/workflow.schema.ts`)

Workflow YAML tasks also support `outputPlan`:

```yaml
tasks:
  - id: impl-1
    title: Implement feature
    outputPlan:
      - action: create
        target: src/feature.ts
        description: New feature module
        validationMethod: file_exists
      - action: modify
        target: src/index.ts
        description: Export new feature
        validationMethod: file_diff
```

### 3.3 Step Schema (`src/schemas/step.schema.ts`)

Individual steps within a task also support per-step output plans:

```typescript
outputPlan: OutputPlanSchema.optional();
```

### 3.4 Task Templates (`src/usecase/task-templates.ts`)

All 12 use-case templates include `outputPlan` on each task:

| Template      | Example outputs                                    |
| ------------- | -------------------------------------------------- |
| coding        | `docs/rules-review.md` (create), `src/` (modify)   |
| documentation | `docs/outline.md` (create), `docs/` (modify)       |
| debugging     | `docs/error-analysis.md` (create), `src/` (modify) |
| research      | `docs/research-findings.md` (create)               |
| planning      | `docs/execution-plan.md` (create)                  |
| project-setup | `package.json` (create), `package.json` (modify)   |
| testing       | `tests/` (create), `tests/` (modify)               |
| devops        | `.github/` (create), `deploy/` (modify)            |
| data-analysis | `data/` (create)                                   |
| ui-design     | `src/` (modify)                                    |
| writing       | `docs/` (create)                                   |
| general       | `reports/final-report.md` (create)                 |

### 3.5 AI Planner Output (`src/schemas/planner.schema.ts`)

The `AiPlannerTaskSchema` includes `outputPlan` so AI-generated plans include structured output items. The AI planner prompt should instruct the AI to define concrete outputs per task.

## 4. Executor Handling

### 4.1 Context Pack (`src/context/context-pack-builder.ts`)

When building the executor context pack, output plans are rendered as a structured "Expected Outputs" section:

```
## Expected Outputs
- **Create** `src/feature.ts`
  - New feature module
  - Validation: file_exists
- **Modify** `src/index.ts`
  - Export new feature
  - Validation: file_diff
```

This gives the executor (AI CLI) a clear, bulleted list of what to produce — no free-text parsing needed.

### 4.2 Executor Result (`src/executor/executor.ts`)

The `ExecutorResult` interface includes an `outputPlanResults` field:

```typescript
interface OutputPlanResult {
  target: string;
  action: "create" | "modify" | "delete";
  description?: string;
  produced: boolean;
  evidence?: string;
}
```

Executors can optionally populate this to report which planned outputs were produced.

### 4.3 Serialization

`serializeOutputPlan()` converts output plans to JSON strings for embedding in context packs or commands.

## 5. Validation Process

### 5.1 OutputPlanValidator (`src/validation/output-plan-validator.ts`)

The `OutputPlanValidator` validates each output plan item against real-world evidence.

**Validation flow per item:**

```
For each OutputPlanItem:
  → Resolve target to absolute path (relative to projectRoot or absolute)
  → Switch on validationMethod:
      file_exists → check existence (action-aware)
      file_content → check exists + non-empty content
      file_diff   → check git diff/status changes
      command_output → check executor output mentions target + action
      test        → check exit code or file existence
      ai_review   → flag for AI review (warning)
      manual      → flag for manual review (warning)
  → If acceptanceCriteria present → validate each criterion against file content
  → Return ValidationCheck[]
```

**Action-aware behavior for `file_exists`:**

| Action   | File exists | Verdict |
| -------- | ----------- | ------- |
| `create` | Yes         | passed  |
| `create` | No          | failed  |
| `modify` | Yes         | passed  |
| `modify` | No          | failed  |
| `delete` | No          | passed  |
| `delete` | Yes         | failed  |

**Action-aware behavior for `file_diff`:**

| Action   | Git diff found | File exists | Verdict  |
| -------- | -------------- | ----------- | -------- |
| `create` | Yes            | Yes         | passed   |
| `create` | No             | Yes         | passed\* |
| `modify` | Yes            | Yes         | passed   |
| `modify` | No             | Yes         | warning  |
| `delete` | N/A            | No          | passed   |
| `delete` | N/A            | Yes         | failed   |

\*File created but git not tracking changes = still passed.

### 5.2 ValidationEngine Integration (`src/validation/validation-engine.ts`)

Within `validateTask()`, output plan validation runs after all other validators:

1. Process validator (exit code)
2. File validator (requiredFiles)
3. Content validator (requiredContent)
4. Command validator (validation commands)
5. Acceptance criteria validator
6. Outcome comparison validator (expectedResult keyword match)
7. **Output plan validator** (structured output items)

If `outputPlan` is present and non-empty, the validator runs and appends checks. All checks are then evaluated together to determine the final verdict.

### 5.3 ValidationCheck Type

Output plan checks use `type: "output_plan"` and include:

| Field      | Description                                                              |
| ---------- | ------------------------------------------------------------------------ |
| `type`     | `"output_plan"`                                                          |
| `status`   | `"passed"` / `"failed"` / `"warning"`                                    |
| `path`     | The target file path                                                     |
| `message`  | Human-readable validation result                                         |
| `evidence` | Collected evidence string                                                |
| `details`  | Object with action, validationMethod, target, and method-specific fields |
| `criteria` | (optional) Which acceptance criterion this check corresponds to          |

## 6. Workflow YAML Example

```yaml
runTitle: "Set up CI pipeline"
tasks:
  - id: setup-ci-1
    title: Create GitHub Actions workflow
    executor: shell
    outputPlan:
      - action: create
        target: .github/workflows/ci.yml
        description: CI workflow configuration
        validationMethod: file_content
        acceptanceCriteria:
          - Contains on push and pull_request triggers
          - Contains build and test jobs
      - action: modify
        target: README.md
        description: Add CI badge to README
        validationMethod: file_diff
  - id: setup-ci-2
    title: Verify CI configuration
    executor: shell
    dependsOn: [setup-ci-1]
    outputPlan:
      - action: create
        target: reports/ci-validation.md
        description: CI validation report
        validationMethod: file_exists
```

## 7. Key Benefits

- **Machine-verifiable** — no free-text parsing needed for validation
- **Action-aware** — knows whether to check for creation, modification, or deletion
- **Multi-method validation** — file checks, git diff, content, output, or AI review
- **Executor clarity** — AI CLI gets a bulleted list of expected outputs, not prose
- **Plan-vs-reality** — validation compares planned outputs against actual filesystem state
- **Future-proof** — new validation methods can be added to the enum without schema changes
