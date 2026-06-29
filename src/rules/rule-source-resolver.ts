import { resolveRuleFiles } from "../utils/glob.js";
import { fileExists } from "../utils/fs.js";

export class RuleSourceResolver {
  async resolvePaths(patterns: string[], cwd: string): Promise<string[]> {
    return resolveRuleFiles(patterns, cwd);
  }

  async validatePath(filePath: string): Promise<{ valid: boolean; error?: string }> {
    const exists = await fileExists(filePath);
    if (!exists) {
      return { valid: false, error: `Rule file not found: ${filePath}` };
    }
    return { valid: true };
  }

  async scanCommonFiles(cwd: string): Promise<string[]> {
    const commonPatterns = [
      ".flowtask/rules/*.md",
      "AGENTS.md",
      "CLAUDE.md",
      ".github/copilot-instructions.md",
      "docs/agents/AI_AGENT_RULES.md",
      "docs/guides/CODE_QUALITY.md",
      "docs/guides/DEVELOPMENT.md",
      ".cursor/rules/*.mdc",
    ];
    return resolveRuleFiles(commonPatterns, cwd);
  }
}
