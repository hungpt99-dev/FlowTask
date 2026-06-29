# Step Editing and Approval Feature Design

> **Status:** implemented | **Last reviewed:** 2026-06-29 | **Audience:** contributors

## Overview

Add step-level editing, approval (accept/deny), and auto-bypass modes to FlowTask. Currently, tasks are flat atomic units with no sub-steps, and the approval system (`waiting_approval` status, `ApprovalManager`, `manual` mode) exists in schema/classes but is **never wired into the execution lifecycle**.

This design introduces a first-class **Step** entity under each Task, integrates approval into task execution at the step level, and adds configuration for auto-bypass approval.

---

## 1. Step Schema

New file: `src/schemas/step.schema.ts`

```typescript
export const StepStatusSchema = z.enum([
  "pending",
  "pending_approval",
  "approved",
  "denied",
  "running",
  "done",
  "failed",
  "cancelled",
  "interrupted",
]);

export const StepTypeSchema = z.enum(["command", "read", "write", "edit", "shell", "approval"]);

export const StepSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  type: StepTypeSchema.default("command"),
  command: z.string().optional(),
  status: StepStatusSchema,
  requiresApproval: z.boolean().default(false),
  approvalReason: z.string().optional(),
  exitCode: z.number().int().optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  order: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const StepsSchema = z.array(StepSchema);

export type Step = z.infer<typeof StepSchema>;
export type StepStatus = z.infer<typeof StepStatusSchema>;
export type StepType = z.infer<typeof StepTypeSchema>;
```

## 2. Task Schema Extension

Add optional `steps` array to `TaskSchema` in `src/schemas/task.schema.ts`:

```typescript
export const TaskSchema = z.object({
  // ... existing fields
  steps: z.array(StepSchema).optional(),
});
```

## 3. Config Schema Extension

Extend `ApprovalConfigSchema` in `src/schemas/config.schema.ts`:

```typescript
export const ApprovalConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoApprove: z.boolean().default(false),
  stepLevel: z.boolean().default(true),
  requireFor: z
    .array(z.string())
    .default([
      "delete_file",
      "install_dependency",
      "git_push",
      "deploy",
      "database_migration",
      "read_sensitive_file",
    ]),
});
```

| Field         | Default | Description                                      |
| ------------- | ------- | ------------------------------------------------ |
| `enabled`     | `true`  | Master toggle for approval system                |
| `autoApprove` | `false` | Auto-bypass: approve all steps without prompting |
| `stepLevel`   | `true`  | Enable step-level approval (vs. task-level)      |
| `requireFor`  | [...]   | Step types requiring approval by default         |

## 4. Planner Integration

The planner (both simple and AI) generates steps for each task. Steps represent the concrete actions needed.

### Simple Planner Steps

The 7-task template generates pre-defined steps per task type. For example, task "Implement service" would generate steps: analyze current code, create service file, implement logic, add tests, verify.

### AI Planner Steps

The AI planner prompt instructs the model to produce steps alongside tasks. The output shape extends:

```typescript
interface StepDefinition {
  title: string;
  description?: string;
  type: "command" | "read" | "write" | "edit" | "shell" | "approval";
  command?: string;
  requiresApproval: boolean;
  approvalReason?: string;
  order: number;
}
```

## 5. StepManager

New module: `src/core/step-manager.ts`

```typescript
export class StepManager {
  private rootPath: string;

  constructor(rootPath: string);

  // CRUD
  async loadSteps(runId: string, taskId: string): Promise<Step[]>;
  async saveSteps(runId: string, taskId: string, steps: Step[]): Promise<void>;
  async getStep(runId: string, taskId: string, stepId: string): Promise<Step | undefined>;

  // Editing
  async updateStep(
    runId: string,
    taskId: string,
    stepId: string,
    updates: Partial<Step>,
  ): Promise<Step>;

  // Approval
  async approveStep(runId: string, taskId: string, stepId: string): Promise<Step>;
  async denyStep(runId: string, taskId: string, stepId: string): Promise<Step>;
  async approveAllPending(runId: string, taskId: string): Promise<Step[]>;

  // Status
  async updateStepStatus(
    runId: string,
    taskId: string,
    stepId: string,
    status: StepStatus,
  ): Promise<Step>;
}
```

Steps are stored in `.flowtask/runs/<runId>/steps.json` — a flat indexed file mapping task ID to step array:

```json
{
  "runId": "run_...",
  "stepsByTask": {
    "task_001": [
      /* Step[] */
    ],
    "task_005": [
      /* Step[] */
    ]
  }
}
```

## 6. Approval Manager Enhancements

Update `src/safety/approval-manager.ts` to support step-level approval with richer context:

```typescript
export interface StepApprovalRequest {
  stepId: string;
  taskId: string;
  taskTitle: string;
  stepTitle: string;
  stepType: string;
  command?: string;
  reason: string;
}

export class ApprovalManager {
  // Existing
  async requestApproval(request: ApprovalRequest): Promise<boolean>;

  // New
  async requestStepApproval(
    request: StepApprovalRequest,
    options?: { autoApprove?: boolean },
  ): Promise<"approved" | "denied">;

  async requestBatchStepApproval(
    requests: StepApprovalRequest[],
    options?: { autoApprove?: boolean },
  ): Promise<Map<string, "approved" | "denied">>;
}
```

