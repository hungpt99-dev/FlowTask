# Outcome-Based Validation Requirements

## 1. Problem Statement

Current validation is file/process-based — it checks whether the executor process exited with code 0, whether files exist on disk, and whether custom validation commands pass. It has no understanding of **what outcome was expected** for a given task.

This means:

- A task that creates the wrong file is treated the same as one that creates the right file
- A research task cannot be validated (no files to check)
- An investigation task passes as long as the CLI exits 0, regardless of whether the answer is correct
- Validation treats all task types identically

## 2. Core Concept

Every task describes its **expected result** — what the world should look like after successful execution. Validation then compares the actual result against that expectation, using available evidence.

```
Task → Expected Result → Execution → Gather Evidence → Compare → Verdict
```

## 3. Task Types

Tasks are classified into types that determine default validation behavior:

| Type            | Description                   | Typical Evidence                          |
| --------------- | ----------------------------- | ----------------------------------------- |
| `coding`        | Implement, refactor, fix code | Files, test pass, lint pass, git diff     |
| `documentation` | Write docs, README, guides    | File exists, content length, format check |
| `research`      | Investigate, compare, analyze | Executor output keywords, AI review       |
| `planning`      | Design, architecture, plan    | Artifact exists, content quality          |
| `debugging`     | Find root cause, fix bug      | Test pass, error resolved, git diff       |
| `testing`       | Write tests, add coverage     | Test files, test pass, coverage           |
| `devops`        | Config, CI, deploy, infra     | Config files, command output              |
| `review`        | Code review, audit, validate  | AI review, checklist, comments            |
| `general`       | Uncategorized                 | Process exit + file checks + output       |

Type is set by the planner (AI or simple) and stored on the task.

## 4. Expected Result Format

Each task carries an `expectedResult` field — a structured description of what success looks like:

```typescript
interface ExpectedOutcome {
  /** Short description of what should be true after execution */
  summary: string;

  /** Task type for validation adaptation */
  type: TaskTypeValue;

  /** Files that should exist with specific properties */
  files?: ExpectedFile[];

  /** Git diff expectations */
  gitDiff?: {
    required: boolean;
    minChangedFiles?: number;
  };

  /** Executor output should contain these keywords */
  outputContains?: string[];

  /** Executor output should NOT contain these keywords */
  outputExcludes?: string[];

  /** Validation commands that should pass */
  validationCommands?: string[];

  /** Artifacts that should be produced */
  artifacts?: string[];

  /** AI review prompt to verify the outcome */
  aiReview?: {
    prompt: string;
    required: boolean;
  };
}

interface ExpectedFile {
  path: string;
  /** "any": file exists, "content": non-empty, "exact": exact match, "pattern": regex match */
  requirement: "exists" | "nonEmpty" | "contentMatch";
  contentPattern?: string; // regex when requirement is "contentMatch"
  minSize?: number; // minimum bytes
}
```

## 5. Schema Changes

### 5.1 Task Schema — Add `expectedResult` and `type`

```typescript
const TaskTypeSchema = z.enum([
  "coding",
  "documentation",
  "research",
  "planning",
  "debugging",
  "testing",
  "devops",
  "review",
  "general",
]);

export const TaskSchema = z.object({
  // ... existing fields ...
  type: TaskTypeSchema.default("general"),
  expectedResult: ExpectedOutcomeSchema.optional(),
});
```

### 5.2 Expected Outcome Schema

```typescript
export const ExpectedOutcomeSchema = z.object({
  summary: z.string().min(1),
  type: TaskTypeSchema.default("general"),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        requirement: z.enum(["exists", "nonEmpty", "contentMatch"]).default("exists"),
        contentPattern: z.string().optional(),
        minSize: z.number().int().min(0).optional(),
      }),
    )
    .optional(),
  gitDiff: z
    .object({
      required: z.boolean().default(false),
      minChangedFiles: z.number().int().min(0).optional(),
    })
    .optional(),
  outputContains: z.array(z.string()).optional(),
  outputExcludes: z.array(z.string()).optional(),
  validationCommands: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  aiReview: z
    .object({
      prompt: z.string().min(1),
      required: z.boolean().default(false),
    })
    .optional(),
});
```

## 6. Evidence Types

Validation gathers evidence from these sources:

| Evidence Type    | Source             | How Collected                                    |
| ---------------- | ------------------ | ------------------------------------------------ |
| **Process**      | Executor result    | exit code, status                                |
| **Files**        | File system        | `fileExists()`, `readTextFile()`, `fileStat()`   |
| **Content**      | File content       | Regex/pattern matching on file contents          |
| **Output**       | Executor stdout    | Keyword search on executor output                |
| **Commands**     | Shell commands     | Run validation commands, check exit codes        |
| **Git diff**     | Git                | `git diff --stat`, `git status`                  |
| **Artifacts**    | Artifact manager   | Check artifact records exist at expected paths   |
| **AI review**    | AI provider        | Send evidence + criteria to AI for judgment      |
| **Logs**         | Task output logs   | Parse structured log data                        |
| **Test results** | Test runner output | Parse test framework output for pass/fail counts |

