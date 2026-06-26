import type { FlowTaskConfig } from "../schemas/config.schema.js";

export interface PlannerContextInput {
  prompt: string;
  rulesContext: string;
  projectRoot: string;
  config: FlowTaskConfig;
  availableExecutors: string[];
}

export class PlannerContextBuilder {
  build(input: PlannerContextInput): string {
    const parts: string[] = [];

    parts.push("# FlowTask Planner Context\n");
    parts.push(`## Original Prompt\n\n${input.prompt}\n`);
    parts.push(`## Rules Context\n\n${input.rulesContext}\n`);

    parts.push("## Project\n");
    parts.push(`- Root: ${input.projectRoot}\n`);

    parts.push("## Available Executors\n");
    for (const name of input.availableExecutors) {
      parts.push(`- ${name}`);
    }
    parts.push("");

    parts.push("## Expected JSON Output Schema\n");
    parts.push(`\`\`\`json
{
  "title": "Short run title",
  "summary": "One-line summary of the plan",
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description of what to do",
      "executor": "shell | opencode | claude | codex",
      "dependsOn": ["task_title_from_previous"],
      "riskLevel": "safe | risky | dangerous",
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "validation": {
        "commands": ["pnpm test"],
        "requiredFiles": ["src/file.ts"]
      }
    }
  ]
}
\`\`\`\n`);

    parts.push("## Instructions\n");
    parts.push("- Return ONLY valid JSON matching the schema above.");
    parts.push("- Do not include markdown code fences or extra text.");
    parts.push("- Break the work into logical sequential tasks.");
    parts.push("- Each task must have at least one acceptance criterion.");
    parts.push("- Dependencies reference the `title` of previous tasks.");
    parts.push("- Maximum 15 tasks per run.\n");

    return parts.join("\n");
  }
}
