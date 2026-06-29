# AiValidator Design

> **Status:** implemented | **Last reviewed:** 2026-06-29 | **Audience:** contributors

## 1. Interface

```typescript
// src/validation/ai-validator.ts

export interface AiVerdict {
  verdict: "passed" | "failed" | "warning";
  suggestion: string;
  explanation: string;
}

export interface AiValidatorInput {
  taskTitle: string;
  taskDescription: string;
  executorOutput: string;
  executorExitCode: number | undefined;
  acceptanceCriteria: string[];
  outputPlan: OutputPlanItem[];
  retryContext: AiValidatorRetryContext;
}

export interface AiValidatorRetryContext {
  attemptNumber: number;
  maxRetries: number;
  previousVerdicts: AiVerdict[];
}

export interface AiValidator {
  validate(input: AiValidatorInput): Promise<AiVerdict>;
}
```

## 2. Verdict Semantics

| Verdict   | Meaning                                                           | Retry?                     |
| --------- | ----------------------------------------------------------------- | -------------------------- |
| `passed`  | AI confirms the executor's output satisfies the task requirements | No                         |
| `failed`  | AI concludes the output does not meet requirements                | Yes                        |
| `warning` | AI is uncertain but sees no clear failure                         | Configurable (default: no) |

## 3. Data Flow

```
  OutputPlanValidator.validateItem()
           │
           │ validationMethod === "ai_review"
           ▼
  AiValidator.validate(input)
           │
           │ 1. Build system prompt (role + schema instruction)
           │ 2. Build user prompt (task description + executor output + retry context)
           │ 3. Call ProviderRegistry.getProvider(config.aiValidator.provider)
           │ 4. provider.generate(request) with response_format: json_object
           │ 5. Parse structured JSON verdict from response
           │ 6. Validate response shape with Zod
           │ 7. Fallback: if JSON parse fails, retry with relaxed prompt once
           │ 8. Return AiVerdict
           ▼
  OutputPlanValidator wraps verdict into a ValidationCheck:
    - verdict "passed"   → status "passed",  message from suggestion
    - verdict "failed"   → status "failed",  message from suggestion
    - verdict "warning"  → status "warning", message from suggestion
           │
           ▼
  ValidationEngine.validateTask() includes this check in the result
           │
           ▼
  RunLifecycle.executeTask() processes the validation result
```

## 4. Prompt Design

### System Prompt

```
You are an AI reviewer validating the output of an automated task executor.
Your job is to determine whether the executor's output satisfies the task requirements.

Return ONLY valid JSON with this exact structure:
{
  "verdict": "passed" | "failed" | "warning",
  "suggestion": "Brief actionable guidance for what to fix or improve (empty string on pass)",
  "explanation": "Detailed reasoning for the verdict"
}

Rules:
- "passed": The output clearly satisfies all acceptance criteria and the task description.
- "failed": The output clearly fails to meet the task requirements. Provide a specific suggestion.
- "warning": The output is partially correct but has concerns, or evidence is insufficient for a clear pass/fail.
- The suggestion is used as feedback for the next retry iteration — write it for the executor, not the user.
- Be thorough but fair. Consider exit codes, error messages, and content evidence.
```

### User Prompt Template

```
## Task
{taskTitle}

### Description
{taskDescription}

### Acceptance Criteria
{acceptanceCriteria}

### Expected Outputs (Output Plan)
{outputPlan}

## Executor Output

Exit code: {exitCode}

Stdout/Stderr:
```

{executorOutput}

```

## Retry Context
Attempt {attemptNumber} of {maxRetries}.
Previous attempts:
{previousVerdictsFormatted}

Review the executor output and return a verdict.
```

## 5. Configuration

The AiValidator config sits under `.flowtask/config.json`:

```json
{
  "validation": {
    "aiValidator": {
      "enabled": true,
      "provider": "openai",
      "model": "gpt-4.1-mini",
      "temperature": 0.1,
      "maxTokens": 1024,
      "fallbackOnError": true
    }
  }
}
```

- `provider` names a provider from `ai.providers.<name>` (reuses the same credential resolution and provider infrastructure)
- `fallbackOnError`: if the AI call fails (network, parse, etc.), fall back to `flagForReview` (current warning behavior) instead of failing validation

## 6. Retry Feedback Loop

The key innovation is closing the loop from validation → retry context:

```
  ┌──────────────────────────────────────────────────┐
  │                  executeTask()                    │
  │                                                    │
  │  1. Build contextPack with isRetry=false           │
  │  2. executor.execute(contextPack)                  │
  │  3. validationEngine.validateTask()                │
  │       └─ OutputPlanValidator.validate()            │
  │            └─ AiValidator.validate(input)          │
  │                 returns AiVerdict {verdict, suggestion} │
  │  4. If verdict === "failed":                       │
  │       a. Append suggestion to retryContext          │
  │       b. Rebuild contextPack with:                  │
  │            isRetry: true                            │
  │            errorLog: previousError + "\nAI Review Feedback:\n" + suggestion │
  │       c. retryCount++ → go to step 2               │
  │  5. If verdict === "passed": mark task done         │
  │                                                    │
  └──────────────────────────────────────────────────┘
```