### Interactive Prompt (enquirer)

```
  ── Step requires approval ──

  Task:  Implement OCR service (task_005)
  Step:  Install tesseract.js dependency (step_002)
  Type:  shell
  Command: pnpm add tesseract.js
  Reason: Adding new dependency

  [y] Approve  [n] Deny  [s] Skip remaining  [a] Approve all
```

When `autoApprove` is `true` in config, the approval prompt is skipped and all steps are auto-approved.

## 7. Lifecycle Integration

### Task Execution with Steps (`executeTask` in `run-lifecycle.ts`)

When a task has steps, execution changes from a single executor call to a step-by-step flow:

```
1. Load steps for the task
2. For each step in order:
   a. If step.status is "done" or "approved", skip
   b. If step.requiresApproval:
      - If autoApprove: set status to "approved" automatically
      - If not: set status to "pending_approval", call ApprovalManager
      - If denied: set step status to "denied", mark task as failed
      - If approved: set step status to "approved"
   c. Set step status to "running"
   d. Execute step (based on type):
      - "command"/"shell": run via ShellExecutor or CommandExecutor
      - "read", "write", "edit": handled internally
   e. Set step status to "done" or "failed"
   f. If failed: trigger task retry or fail
3. After all steps done: run task-level validation
```

### Key flow:

```
executeTask()
  └── if task has steps:
        └── executeSteps(task.steps)
              └── for each step:
                    ├── requiresApproval + !autoApprove
                    │     → prompt user (accept/deny)
                    │     → denied → fail task
                    │     → approved → continue
                    ├── requiresApproval + autoApprove
                    │     → auto-approve, continue
                    └── execute step
                          → success → next step
                          → fail → retry/fail task
  └── run task-level validation
  └── mark task done/failed
```

## 8. CLI Commands

### `flowtask steps` — List steps for a task

```bash
flowtask steps <taskId>           # List steps for a task
flowtask steps <taskId> --run <runId>
flowtask steps <taskId> --status pending_approval  # Filter by status
```

Output:

```
Task: Implement OCR service (task_005)

Steps:
  1. [✓] Analyze existing code structure                  done
  2. [✓] Create OCR service file                          done
  3. [⚠] Install tesseract.js dependency                  pending_approval
  4. [ ] Implement OCR logic                              pending
  5. [ ] Add unit tests                                   pending
  6. [ ] Verify typecheck passes                          pending
```

### `flowtask step` — Single step operations

```bash
flowtask step edit <stepId> --title "New title"           # Edit step
flowtask step edit <stepId> --command "pnpm add dep"       # Edit command
flowtask step edit <stepId> --description "Updated desc"   # Edit description

flowtask step approve <stepId>                             # Approve a step
flowtask step approve <stepId> --run <runId>

flowtask step deny <stepId>                                # Deny a step
flowtask step deny <stepId> --reason "Not safe"            # Deny with reason
```

### `flowtask run` — New flags

```bash
flowtask run "prompt" --approval-mode auto    # Auto-approve all steps (equivalent to config autoApprove=true)
flowtask run "prompt" --approval-mode manual  # Manual approval for each step (default when stepLevel=true)
flowtask run "prompt" --approval-mode skip    # Skip all approval prompts (dangerous)
```

## 9. Run Mode Behavior Matrix

| Mode        | Without Steps                     | With Steps + stepLevel=true                                                                   |
| ----------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `auto`      | Execute all tasks without pausing | Execute all; steps marked `requiresApproval` auto-approved if `autoApprove=true`, else prompt |
| `manual`    | Ask before each task (planned)    | Ask before each step that requires approval                                                   |
| `plan-only` | Generate plan, no execution       | Generate plan + steps, no execution; user can edit/approve/deny steps                         |
| `dry-run`   | Show what would happen            | Show steps that would execute, including which need approval                                  |
| `debug`     | Show detailed state               | Show step state alongside task state                                                          |

### Multi-runner: `flowtask step` in Plan-Only Mode

The user can:

1. Run `flowtask run "Implement OCR" --plan-only`
2. Review generated tasks and steps
3. Run `flowtask steps task_005` to see steps
4. Run `flowtask step edit step_002 --command "pnpm add ocr-lib@2.0"` to edit
5. Run `flowtask step approve step_002` to approve
6. Run `flowtask step deny step_004 --reason "Manual implementation needed"`
7. Run `flowtask resume` to execute with approvals

## 10. File Storage

Steps are persisted in:

```
.flowtask/runs/<runId>/
  steps.json          # All steps for the run (indexed by task ID)
  outputs/
    step-results.json # Step execution results
```

### steps.json format

