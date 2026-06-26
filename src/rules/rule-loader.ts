import type { LoadedRule, RuleConfig } from "../schemas/rule.schema.js";
import { resolveRuleFiles } from "../utils/glob.js";
import { readTextFile } from "../utils/fs.js";

export class RuleLoader {
  async loadRules(projectRoot: string, config: RuleConfig): Promise<LoadedRule[]> {
    if (!config.enabled) return [];
    const files = await resolveRuleFiles(config.paths, projectRoot);
    const rules: LoadedRule[] = [];
    const maxBytes = config.maxFileSizeKb * 1024;
    for (const filePath of files) {
      try {
        const content = await readTextFile(filePath);
        const sizeBytes = Buffer.byteLength(content, "utf-8");
        if (sizeBytes > maxBytes) continue;
        rules.push({
          sourcePath: filePath,
          content,
          sizeBytes,
        });
      } catch {
        if (config.required) {
          throw new Error(`Required rule file not readable: ${filePath}`);
        }
      }
    }
    return rules;
  }

  mergeRules(rules: LoadedRule[]): string {
    const parts: string[] = [];
    for (const rule of rules) {
      parts.push(`## Source: ${rule.sourcePath}\n`);
      parts.push(rule.content);
      parts.push("");
    }
    return parts.join("\n");
  }
}