### ContextPackBuilder Changes

The `ContextPackInput` already has `isRetry` and `errorLog` fields. The retry feedback works as follows:

- On retry, `errorLog` is prepended with the AI validator's `suggestion` under a section "### AI Review Feedback"
- The executor sees the suggestion in its context pack on the next attempt
- For the AI executor (opencode, claude, etc.), this means it reads the feedback and adjusts its approach

### Feedback Format in Context Pack

```
## Retry Context
This is a retry attempt for task: {taskTitle}

### Previous Error
```

{errorLog}

```

### AI Review Feedback
```

{suggestion}

```

```

## 7. Integration Points

### OutputPlanValidator Changes

Replace the `flagForReview` stub in `validateByActionAndMethod` for `case "ai_review"`:

```typescript
case "ai_review":
  return this.validateByAiReview(item, executorResult);
```

New method:

```typescript
private async validateByAiReview(
  item: OutputPlanItem,
  executorResult: ExecutorResult,
): Promise<ValidationCheck> {
  const aiValidator = new AiValidatorImpl(/* provider registry, config */);
  const verdict = await aiValidator.validate({
    taskTitle: ...,
    taskDescription: ...,
    executorOutput: executorResult.output ?? "",
    executorExitCode: executorResult.exitCode,
    acceptanceCriteria: item.acceptanceCriteria ?? [],
    outputPlan: [item],
    retryContext: { attemptNumber: 1, maxRetries: 3, previousVerdicts: [] },
  });

  return {
    type: "ai_review",
    status: verdict.verdict === "passed" ? "passed" : verdict.verdict === "failed" ? "failed" : "warning",
    path: item.target,
    message: verdict.suggestion || verdict.explanation,
    evidence: `AI review: ${verdict.explanation}`,
    details: {
      action: item.action,
      validationMethod: "ai_review",
      target: item.target,
      verdict: verdict.verdict,
      suggestion: verdict.suggestion,
    },
  };
}
```

### RunLifecycle Changes

In `executeTask()`, after a failed validation (line ~1143):

```typescript
// Collect AI review suggestions from output_plan checks with ai_review method
const aiReviewSuggestions = validationResult.checks
  .filter((c) => c.type === "ai_review" && c.status === "failed")
  .map((c) => c.details?.suggestion as string)
  .filter(Boolean);

if (aiReviewSuggestions.length > 0) {
  const feedbackText = "AI Review Feedback:\n" + aiReviewSuggestions.join("\n---\n");
  // Rebuild contextPack with retry feedback
  contextPack = this.contextPackBuilder.build({
    prompt,
    rulesContext,
    run,
    task,
    completedTasks,
    isRetry: true,
    errorLog: feedbackText,
  });
  // Re-write context pack file
  await writeTextFile(contextPackPath, contextPack.markdown);
}
```

## 8. Error Handling

| Scenario                         | Behavior                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| AI provider returns invalid JSON | Retry once with repaired prompt; if still invalid, use `fallbackOnError` config     |
| AI provider network error        | If `fallbackOnError: true`, return warning check (current `flagForReview` behavior) |
| AI provider auth error           | Throw error to surface misconfiguration; do not silently skip validation            |
| Empty executor output            | Pass to AI provider — let it evaluate based on exit code and task context           |
| Provider not configured          | Log warning, fall back to `flagForReview` warning                                   |

## 9. Implementation Order

1. Create `src/validation/ai-validator.ts` — `AiVerdict`, `AiValidatorInput`, `AiValidatorRetryContext` interfaces and `AiValidator` interface
2. Create `src/validation/ai-validator-impl.ts` — `AiValidatorImpl` class implementing `AiValidator`, consuming `ProviderRegistry`
3. Add `aiValidator` config schema to `src/schemas/config.schema.ts`
4. Update `OutputPlanValidator.validateByActionAndMethod()` — wire `ai_review` case to `AiValidatorImpl`
5. Update `RunLifecycle.executeTask()` — collect AI review suggestions and rebuild context pack on retry
6. Tests in `tests/validation/ai-validator.test.ts` and `tests/validation/output-plan-validator.test.ts`

## 10. Open Questions

- Should `AiValidatorImpl` be a standalone class or a wrapper around the existing `Planner` infrastructure? Design decision: standalone class that takes `ProviderRegistry` as a dependency, reusing the AI provider factory. The planner is planning-specific; the validator should not inherit planner logic.
- What `maxTokens` / `temperature` defaults make sense for validation? Lower temperature (0.1) for strict determinism; 1024 tokens is sufficient for a verdict JSON.
- Should the system prompt be user-configurable? Initially no — use a hardcoded prompt. Can be exposed via config in a future iteration.