```json
{
  "runId": "run_20260626_103000_implement_ocr_module",
  "stepsByTask": {
    "task_001": [
      {
        "id": "step_001",
        "taskId": "task_001",
        "runId": "run_...",
        "title": "Read project rules",
        "type": "read",
        "status": "done",
        "requiresApproval": false,
        "order": 0,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "task_005": [
      {
        "id": "step_002",
        "taskId": "task_005",
        "runId": "run_...",
        "title": "Install tesseract.js dependency",
        "type": "shell",
        "command": "pnpm add tesseract.js",
        "status": "pending_approval",
        "requiresApproval": true,
        "approvalReason": "Adding new dependency",
        "order": 2,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
}
```

## 11. Implementation Plan

### Phase 1: Schema & Core (High Priority)

| Step | File                                       | Description                                                 |
| ---- | ------------------------------------------ | ----------------------------------------------------------- |
| 1.1  | `src/schemas/step.schema.ts`               | Create StepSchema, StepStatusSchema, StepTypeSchema         |
| 1.2  | `src/schemas/task.schema.ts`               | Add optional `steps` array to TaskSchema                    |
| 1.3  | `src/schemas/config.schema.ts`             | Extend ApprovalConfigSchema with `autoApprove`, `stepLevel` |
| 1.4  | `src/core/step-manager.ts`                 | Create StepManager with CRUD + approval operations          |
| 1.5  | `src/schemas/index.ts` (or schemas barrel) | Export new types                                            |

### Phase 2: Approval Wiring (High Priority)

| Step | File                             | Description                                                   |
| ---- | -------------------------------- | ------------------------------------------------------------- |
| 2.1  | `src/safety/approval-manager.ts` | Add `requestStepApproval`, `requestBatchStepApproval`         |
| 2.2  | `src/core/run-lifecycle.ts`      | Wire step execution into `executeTask()`, add `executeStep()` |
| 2.3  | `src/core/run-lifecycle.ts`      | Handle `pending_approval` status transition in task loop      |
| 2.4  | `src/core/run-manager.ts`        | Add `saveSteps` / `loadSteps` delegation to StepManager       |

### Phase 3: CLI Commands (High Priority)

| Step | File                       | Description                                                         |
| ---- | -------------------------- | ------------------------------------------------------------------- |
| 3.1  | `src/cli/steps.command.ts` | `flowtask steps <taskId>` — list steps                              |
| 3.2  | `src/cli/step.command.ts`  | `flowtask step edit`, `flowtask step approve`, `flowtask step deny` |
| 3.3  | `src/cli/run.command.ts`   | Add `--approval-mode` flag                                          |
| 3.4  | `src/cli/index.ts`         | Register new commands                                               |

### Phase 4: Planner Integration (Medium Priority)

| Step | File                                 | Description                                     |
| ---- | ------------------------------------ | ----------------------------------------------- |
| 4.1  | `src/planner/simple-planner.ts`      | Generate steps for each task in 7-task template |
| 4.2  | `src/planner/internal-ai-planner.ts` | Prompt AI planner to include step definitions   |

### Phase 5: Tests (Required)

| Step | File                                     | Description                         |
| ---- | ---------------------------------------- | ----------------------------------- |
| 5.1  | `tests/schemas/step.schema.test.ts`      | Step schema validation              |
| 5.2  | `tests/core/step-manager.test.ts`        | Step CRUD + approval operations     |
| 5.3  | `tests/safety/approval-manager.test.ts`  | Step approval prompts, auto-approve |
| 5.4  | `tests/core/run-lifecycle-steps.test.ts` | Step execution integration          |
| 5.5  | `tests/cli/steps.test.ts`                | CLI commands                        |
| 5.6  | `tests/fixtures/`                        | Step test fixtures                  |

---

## 12. User Flow Diagram

```
flowtask run "Implement OCR" --mode auto
  │
  ├── Planner generates 8 tasks with steps
  │
  ├── executeTask(task_005 "Implement OCR service")
  │     │
  │     ├── Step 1: Analyze code [safe]                 → auto-execute
  │     ├── Step 2: Create OCR service file [safe]      → auto-execute
  │     ├── Step 3: Install dependency [risky]          → ⚠ APPROVAL NEEDED
  │     │     ├── autoApprove=true                      → auto-approved
  │     │     └── autoApprove=false                     → [y/N] prompt
  │     │           ├── approved                        → execute step
  │     │           └── denied                          → fail task
  │     ├── Step 4: Implement logic [safe]              → auto-execute
  │     └── Step 5: Run tests [safe]                    → auto-execute
  │
  └── Validation → Report
```

## 13. Config Examples

### Default (no step-level approval):

```json
{
  "approval": {
    "enabled": true,
    "autoApprove": false,
    "stepLevel": false,
    "requireFor": ["delete_file", "install_dependency"]
  }
}
```

### Auto bypass all approval:

```json
{
  "approval": {
    "enabled": false
  }
}
```

### Step-level approval with auto-approve for trusted projects:

```json
{
  "approval": {
    "enabled": true,
    "autoApprove": true,
    "stepLevel": true,
    "requireFor": ["delete_file", "install_dependency", "deploy"]
  }
}
```

### Strict manual review (all steps require approval in manual mode):

```json
{
  "approval": {
    "enabled": true,
    "autoApprove": false,
    "stepLevel": true,
    "requireFor": ["read", "write", "edit", "shell", "command"]
  }
}
```
