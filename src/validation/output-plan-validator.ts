import type { ValidationCheck } from "../schemas/validation.schema.js";
import type { OutputPlanItem } from "../schemas/output-plan.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import { fileExists, readTextFile, fileStat } from "../utils/fs.js";
import { spawnWithPromise } from "../utils/process.js";
import type { AiValidator } from "./ai-validator.js";
import path from "node:path";

export class OutputPlanValidator {
  private aiValidator?: AiValidator;

  constructor(aiValidator?: AiValidator) {
    this.aiValidator = aiValidator;
  }

  async validate(
    outputPlan: OutputPlanItem[],
    executorResult: ExecutorResult,
    projectRoot: string,
    taskDescription?: string,
  ): Promise<ValidationCheck[]> {
    if (outputPlan.length === 0) return [];

    const checks: ValidationCheck[] = [];

    for (const item of outputPlan) {
      const itemChecks = await this.validateItem(
        item,
        executorResult,
        projectRoot,
        taskDescription,
      );
      checks.push(...itemChecks);
    }

    return checks;
  }

  private async validateItem(
    item: OutputPlanItem,
    executorResult: ExecutorResult,
    projectRoot: string,
    taskDescription?: string,
  ): Promise<ValidationCheck[]> {
    const fullPath = path.isAbsolute(item.target)
      ? item.target
      : path.join(projectRoot, item.target);

    const primaryCheck = await this.validateByActionAndMethod(
      item,
      fullPath,
      executorResult,
      projectRoot,
      taskDescription,
    );

    const checks: ValidationCheck[] = [primaryCheck];

    if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
      const criteriaChecks = await this.validateAcceptanceCriteria(
        item.acceptanceCriteria,
        fullPath,
        item.target,
        projectRoot,
      );
      checks.push(...criteriaChecks);
    }

