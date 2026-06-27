import type { ValidationCheck } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import { fileExists, readTextFile } from "../utils/fs.js";
import path from "node:path";

const FILE_KEYWORDS = /\b(report|document|file|output|artifact|result)\b/i;
const TEST_KEYWORDS = /\b(test|validation|lint|typecheck|quality)\b/i;
const PASS_KEYWORDS = /\b(pass|succeed|complete|done|finish)\b/i;
const OUTPUT_PATH_PATTERN = /[`"']?([\w./-]+\.\w+)[`"']?/g;

export class AcceptanceCriteriaValidator {
  async validate(
    criteria: string[],
    executorResult: ExecutorResult,
    projectRoot: string,
  ): Promise<ValidationCheck[]> {
    if (criteria.length === 0) return [];

    const output = executorResult.output ?? "";
    const processPassed = executorResult.exitCode === 0;
    const checks: ValidationCheck[] = [];

    for (const criterion of criteria) {
      const criterionLower = criterion.toLowerCase();
      const evidence: string[] = [];

      const textMatch = output.toLowerCase().includes(criterionLower);
      if (textMatch) {
        evidence.push("Mentioned in executor output");
      }

      if (FILE_KEYWORDS.test(criterion)) {
        const filePaths = this.extractFilePaths(criterion);
        if (filePaths.length > 0) {
          const existingFiles = await this.checkFileEvidence(filePaths, projectRoot, output);
          evidence.push(...existingFiles);
        } else if (processPassed) {
          evidence.push("Process completed, file-related criterion likely met");
        }
      }

      if (TEST_KEYWORDS.test(criterion)) {
        if (processPassed) {
          evidence.push("Process completed successfully");
        }
      }

      if (PASS_KEYWORDS.test(criterion) && processPassed) {
        evidence.push("Process completed successfully");
      }

      const criteriaEvidence =
        evidence.length > 0
          ? evidence.join("; ")
          : "No automated evidence found — manual verification recommended";

      const isMet = evidence.some(
        (e) =>
          e.startsWith("Mentioned in") ||
          e.includes("exists") ||
          e.includes("completed successfully"),
      );

      checks.push({
        type: "acceptance_criteria",
        status: isMet ? "passed" : "warning",
        criteria: criterion,
        evidence: criteriaEvidence,
        message: isMet
          ? `Acceptance criterion met: ${criterion}`
          : `Acceptance criterion unverifiable: ${criterion}`,
      });
    }

    return checks;
  }

  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];
    let match: RegExpExecArray | null;
    const cloned = new RegExp(OUTPUT_PATH_PATTERN.source, OUTPUT_PATH_PATTERN.flags);
    while ((match = cloned.exec(text)) !== null) {
      const p = match[1]!;
      if (/\.\w{1,6}$/.test(p) && !p.startsWith("http")) {
        paths.push(p);
      }
    }
    return paths;
  }

  private async checkFileEvidence(
    filePaths: string[],
    projectRoot: string,
    output: string,
  ): Promise<string[]> {
    const evidence: string[] = [];

    for (const fp of filePaths) {
      const fullPath = path.isAbsolute(fp) ? fp : path.join(projectRoot, fp);
      const exists = await fileExists(fullPath);
      if (exists) {
        const content = await readTextFile(fullPath).catch(() => "");
        if (content.trim().length > 0) {
          evidence.push(`File exists with content: ${fp}`);
        } else {
          evidence.push(`File exists (empty): ${fp}`);
        }
      }
    }

    const outputPaths: string[] = [];
    const outputClone = new RegExp(OUTPUT_PATH_PATTERN.source, OUTPUT_PATH_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = outputClone.exec(output)) !== null) {
      const p = match[1]!;
      if (/\.\w{1,6}$/.test(p) && !p.startsWith("http")) {
        outputPaths.push(p);
      }
    }

    for (const fp of outputPaths) {
      const fullPath = path.isAbsolute(fp) ? fp : path.join(projectRoot, fp);
      const exists = await fileExists(fullPath);
      if (exists) {
        evidence.push(`Referenced file exists: ${fp}`);
      }
    }

    return evidence;
  }
}
