import type { Run } from "../schemas/run.schema.js";
import type { Task } from "../schemas/task.schema.js";

export interface Report {
  prompt: string;
  rules: string[];
  summary: string;
  planMarkdown: string;
  completedTasks: Task[];
  failedTasks: Task[];
  skippedTasks: Task[];
  changedFiles: string[];
  commandsExecuted: string[];
  artifacts: string[];
  validationResults: string[];
  qualityResults: string[];
  errors: string[];
  manualNextSteps: string[];
}

export class ReportGenerator {
  generate(run: Run, tasks: Task[]): Report {
    const completedTasks = tasks.filter((t) => t.status === "done");
    const failedTasks = tasks.filter((t) => t.status === "failed");
    const skippedTasks = tasks.filter((t) => t.status === "skipped" || t.status === "cancelled");

    return {
      prompt: run.title,
      rules: [],
      summary: `Run ${run.runId} completed with ${completedTasks.length}/${tasks.length} tasks done.`,
      planMarkdown: "",
      completedTasks,
      failedTasks,
      skippedTasks,
      changedFiles: [],
      commandsExecuted: [],
      artifacts: [],
      validationResults: [],
      qualityResults: [],
      errors: failedTasks.map((t) => `Task failed: ${t.title}`),
      manualNextSteps: [],
    };
  }

  generateMarkdown(report: Report): string {
    const lines: string[] = [];
    lines.push("# Final Report");
    lines.push("");
    lines.push(`## Prompt\n\n${report.prompt}`);
    lines.push("");
    lines.push(`## Summary\n\n${report.summary}`);
    lines.push("");

    if (report.completedTasks.length > 0) {
      lines.push("## Completed Tasks\n");
      for (const task of report.completedTasks) {
        lines.push(`- ${task.title}`);
      }
      lines.push("");
    }

    if (report.failedTasks.length > 0) {
      lines.push("## Failed Tasks\n");
      for (const task of report.failedTasks) {
        lines.push(`- ${task.title}`);
      }
      lines.push("");
    }

    if (report.changedFiles.length > 0) {
      lines.push("## Changed Files\n");
      for (const file of report.changedFiles) {
        lines.push(`- ${file}`);
      }
      lines.push("");
    }

    if (report.errors.length > 0) {
      lines.push("## Errors\n");
      for (const err of report.errors) {
        lines.push(`- ${err}`);
      }
      lines.push("");
    }

    if (report.manualNextSteps.length > 0) {
      lines.push("## Manual Next Steps\n");
      for (const step of report.manualNextSteps) {
        lines.push(`- ${step}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
