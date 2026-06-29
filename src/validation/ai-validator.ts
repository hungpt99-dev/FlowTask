import { z } from "zod";
import { ProviderRegistry } from "../ai/provider-registry.js";
import { generateWithResponseFormatFallback } from "../ai/response-format-fallback.js";

export type AiValidationMode = "off" | "fallback" | "always" | "high_risk_only";

export const AiVerdictSchema = z.object({
  status: z.enum(["passed", "failed", "warning", "needs_retry", "needs_review"]),
  suggestion: z.string(),
  explanation: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  evidenceSummary: z.string(),
  evidenceGaps: z.array(z.string()).optional().default([]),
});

export type AiVerdict = z.infer<typeof AiVerdictSchema>;

export function createPassedVerdict(explanation?: string, evidenceSummary?: string): AiVerdict {
  return {
    status: "passed",
    suggestion: "",
    explanation: explanation ?? "All evidence confirms task completed successfully",
    confidence: "high",
    evidenceSummary: evidenceSummary ?? "Strong evidence confirms task completion",
    evidenceGaps: [],
  };
}

export function createFailedVerdict(suggestion: string, explanation?: string): AiVerdict {
  return {
    status: "failed",
    suggestion,
    explanation: explanation ?? suggestion,
    confidence: "high",
    evidenceSummary: "Evidence shows task requirements were not met",
    evidenceGaps: [suggestion],
  };
}

export function createNeedsReviewVerdict(
  suggestion: string,
  evidenceGaps: string[],
  explanation?: string,
): AiVerdict {
  return {
    status: "needs_review",
    suggestion,
    explanation: explanation ?? "Insufficient evidence to determine task completion",
    confidence: "low",
    evidenceSummary: "Evidence is insufficient or ambiguous",
    evidenceGaps,
  };
}

export function createSkippedVerdict(reason: string): AiVerdict {
  return {
    status: "needs_review",
    suggestion: reason,
    explanation: reason,
    confidence: "low",
    evidenceSummary: "AI validation was skipped",
    evidenceGaps: [],
  };
}

export interface OutputPlanEvidence {
  action: string;
  target: string;
  produced: boolean;
  evidence?: string;
}

export interface AiValidatorParams {
  taskDescription: string;
  executorOutput: string;
  errorOutput?: string;
  providerName?: string;
  expectedResult?: string;
  acceptanceCriteria?: string[];
  executorStatus?: string;
  exitCode?: number;
  changedFiles?: string[];
  artifacts?: string[];
  commandResults?: string;
  outputPlanResults?: OutputPlanEvidence[];
  validationMode?: AiValidationMode;
  outputPlan?: string[];
  workflowType?: string;
  previousValidationResults?: string;
  logs?: string;
}

const MAX_OUTPUT_LENGTH = 15000;
const MAX_ERROR_LENGTH = 5000;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_CRITERIA_LENGTH = 4000;
const MAX_COMMAND_RESULTS_LENGTH = 8000;