## 7. Validation Logic by Task Type

Each task type has a default validation profile that determines which evidence types are required and how verdicts are weighted:

### 7.1 `coding`

- **Always check**: process exit, files (if specified), git diff, validation commands
- **Conditionally**: content match, AI review (for complex logic)
- **Verdict weights**: files (40%), commands (30%), process (20%), git diff (10%)
- **Pass threshold**: ≥ 70% weighted score

### 7.2 `documentation`

- **Always check**: process exit, file exists, file non-empty
- **Conditionally**: content pattern, file size minimum, AI review (for quality)
- **Verdict weights**: files (50%), process (20%), content (20%), AI review (10%)
- **Pass threshold**: ≥ 60% weighted score

### 7.3 `research`

- **Always check**: process exit, output contains keywords
- **Conditionally**: AI review (verify answer quality), artifacts
- **Verdict weights**: output (40%), AI review (40%), process (20%)
- **Pass threshold**: ≥ 50% weighted score

### 7.4 `planning`

- **Always check**: process exit, artifact exists, artifact non-empty
- **Conditionally**: content pattern, AI review
- **Verdict weights**: artifacts (50%), process (20%), AI review (30%)
- **Pass threshold**: ≥ 60% weighted score

### 7.5 `debugging`

- **Always check**: process exit, validation commands (tests pass), git diff
- **Conditionally**: output excludes (error gone), AI review
- **Verdict weights**: commands (40%), process (20%), git diff (20%), output (20%)
- **Pass threshold**: ≥ 70% weighted score

### 7.6 `testing`

- **Always check**: process exit, file exists, validation commands
- **Conditionally**: content match (test patterns), git diff
- **Verdict weights**: commands (50%), files (30%), process (20%)
- **Pass threshold**: ≥ 70% weighted score

### 7.7 `devops`

- **Always check**: process exit, files exist, validation commands
- **Conditionally**: content match, output contains
- **Verdict weights**: commands (40%), files (30%), process (30%)
- **Pass threshold**: ≥ 70% weighted score

### 7.8 `review`

- **Always check**: process exit, AI review
- **Conditionally**: output contains, artifacts
- **Verdict weights**: AI review (60%), process (20%), output (20%)
- **Pass threshold**: ≥ 50% weighted score

### 7.9 `general` (default)

- **Always check**: process exit, check specified fields only
- **Verdict**: passed if process exits 0 AND all specified checks pass
- **Fallback**: warning if only process passed

## 8. Result Classification

Each validation produces one of three verdicts:

### 8.1 Acceptable

- All high-weight checks passed
- Weighted score meets pass threshold for the task type
- Evidence collected confirms expected result
- **Action**: Mark task done, continue run

### 8.2 Incomplete

- Some checks passed, some failed
- Weighted score is below threshold but > 30%
- Not all evidence could be collected
- **Action**: Retry with failure context, or mark as incomplete (user configurable)

### 8.3 Failed

- Critical checks failed (process crash, missing required files)
- Weighted score ≤ 30%
- Evidence contradicts expected result
- **Action**: Retry if retries remain, otherwise fail task

### 8.4 Verdict Decision Flow

```
Check all evidence sources
  → Calculate weighted score per task type profile
  → Score ≥ threshold?   → Acceptable
  → Score ≥ 30%?         → Incomplete (retry)
  → Otherwise            → Failed
```

## 9. AI Review Integration

For tasks with `aiReview` configured, validation includes an AI-based judgment step:

1. Collect all available evidence (files, output, logs, test results)
2. Format evidence into a structured prompt
3. Send to configured AI provider with the `aiReview.prompt` criteria
4. Parse AI response for verdict (`acceptable`, `incomplete`, `failed`)
5. Include as a validation check of type `ai_review`

Fallback: If AI review is `required: false` and the provider is unavailable, skip AI review and proceed with other evidence. If `required: true`, fail validation.

### AI Review Prompt Template

```
Task: {task.title}
Expected: {expectedResult.summary}

Evidence collected:
{evidence}

Criteria:
{aiReview.prompt}

Based on the evidence, is the expected result achieved?
Respond with JSON:
{"verdict": "acceptable"|"incomplete"|"failed", "reason": "..."}
```

## 10. Outcome Validator

New validator class: `OutcomeValidator`

Responsibilities:

1. Receive `task.expectedResult` + `executorResult` + `task.type`
2. Select evidence sources to query based on task type
3. Query each evidence source
4. Calculate weighted score
5. Return verdict + detailed check results

