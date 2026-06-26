import type { ValidationCheck } from "../schemas/validation.schema.js";
import { fileExists } from "../utils/fs.js";
import path from "node:path";

export class FileValidator {
  async validateFiles(projectRoot: string, requiredFiles: string[]): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];
    for (const filePath of requiredFiles) {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
      const exists = await fileExists(fullPath);
      checks.push({
        type: "file",
        status: exists ? "passed" : "failed",
        path: filePath,
        message: exists ? `File exists: ${filePath}` : `File not found: ${filePath}`,
      });
    }
    return checks;
  }
}
