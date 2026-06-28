import type { Task } from "../schemas/task.schema.js";
import type { Run } from "../schemas/run.schema.js";

export interface ContextPack {
  markdown: string;
}

export interface ContextPackInput {
  prompt: string;
  rulesContext: string;
  run: Run;
  task: Task;
  completedTasks: Task[];
  errorLog?: string;
  isRetry: boolean;
}

export class ContextPackBuilder {
  build(input: ContextPackInput): ContextPack {
    const parts: string[] = [];

    parts.push("# FlowTask Context Pack\n");

    if (input.isRetry && input.errorLog) {
      parts.push("## Retry Context\n");
      parts.push(`This is a retry attempt for task: ${input.task.title}\n`);
      parts.push("### Previous Error\n");
      parts.push(`\`\`\`\n${input.errorLog}\n\`\`\`\n`);
    }

    parts.push("## Original User Prompt\n");
    parts.push(`${input.prompt}\n`);

    parts.push("## Current Task\n");
    parts.push(`### ${input.task.title}\n`);
    if (input.task.description) {
      parts.push(`${input.task.description}\n`);
    }

    parts.push("## Project Rules\n");
    parts.push(`${input.rulesContext}\n`);

    if (input.completedTasks.length > 0) {
      parts.push("## Previous Completed Tasks\n");
      for (const t of input.completedTasks) {
        parts.push(`- ${t.title} (${t.status})`);
      }
      parts.push("");
    }

    if (input.task.acceptanceCriteria.length > 0) {
      parts.push("## Acceptance Criteria\n");
      for (const criteria of input.task.acceptanceCriteria) {
        parts.push(`- ${criteria}`);
      }
      parts.push("");
    }

    if (input.task.validation?.commands && input.task.validation.commands.length > 0) {
      parts.push("## Validation Commands\n");
      for (const cmd of input.task.validation.commands) {
        parts.push(`\`\`\`bash\n${cmd}\n\`\`\``);
      }
      parts.push("");
    }

    if (input.task.outputPlan && input.task.outputPlan.length > 0) {
      parts.push("## Expected Outputs\n");
      for (const output of input.task.outputPlan) {
        const actionLabel =
          output.action === "create" ? "Create" : output.action === "modify" ? "Modify" : "Delete";
        parts.push(`- **${actionLabel}** \`${output.target}\``);
        if (output.description) {
          parts.push(`  - ${output.description}`);
        }
        parts.push(`  - Validation: ${output.validationMethod}`);
        parts.push("");
      }
      parts.push("");
    }

    parts.push("## Instructions\n");
    parts.push("- Work only on this task.");
    parts.push("- Do not rewrite unrelated files.");
    parts.push("- Do not mark the task complete unless acceptance criteria are satisfied.");
    parts.push("- Return a short completion summary.\n");

    return { markdown: parts.join("\n") };
  }
}