```typescript
export class OutcomeValidator {
  async validate(input: OutcomeValidationInput): Promise<OutcomeValidationResult> {
    // 1. Determine task type and load validation profile
    const profile = getValidationProfile(input.task.type);

    // 2. Collect evidence based on expected result + profile
    const evidence = await this.collectEvidence(input);

    // 3. Score each evidence item
    const checks = this.scoreEvidence(evidence, profile);

    // 4. Calculate weighted score
    const score = this.calculateWeightedScore(checks, profile);

    // 5. Determine verdict
    const verdict = this.determineVerdict(score, profile.passThreshold);

    return { verdict, score, checks };
  }
}
```

## 11. Planner Changes

### 11.1 AI Planner

The AI planner prompt should be updated to include `expectedResult` in each task output. The `AiPlannerTaskSchema` needs an `expectedResult` field:

```typescript
export const AiPlannerTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  type: TaskTypeSchema.default("general"),
  expectedResult: ExpectedOutcomeSchema.optional(),
  // ... existing fields ...
});
```

### 11.2 Simple Planner

The simple planner's task templates should include `expectedResult` for each of the 7 default tasks. Task templates in `src/usecase/task-templates.ts` should assign type + expectedResult per task.

### 11.3 Planner Prompt Guidance

The AI planner should be instructed to derive `expectedResult` from the user prompt and task type:

```
For each task, define what the expected result looks like:
- What files should exist?
- What should the outputs contain?
- What validation commands should pass?
- Should there be a git diff?
- What artifacts should be produced?
```

## 12. Integration with ValidationEngine

The `ValidationEngine.validateTask()` method is extended to:

1. Check if `task.expectedResult` exists
2. If yes, delegate to `OutcomeValidator` which:
   a. Collects evidence (files, output, git, commands, artifacts, AI review)
   b. Scores against expected result
   c. Returns verdict
3. If no `expectedResult`, fall back to current behavior (process + file + command + acceptance criteria)

```typescript
class ValidationEngine {
  async validateTask(input: ValidateTaskInput): Promise<ValidationResult> {
    if (input.task.expectedResult) {
      return this.outcomeValidator.validate({
        projectRoot: input.projectRoot,
        task: input.task,
        executorResult: input.executorResult,
      });
    }
    // Fall back to current behavior
    return this.legacyValidateTask(input);
  }
}
```

## 13. ValidationCheck Enhancement

Add a new `type` value to `ValidationCheckSchema`:

```typescript
type: z.enum([
  "process",
  "file",
  "artifact",
  "command",
  "git_diff",
  "manual",
  "ai_review",
  "acceptance_criteria",
  "content",
  "outcome", // NEW: overall outcome verdict
  "evidence", // NEW: evidence collection result
]);
```

And add verdict-related fields:

```typescript
extended ValidationCheck {
  verdict?: "acceptable" | "incomplete" | "failed";
  score?: number;       // 0-100 weighted score
  expected?: string;    // what was expected
  actual?: string;      // what was found
  evidenceType?: string; // which evidence source
}
```

## 14. Config Changes

New config section in `.flowtask/config.json`:

```json
{
  "validation": {
    "profile": "safe",
    "outcomeBased": {
      "enabled": true,
      "aiReview": {
        "enabled": true,
        "provider": "openai",
        "model": "gpt-4.1-mini"
      },
      "defaultPassThreshold": 0.7,
      "profiles": {
        "coding": { "passThreshold": 0.7 },
        "research": { "passThreshold": 0.5 },
        "documentation": { "passThreshold": 0.6 }
      }
    }
  }
}
```

## 15. Implementation Order

### Phase 1: Schema + Data Model

1. Add `TaskTypeSchema` and `ExpectedOutcomeSchema` to schemas
2. Add `expectedResult` and `type` to `TaskSchema`
3. Update `AiPlannerTaskSchema` to include type + expectedResult
4. Add verdict-related fields to `ValidationCheckSchema`

### Phase 2: Outcome Validator

1. Create `OutcomeValidator` class
2. Implement evidence collection (files, output, git, commands, artifacts)
3. Implement weighted scoring per task type profile
4. Implement verdict decision logic

### Phase 3: Planner Updates

1. Update AI planner prompt to generate expectedResult per task
2. Update simple planner templates to include expectedResult
3. Update `processPlannerOutput` to validate expectedResult

### Phase 4: AI Review Integration

1. Create `AiReviewValidator` that calls AI provider for outcome judgment
2. Integrate with OutcomeValidator as optional evidence source

### Phase 5: Integration

1. Wire OutcomeValidator into ValidationEngine
2. Update configuration schema with outcome-based options
3. Add config defaults

### Phase 6: Reporting

1. Update final report to show outcome-based verdicts
2. Show evidence collected vs expected per task
3. Show weighted score breakdown

## 16. Backward Compatibility

- Tasks without `expectedResult` use existing validation (unchanged)
- Tasks without `type` default to `general`
- Missing `type` in planner output defaults to `general`
- AI review is optional unless explicitly required
- All new schemas are optional with defaults
