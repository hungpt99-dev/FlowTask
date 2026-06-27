import type { ValidationCheck } from "../schemas/validation.schema.js";
import { fileExists, readTextFile, fileStat } from "../utils/fs.js";
import path from "node:path";

export class ContentValidator {
  async validateContent(
    projectRoot: string,
    requiredContent: string[],
  ): Promise<ValidationCheck[]> {
    if (requiredContent.length === 0) return [];

    const checks: ValidationCheck[] = [];

    for (const filePath of requiredContent) {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
      const exists = await fileExists(fullPath);

      if (!exists) {
        checks.push({
          type: "content",
          status: "failed",
          path: filePath,
          message: `Content file not found: ${filePath}`,
          evidence: "File does not exist",
        });
        continue;
      }

      const stat = await fileStat(fullPath);
      if (stat && stat.size === 0) {
        checks.push({
          type: "content",
          status: "failed",
          path: filePath,
          message: `Content file is empty: ${filePath}`,
          evidence: "File exists but is empty",
        });
        continue;
      }

      const content = await readTextFile(fullPath).catch(() => "");
      const trimmed = content.trim();

      if (trimmed.length === 0) {
        checks.push({
          type: "content",
          status: "failed",
          path: filePath,
          message: `Content file has no meaningful content: ${filePath}`,
          evidence: "File contains only whitespace",
        });
        continue;
      }

      checks.push({
        type: "content",
        status: "passed",
        path: filePath,
        message: `Content exists in: ${filePath}`,
        evidence: `File has ${trimmed.length} characters of content`,
        details: { size: stat?.size ?? trimmed.length },
      });
    }

    return checks;
  }
}