export class AiValidator {
  private registry: ProviderRegistry;

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
  }

  async validate(params: AiValidatorParams): Promise<AiVerdict> {
    const preCheck = this.checkEvidenceSufficiency(params);
    if (preCheck) {
      return preCheck;
    }

    let provider;
    try {
      provider = this.registry.getProvider(params.providerName);
    } catch {
      return createSkippedVerdict(
        "AI provider unavailable — configure a provider in .flowtask/config.json",
      );
    }

    const mode = params.validationMode ?? "fallback";
    const systemPrompt = this.buildSystemPrompt(mode, params.workflowType);
    const userPrompt = this.buildUserPrompt(params);

    try {
      const { response } = await generateWithResponseFormatFallback(
        provider.name,
        {
          systemPrompt,
          userPrompt,
          responseFormat: "json_object",
        },
        (req) => provider.generate(req),
      );

      const parsed = this.parseVerdict(response.text);
      return AiVerdictSchema.parse(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return createNeedsReviewVerdict(
        `AI validation failed: ${message}`,
        ["AI provider response could not be parsed"],
        `The AI provider returned an unparseable response. Raw error: ${message}`,
      );
    }
  }

  appendSuggestionToContext(contextPackMarkdown: string, verdict: AiVerdict): string {
    const parts: string[] = [];
    parts.push("## AI Validation Feedback");
    if (verdict.suggestion) {
      parts.push(`**${verdict.status.toUpperCase()}** — ${verdict.suggestion}`);
    }
    if (verdict.explanation) {
      parts.push(`Explanation: ${verdict.explanation}`);
    }
    if (verdict.confidence) {
      parts.push(`Confidence: ${verdict.confidence}`);
    }
    parts.push("");
    return contextPackMarkdown + "\n\n" + parts.join("\n");
  }

  private checkEvidenceSufficiency(params: AiValidatorParams): AiVerdict | undefined {
    if (!params.executorOutput && params.executorStatus !== "failed") {
      return createNeedsReviewVerdict("No executor output available for review", [
        "executor output",
        "stdout/stderr",
      ]);
    }

    if (
      params.executorStatus === "done" &&
      params.exitCode === 0 &&
      !params.executorOutput &&
      !params.changedFiles?.length &&
      !params.artifacts?.length &&
      !params.commandResults
    ) {
      return createNeedsReviewVerdict("Task completed with zero evidence — cannot verify result", [
        "no output was captured",
        "no files were changed",
        "no artifacts produced",
        "no command results available",
      ]);
    }

    return undefined;
  }

  private truncate(text: string, maxLen: number): string {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, maxLen) + `\n\n[... truncated, original length: ${text.length} chars]`;
  }

  private buildSystemPrompt(mode: AiValidationMode, workflowType?: string): string {
    const modeGuidance = this.getModeGuidance(mode);
    const workflowGuidance = this.getWorkflowTypeGuidance(workflowType);

    return `You are an AI validation agent for FlowTask. Your job is to review task execution evidence and determine if the task was completed successfully.

You will receive: task description, workflow type, expected result, acceptance criteria, executor output/errors, executor exit code, changed files, created artifacts, command/test/build/lint results, output plan results, previous validation results, and logs.

## Validation Mode: ${mode}

${modeGuidance}

${workflowGuidance}

## Evidence Evaluation Rules

Evaluate evidence in this priority order:

1. **Executor process result** — Did the process exit successfully (exit code 0)? Non-zero exit indicates failure unless clear evidence proves otherwise.
2. **Test/build/lint results** — Did validation commands pass? A failing test or build is strong evidence the task is incomplete.
3. **Acceptance criteria** — Were all acceptance criteria explicitly met? Each criterion should be individually verifiable from the evidence.
4. **Expected result** — Does the actual output match the expected result? Look for concrete evidence (file created with correct content, command produced expected output).
5. **Changed files and artifacts** — Do the created/modified files satisfy the task description? Check if file names, paths, and implied content match requirements.
6. **Output plan results** — Were all planned outputs produced successfully?
7. **Executor output** — Does the stdout/stderr show the task completed the intended work? Look for specific confirmation messages.
8. **Previous validation results** — Were previous validation checks (deterministic, acceptance criteria, output plan) passed or failed? Use these as additional evidence signals.

## Evidence Sufficiency Thresholds

Before marking "passed", you MUST have AT LEAST:

- **For code tasks** (creating/modifying files): At least one changed file or created artifact MUST exist on disk. Executor output alone is NEVER sufficient.
- **For command tasks** (running a script, generating output): Exit code 0 AND output matching expected result.
- **For test tasks**: Test output showing tests passing (not just exit code 0).
- **For documentation tasks**: File must exist with meaningful content matching requirements.

**Insufficient evidence patterns** (return "needs_review" or "failed"):
- Only executor output exists but no files were changed for a code task
- Only "looks good" patterns in output but no specific confirmations
- Acceptance criteria cannot be verified from provided evidence
- Exit code is 0 but output is empty or generic

## Decision Guidelines

### When to return "passed"
- Exit code is 0 AND acceptance criteria are met AND expected result is confirmed by evidence
- Or: exit code is non-zero but ALL other evidence (files, output, acceptance criteria) clearly shows the goal was achieved
- Deterministic validation commands passed
- Evidence sufficiency thresholds are met

### When to return "failed"
- Exit code is non-zero AND there is no clear evidence the goal was achieved
- Acceptance criteria clearly not met
- Required files or artifacts are missing and no plausible explanation
- Test/build/lint commands failed and errors indicate actual problems
- "Looks plausible" is NOT sufficient evidence — require specific, concrete evidence
- Evidence sufficiency thresholds are NOT met for a code task

### When to return "needs_retry"
- Evidence suggests the failure is transient or fixable by retrying
- Exit code is non-zero but output suggests a temporary issue (network, timeout, race condition)
- Files were partially created and retry could complete them
- Not for logic errors, design issues, or missing requirements

### When to return "needs_review"
- Evidence is ambiguous or contradictory
- Some criteria met, some not — unclear which way to decide
- Potential safety concerns were detected
- Task involves subjective judgment that requires human assessment
- Multiple evidence types conflict with each other
- There is not enough evidence to confidently decide either way
- Evidence sufficiency thresholds are partially met but gaps remain

### When to return "warning"
- Task mostly completed but has minor issues
- All major criteria met but some non-critical detail is missing
- Exit code is 0 but acceptance criteria are partially met
- Evidence is somewhat thin but what exists is positive

## Evidence Gap Analysis

Before deciding, explicitly identify:

1. **What evidence IS available** — List each piece of evidence and what it proves
2. **What evidence is MISSING** — What would definitively confirm/reject completion?
3. **What evidence contradicts completion** — Any evidence suggesting failure
4. **Confidence assessment** — Based on available evidence, how sure can you be?

### Critical rules
- If there is NOT ENOUGH evidence to confirm the expected result was achieved, return "needs_review" or "failed" — never "passed" based on assumption.
- Do NOT override a failed deterministic check (non-zero exit, failed test) unless the remaining evidence overwhelmingly proves success.
- Do NOT mark "passed" if only the executor output exists but no changed files or artifacts were produced for a task that required creating/modifying files.
- Be specific in your suggestion and explanation: name missing files, failed criteria, contradictory evidence, or evidence gaps.
- If you return "passed" with "low" confidence, the system will flag this for review — be honest about your confidence.

Return a JSON object with these fields:
- "status": One of "passed", "failed", "warning", "needs_retry", or "needs_review" as defined above.
- "suggestion": A brief, specific, actionable string explaining your reasoning. Include what evidence is missing or what went wrong. Use empty string if passed.
- "explanation": A detailed explanation of your reasoning, including what evidence you considered and why you reached this conclusion.
- "confidence": One of "high", "medium", or "low" indicating your confidence in this verdict.
- "evidenceSummary": A one-sentence summary of the evidence that drove your decision.
- "evidenceGaps": An array of strings listing specific evidence gaps that would help confirm or reject the verdict. Empty array if no gaps.

Return ONLY valid JSON. No markdown. No code fences. No explanation.`;
  }

  private getModeGuidance(mode: AiValidationMode): string {
    switch (mode) {
      case "always":
        return `Validation mode is "always": AI review runs on every task. Be thorough but fair. Apply the standard evidence thresholds. If evidence strongly supports success, return "passed". If evidence is weak or absent, flag accordingly. Do not become overly strict — use your judgment.`;
      case "fallback":
        return `Validation mode is "fallback": AI review runs only when deterministic checks are weak or absent. Your role is to fill gaps that automated checks missed. Be precise and conservative — don't override clear deterministic signals. If deterministic checks would have been sufficient but were missing, apply normal evidence standards.`;
      case "high_risk_only":
        return `Validation mode is "high_risk_only": AI review runs only for high-risk tasks (failed execution, retries, or deletion operations). Be extra thorough and strict. Scrutinize all evidence carefully. When in doubt, prefer "needs_review" over "passed". High-risk tasks demand higher confidence thresholds.`;
      default:
        return "";
    }
  }

  private getWorkflowTypeGuidance(workflowType?: string): string {
    switch (workflowType) {
      case "code":
        return `## Workflow Type: Code Task

This is a code implementation task. Key validation criteria:
- Created/modified files MUST exist on disk with meaningful content
- Executor output alone is NEVER sufficient — require actual file evidence
- Test/build/lint results are strong evidence when available
- Check that file content matches the task description
- Verify imports, exports, and API contracts are correct`;
      case "documentation":
        return `## Workflow Type: Documentation Task

This is a documentation task. Key validation criteria:
- Document files MUST exist with meaningful content (200+ chars)
- Check for structured sections (headings, paragraphs, formatting)
- Verify the document covers the required topics
- Output alone is acceptable IF the document is in the output`;
      case "research":
        return `## Workflow Type: Research Task

This is a research/analysis task. Key validation criteria:
- Look for cited sources, references, or evidence of research
- Check for analytical content (findings, conclusions, analysis)
- Evaluate structure: headings, sections, organized content
- Check for metrics, data points, or quantitative evidence
- Brief outputs (<500 chars) suggest incomplete research`;
      case "data":
        return `## Workflow Type: Data Task

This is a data processing/transformation task. Key validation criteria:
- Verify output data files exist (CSV, JSON, etc.)
- Check for schema changes or data transformations
- Validate row counts, data quality indicators
- Look for transformation logic or data pipeline evidence`;
      case "writing":
        return `## Workflow Type: Writing Task

This is a content writing task. Key validation criteria:
- Verify written content exists (files or substantial output)
- Check for tone, clarity, and structure
- Evaluate grammar and formatting quality
- Verify the content meets the described requirements`;
      case "design":
        return `## Workflow Type: Design Task

This is a design/UI task. Key validation criteria:
- Look for design artifacts (screenshots, mockups, specs)
- Check for UI-related output (rendered, displayed, components)
- Verify visual requirements are addressed
- Screenshot artifacts are strong evidence`;
      case "checklist":
        return `## Workflow Type: Checklist / QA Task

This is a QA or checklist task. Key validation criteria:
- Check for structured list items (bullets, numbers, checkboxes)
- Look for completion status indicators (done/passed/failed counts)
- Verify progress tracking (e.g., "3/5 items complete")
- Evaluate coverage of required checklist items`;
      case "business_analysis":
        return `## Workflow Type: Business Analysis Task

This is a business analysis task. Key validation criteria:
- Look for requirement extraction and analysis
- Check for gap analysis, stakeholder analysis, or risk assessment
- Evaluate decision tracking and recommendations
- Verify acceptance criteria are well-defined`;
      case "mixed":
        return `## Workflow Type: Mixed Workflow

This is a mixed workflow involving multiple task types. Key validation criteria:
- Evaluate evidence across all relevant dimensions
- Consider both code and non-code artifacts
- Check for expected outputs of each type mentioned
- Be comprehensive — mixed workflows may have diverse evidence`;
      default:
        return `## Workflow Type: General

This is a general task. Apply standard validation criteria:
- Verify expected outputs were produced
- Check acceptance criteria are met
- Evaluate executor output for completion signals
- Consider any files, artifacts, or command results as evidence`;
    }
  }

  private buildUserPrompt(params: AiValidatorParams): string {
    const parts: string[] = [];

    if (params.workflowType) {
      parts.push("## Workflow Type");
      parts.push(params.workflowType);
    }

    parts.push("## Task Description");
    parts.push(this.truncate(params.taskDescription, MAX_DESCRIPTION_LENGTH));

    if (params.expectedResult) {
      parts.push("## Expected Result");
      parts.push(params.expectedResult);
    }

    if (params.acceptanceCriteria && params.acceptanceCriteria.length > 0) {
      parts.push("## Acceptance Criteria");
      const criteriaText = params.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
      parts.push(this.truncate(criteriaText, MAX_CRITERIA_LENGTH));
    }

    if (params.outputPlan && params.outputPlan.length > 0) {
      parts.push("## Output Plan (Expected Outputs)");
      params.outputPlan.forEach((p) => parts.push(`- ${p}`));
    }

    parts.push("## Executor Status");
    parts.push(`Status: ${params.executorStatus ?? "unknown"}`);
    if (params.exitCode !== undefined) {
      parts.push(`Exit Code: ${params.exitCode}`);
    }

    const executorOutput = this.truncate(params.executorOutput || "(no output)", MAX_OUTPUT_LENGTH);
    parts.push("## Executor Output (stdout/stderr)");
    parts.push(executorOutput);

    if (params.errorOutput) {
      parts.push("## Executor Error Output");
      parts.push(this.truncate(params.errorOutput, MAX_ERROR_LENGTH));
    }

    if (params.logs) {
      parts.push("## Log Output");
      parts.push(this.truncate(params.logs, MAX_OUTPUT_LENGTH));
    }

    if (params.changedFiles && params.changedFiles.length > 0) {
      parts.push("## Changed Files");
      parts.push(params.changedFiles.join("\n"));
    }

    if (params.artifacts && params.artifacts.length > 0) {
      parts.push("## Created Artifacts");
      parts.push(params.artifacts.join("\n"));
    }

    if (params.commandResults) {
      parts.push("## Validation Command / Test / Build / Lint Results");
      parts.push(this.truncate(params.commandResults, MAX_COMMAND_RESULTS_LENGTH));
    }

    if (params.outputPlanResults && params.outputPlanResults.length > 0) {
      parts.push("## Output Plan Results");
      for (const r of params.outputPlanResults) {
        const partsList: string[] = [];
        partsList.push(
          `- Action: ${r.action}, Target: ${r.target}, Produced: ${r.produced ? "yes" : "no"}`,
        );
        if (r.evidence) {
          partsList.push(`, Evidence: ${r.evidence}`);
        }
        parts.push(partsList.join(""));
      }
    }

    if (params.previousValidationResults) {
      parts.push("## Previous Validation Results");
      parts.push(params.previousValidationResults);
    }

    const evidenceSummary = this.buildEvidenceSummary(params);
    if (evidenceSummary) {
      parts.push("## Evidence Summary");
      parts.push(evidenceSummary);
    }

    return parts.join("\n\n");
  }

  private buildEvidenceSummary(params: AiValidatorParams): string {
    const lines: string[] = [];
    const add = (label: string, value: string) => lines.push(`- ${label}: ${value}`);

    if (params.workflowType) {
      add("Workflow type", params.workflowType);
    }
    add("Executor status", params.executorStatus ?? "unknown");
    if (params.exitCode !== undefined) {
      add("Exit code", String(params.exitCode));
    }
    add("Has stdout/stderr output", params.executorOutput ? "yes" : "no");
    add("Has error output", params.errorOutput ? "yes" : "no");
    add("Has log output", params.logs ? "yes" : "no");
    add("Changed files count", String(params.changedFiles?.length ?? 0));
    add("Artifacts count", String(params.artifacts?.length ?? 0));
    add("Has command/test results", params.commandResults ? "yes" : "no");
    add("Has expected result", params.expectedResult ? "yes" : "no");
    add("Acceptance criteria count", String(params.acceptanceCriteria?.length ?? 0));
    add("Output plan items", String(params.outputPlanResults?.length ?? 0));
    if (params.outputPlanResults && params.outputPlanResults.length > 0) {
      const produced = params.outputPlanResults.filter((r) => r.produced).length;
      add("Output plan items produced", `${produced}/${params.outputPlanResults.length}`);
    }
    add("Has previous validation results", params.previousValidationResults ? "yes" : "no");

    const evidenceStrength = this.assessEvidenceStrength(params);
    add("Evidence strength", evidenceStrength);

    return lines.join("\n");
  }

  private assessEvidenceStrength(params: AiValidatorParams): string {
    let score = 0;
    let maxScore = 0;

    if (params.executorOutput) {
      score += 1;
    }
    maxScore += 1;

    if (params.errorOutput) {
      score += 1;
    }
    maxScore += 1;

    if (params.logs) {
      score += 1;
    }
    maxScore += 1;

    if (params.changedFiles && params.changedFiles.length > 0) {
      score += 2;
    }
    maxScore += 2;

    if (params.artifacts && params.artifacts.length > 0) {
      score += 1;
    }
    maxScore += 1;

    if (params.commandResults) {
      score += 2;
    }
    maxScore += 2;

    if (params.acceptanceCriteria && params.acceptanceCriteria.length > 0) {
      score += 1;
    }
    maxScore += 1;

    if (params.expectedResult) {
      score += 1;
    }
    maxScore += 1;

    if (params.outputPlanResults && params.outputPlanResults.length > 0) {
      const produced = params.outputPlanResults.filter((r) => r.produced).length;
      if (produced === params.outputPlanResults.length) {
        score += 2;
      } else if (produced > 0) {
        score += 1;
      }
    }
    maxScore += 2;

    if (params.previousValidationResults) {
      score += 1;
    }
    maxScore += 1;

    const ratio = score / maxScore;
    if (ratio >= 0.7) return "strong";
    if (ratio >= 0.4) return "moderate";
    if (ratio > 0) return "weak";
    return "none";
  }

  private parseVerdict(text: string): unknown {
    const trimmed = text.trim();

    const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
    if (fenceMatch && fenceMatch[1]) {
      return JSON.parse(fenceMatch[1]);
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw new SyntaxError(
      `Could not extract valid JSON from AI response. Response (${trimmed.length} chars): ${trimmed.slice(0, 500)}`,
    );
  }
}