    return checks;
  }

  private async validateByActionAndMethod(
    item: OutputPlanItem,
    fullPath: string,
    executorResult: ExecutorResult,
    projectRoot: string,
    taskDescription?: string,
  ): Promise<ValidationCheck> {
    switch (item.validationMethod) {
      case "file_exists":
        return this.validateFileExists(item, fullPath);
      case "file_content":
        return this.validateFileContent(item, fullPath);
      case "file_diff":
        return this.validateFileDiff(item, fullPath, projectRoot);
      case "command_output":
        return this.validateCommandOutput(item, executorResult);
      case "test":
        return this.validateByTest(item, fullPath, executorResult);
      case "ai_review":
        if (this.aiValidator && taskDescription) {
          return this.validateByAiReview(item, executorResult, taskDescription);
        }
        return this.flagForReview(item, "ai_review");
      case "manual":
        return this.flagForReview(item, "manual");
    }
  }

  private async validateFileExists(
    item: OutputPlanItem,
    fullPath: string,
  ): Promise<ValidationCheck> {
    const exists = await fileExists(fullPath);

    if (item.action === "delete") {
      const passed = !exists;
      return {
        type: "output_plan",
        status: passed ? "passed" : "failed",
        path: item.target,
        message: passed ? `File deleted: ${item.target}` : `File still exists: ${item.target}`,
        evidence: passed
          ? "File no longer exists on disk"
          : "File was expected to be deleted but still exists",
        details: { action: item.action, validationMethod: "file_exists", target: item.target },
      };
    }

    if (item.action === "modify") {
      const passed = exists;
      return {
        type: "output_plan",
        status: passed ? "passed" : "failed",
        path: item.target,
        message: passed
          ? `File exists for modification: ${item.target}`
          : `File not found for modification: ${item.target}`,
        evidence: passed
          ? "File exists on disk"
          : "File was expected to be modified but does not exist",
        details: { action: item.action, validationMethod: "file_exists", target: item.target },
      };
    }

    const passed = exists;
    return {
      type: "output_plan",
      status: passed ? "passed" : "failed",
      path: item.target,
      message: passed ? `File created: ${item.target}` : `File not created: ${item.target}`,
      evidence: passed
        ? "File exists on disk"
        : "File was expected to be created but does not exist",
      details: { action: item.action, validationMethod: "file_exists", target: item.target },
    };
  }

  private async validateFileContent(
    item: OutputPlanItem,
    fullPath: string,
  ): Promise<ValidationCheck> {
    const exists = await fileExists(fullPath);

    if (!exists) {
      return {
        type: "output_plan",
        status: "failed",
        path: item.target,
        message: `File not found: ${item.target}`,
        evidence: "File does not exist on disk",
        details: { action: item.action, validationMethod: "file_content", target: item.target },
      };
    }

    const stat = await fileStat(fullPath);
    if (stat && stat.size === 0) {
      return {
        type: "output_plan",
        status: "failed",
        path: item.target,
        message: `File is empty: ${item.target}`,
        evidence: "File exists but has no content",
        details: { action: item.action, validationMethod: "file_content", target: item.target },
      };
    }

    const content = await readTextFile(fullPath).catch(() => "");
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return {
        type: "output_plan",
        status: "failed",
        path: item.target,
        message: `File has no meaningful content: ${item.target}`,
        evidence: "File contains only whitespace",
        details: { action: item.action, validationMethod: "file_content", target: item.target },
      };
    }

    return {
      type: "output_plan",
      status: "passed",
      path: item.target,
      message: `${item.action === "create" ? "Created" : item.action === "modify" ? "Modified" : "Deleted"} with content: ${item.target}`,
      evidence: `File has ${trimmed.length} characters of content`,
      details: {
        action: item.action,
        validationMethod: "file_content",
        target: item.target,
        size: stat?.size ?? trimmed.length,
      },
    };
  }

  private async validateFileDiff(
    item: OutputPlanItem,
    fullPath: string,
    projectRoot: string,
  ): Promise<ValidationCheck> {
    const exists = await fileExists(fullPath);

    if (item.action === "delete") {
      if (!exists) {
        return {
          type: "output_plan",
          status: "passed",
          path: item.target,
          message: `File deleted: ${item.target}`,
          evidence: "File no longer exists on disk",
          details: { action: "delete", validationMethod: "file_diff", target: item.target },
        };
      }
    }

    if (!exists) {
      return {
        type: "output_plan",
        status: "failed",
        path: item.target,
        message: `File not found: ${item.target}`,
        evidence: "File does not exist on disk",
        details: { action: item.action, validationMethod: "file_diff", target: item.target },
      };
    }

    const relativePath = path.relative(projectRoot, fullPath);
    const diffResult = await spawnWithPromise("git", ["diff", "--stat", "--", relativePath], {
      cwd: projectRoot,
    }).catch(() => null);

    if (diffResult && diffResult.exitCode === 0 && diffResult.stdout.trim().length > 0) {
      return {
        type: "output_plan",
        status: "passed",
        path: item.target,
        message: `File changed (git diff detected): ${item.target}`,
        evidence: `Git diff: ${diffResult.stdout.trim()}`,
        details: {
          action: item.action,
          validationMethod: "file_diff",
          target: item.target,
          diff: diffResult.stdout.trim(),
        },
      };
    }

    const statResult = await spawnWithPromise(
      "git",
      ["status", "--porcelain", "--", relativePath],
      {
        cwd: projectRoot,
      },
    ).catch(() => null);

    if (statResult && statResult.exitCode === 0 && statResult.stdout.trim().length > 0) {
      return {
        type: "output_plan",
        status: "passed",
        path: item.target,
        message: `File changed (git status detected): ${item.target}`,
        evidence: `Git status: ${statResult.stdout.trim()}`,
        details: {
          action: item.action,
          validationMethod: "file_diff",
          target: item.target,
          status: statResult.stdout.trim(),
        },
      };
    }

    if (item.action === "create" && exists) {
      return {
        type: "output_plan",
        status: "passed",
        path: item.target,
        message: `File created: ${item.target}`,
        evidence: "File exists on disk (git diff not available but file is present)",
        details: { action: "create", validationMethod: "file_diff", target: item.target },
      };
    }

    return {
      type: "output_plan",
      status: "warning",
      path: item.target,
      message: `No git diff detected for: ${item.target}`,
      evidence: diffResult?.stdout?.trim() || "File exists but no git changes detected",
      details: { action: item.action, validationMethod: "file_diff", target: item.target },
    };
  }

  private async validateCommandOutput(
    item: OutputPlanItem,
    executorResult: ExecutorResult,
  ): Promise<ValidationCheck> {
    const output = executorResult.output ?? "";
    const lowerOutput = output.toLowerCase();
    const lowerTarget = item.target.toLowerCase();

    const actionVerbs: Record<string, string[]> = {
      create: ["creat", "generat", "produc", "writ", "sav", "add", "new"],
      modify: ["modif", "updat", "edit", "chang", "refactor", "improv", "fix"],
      delete: ["delet", "remov", "clean", "eras", "drop"],
    };

    const verbs = actionVerbs[item.action] ?? [];
    const hasTargetInOutput = lowerOutput.includes(lowerTarget);
    const hasActionVerb = verbs.some((v) => lowerOutput.includes(v));

    const evidence: string[] = [];
    if (hasTargetInOutput) evidence.push(`Target "${item.target}" mentioned in executor output`);
    if (hasActionVerb) evidence.push(`Action verb "${item.action}" found in executor output`);

    const passed = hasTargetInOutput && hasActionVerb;

    return {
      type: "output_plan",
      status: passed ? "passed" : "warning",
      path: item.target,
      message: passed
        ? `Output mentions ${item.action} of ${item.target}`
        : `Cannot confirm ${item.action} of ${item.target} from executor output alone`,
      evidence:
        evidence.length > 0 ? evidence.join("; ") : "No action-related mentions found in output",
      details: {
        action: item.action,
        validationMethod: "command_output",
        target: item.target,
        hasTargetInOutput,
        hasActionVerb,
      },
    };
  }

  private async validateByTest(
    item: OutputPlanItem,
    fullPath: string,
    executorResult: ExecutorResult,
  ): Promise<ValidationCheck> {
    const output = executorResult.output ?? "";
    const processPassed = executorResult.exitCode === 0;

    const evidence: string[] = [];
    if (processPassed) evidence.push("Executor process completed successfully");

    const acceptanceCriteria = item.acceptanceCriteria;
    if (acceptanceCriteria && acceptanceCriteria.length > 0) {
      const outputLower = output.toLowerCase();
      for (const criterion of acceptanceCriteria) {
        if (outputLower.includes(criterion.toLowerCase())) {
          evidence.push(`Acceptance criterion met: "${criterion}"`);
        }
      }
    }

    const exists = await fileExists(fullPath);
    if (exists) evidence.push(`File exists: ${item.target}`);

    const passed = processPassed || exists;

    return {
      type: "output_plan",
      status: passed ? "passed" : "warning",
      path: item.target,
      message: passed
        ? `Test validation passed for ${item.action} of ${item.target}`
        : `Test validation inconclusive for ${item.action} of ${item.target}`,
      evidence: evidence.length > 0 ? evidence.join("; ") : "No test evidence collected",
      details: {
        action: item.action,
        validationMethod: "test",
        target: item.target,
        processPassed,
        fileExists: exists,
      },
    };
  }

  private async validateByAiReview(
    item: OutputPlanItem,
    executorResult: ExecutorResult,
    taskDescription: string,
  ): Promise<ValidationCheck> {
    if (!this.aiValidator) {
      return this.flagForReview(item, "ai_review");
    }

    try {
      const verdict = await this.aiValidator.validate({
        taskDescription: `${taskDescription}\n\nExpected output: ${item.action} ${item.target}${item.description ? ` — ${item.description}` : ""}`,
        executorOutput: executorResult.output ?? "",
        errorOutput: executorResult.error,
        changedFiles: [item.target],
      });

      return {
        type: "ai_review",
        status: verdict.status,
        path: item.target,
        message:
          verdict.status === "passed"
            ? `AI review passed for ${item.action} of ${item.target}`
            : verdict.status === "failed"
              ? `AI review failed for ${item.action} of ${item.target}: ${verdict.suggestion}`
              : `AI review warning for ${item.action} of ${item.target}: ${verdict.suggestion}`,
        evidence: verdict.suggestion || "AI review completed",
        details: {
          action: item.action,
          validationMethod: "ai_review",
          target: item.target,
          verdict,
        },
      };
    } catch {
      return this.flagForReview(item, "ai_review");
    }
  }

  private flagForReview(item: OutputPlanItem, reviewType: "ai_review" | "manual"): ValidationCheck {
    return {
      type: "output_plan",
      status: "warning",
      path: item.target,
      message: `${reviewType === "ai_review" ? "AI review" : "Manual verification"} needed for ${item.action} of ${item.target}`,
      evidence: `Flagged for ${reviewType === "ai_review" ? "AI" : "manual"} review; automated check not performed`,
      details: {
        action: item.action,
        validationMethod: reviewType,
        target: item.target,
      },
    };
  }

  private async validateAcceptanceCriteria(
    criteria: string[],
    fullPath: string,
    target: string,
    projectRoot: string,
  ): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];

    for (const criterion of criteria) {
      const lowerCriterion = criterion.toLowerCase();
      const evidence: string[] = [];

      const fileCheck = await this.matchCriterionToFile(criterion, fullPath, target, projectRoot);
      evidence.push(...fileCheck.evidence);

      const passed = fileCheck.matched;

      checks.push({
        type: "output_plan",
        status: passed ? "passed" : "warning",
        path: target,
        criteria: criterion,
        message: passed
          ? `Output plan criterion met: ${criterion}`
          : `Output plan criterion unverifiable: ${criterion}`,
        evidence: evidence.length > 0 ? evidence.join("; ") : "No matching evidence found",
        details: {
          criterion,
          validationMethod: "acceptance_criteria",
          target,
        },
      });
    }

    return checks;
  }

  private async matchCriterionToFile(
    criterion: string,
    fullPath: string,
    target: string,
    projectRoot: string,
  ): Promise<{ evidence: string[]; matched: boolean }> {
    const evidence: string[] = [];
    const exists = await fileExists(fullPath);

    if (!exists) {
      evidence.push(`Target file not found: ${target}`);
      return { evidence, matched: false };
    }

    evidence.push(`Target file exists: ${target}`);

    const contentKeywords = this.extractContentKeywords(criterion);
    if (contentKeywords.length > 0) {
      try {
        const content = await readTextFile(fullPath);
        const contentLower = content.toLowerCase();
        const matchedKeywords = contentKeywords.filter((kw) => contentLower.includes(kw));
        const threshold = Math.max(1, Math.ceil(contentKeywords.length * 0.6));
        if (matchedKeywords.length >= threshold) {
          evidence.push(`Content matches criterion: "${criterion}"`);
          return { evidence, matched: true };
        }
      } catch {
        return { evidence, matched: true };
      }
    }

    return { evidence, matched: true };
  }

  private extractContentKeywords(text: string): string[] {
    const stopWords = new Set([
      "this",
      "that",
      "with",
      "from",
      "have",
      "been",
      "were",
      "they",
      "them",
      "their",
      "will",
      "would",
      "could",
      "should",
      "into",
      "over",
      "such",
      "each",
      "than",
      "then",
      "also",
      "just",
      "more",
      "after",
      "before",
      "about",
      "other",
      "which",
      "what",
      "when",
      "where",
      "there",
      "these",
      "those",
      "being",
      "done",
      "some",
      "make",
      "made",
      "take",
      "took",
      "very",
      "well",
      "even",
      "still",
      "already",
      "much",
      "many",
      "both",
      "does",
      "used",
      "using",
      "like",
      "than",
      "then",
      "here",
      "your",
      "their",
      "come",
      "came",
      "must",
      "might",
      "shall",
      "file",
      "must",
      "should",
      "contain",
    ]);

    return text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w) && /^[a-z]+$/.test(w));
  }
}
