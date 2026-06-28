import type { Run } from "../schemas/run.schema.js";
import type { Task } from "../schemas/task.schema.js";
import type { FlowTaskEvent } from "../schemas/event.schema.js";
import { readTextFile } from "../utils/fs.js";
import path from "node:path";
import { getContextDir } from "../utils/paths.js";

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
  async generate(
    run: Run,
    tasks: Task[],
    rootPath?: string,
    events?: FlowTaskEvent[],
  ): Promise<Report> {
    const completedTasks = tasks.filter((t) => t.status === "done");
    const failedTasks = tasks.filter((t) => t.status === "failed");
    const skippedTasks = tasks.filter((t) => t.status === "skipped" || t.status === "cancelled");

    const commandsExecuted: string[] = [];
    const changedFiles: string[] = [];
    const artifacts: string[] = [];
    const validationResults: string[] = [];
    const qualityResults: string[] = [];
    let planMarkdown = "";
    const rules: string[] = [];

    for (const task of tasks) {
      if (task.validation?.commands) {
        commandsExecuted.push(...task.validation.commands);
      }
      if (task.validation?.requiredFiles) {
        changedFiles.push(...task.validation.requiredFiles);
      }
      if (task.validation?.requiredContent) {
        artifacts.push(...task.validation.requiredContent);
      }
    }

    if (rootPath) {
      try {
        const runEvents = events ?? [];
        for (const event of runEvents) {
          if (event.type === "validation_passed" && event.message) {
            validationResults.push(event.message);
          }
          if (event.type === "validation_failed" && event.message) {
            validationResults.push(`FAILED: ${event.message}`);
          }
          if (event.type === "quality_completed" && event.message) {
            qualityResults.push(event.message);
          }
          if (event.type === "quality_failed" && event.message) {
            qualityResults.push(`FAILED: ${event.message}`);
          }
        }
      } catch {
        // non-critical
      }

      try {
        const planPath = path.join(getContextDir(rootPath, run.runId), "plan.md");
        planMarkdown = await readTextFile(planPath);
      } catch {
        // plan may not exist
      }
    }

    return {
      prompt: run.title,
      rules: [...new Set(rules)],
      summary: `Run ${run.runId} completed with ${completedTasks.length}/${tasks.length} tasks done. ${failedTasks.length > 0 ? `${failedTasks.length} task(s) failed.` : ""}`,
      planMarkdown,
      completedTasks,
      failedTasks,
      skippedTasks,
      changedFiles: [...new Set(changedFiles)],
      commandsExecuted: [...new Set(commandsExecuted)],
      artifacts: [...new Set(artifacts.filter(Boolean))],
      validationResults,
      qualityResults,
      errors: failedTasks.map(
        (t) =>
          `Task failed: ${t.title}${t.validation?.commands ? ` (commands: ${t.validation.commands.join(", ")})` : ""}`,
      ),
      manualNextSteps:
        failedTasks.length > 0
          ? [
              `Review failed tasks and retry: ${failedTasks.map((t) => `flowtask retry ${t.id}`).join(", ")}`,
            ]
          : [],
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
        lines.push(`- ${task.title}${task.executor ? ` (${task.executor})` : ""}`);
      }
      lines.push("");
    }

    if (report.failedTasks.length > 0) {
      lines.push("## Failed Tasks\n");
      for (const task of report.failedTasks) {
        lines.push(`- ${task.title}${task.executor ? ` (${task.executor})` : ""}`);
      }
      lines.push("");
    }

    if (report.skippedTasks.length > 0) {
      lines.push("## Skipped Tasks\n");
      for (const task of report.skippedTasks) {
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

    if (report.commandsExecuted.length > 0) {
      lines.push("## Commands Executed\n");
      for (const cmd of report.commandsExecuted) {
        lines.push(`- \`${cmd}\``);
      }
      lines.push("");
    }

    if (report.validationResults.length > 0) {
      lines.push("## Validation Results\n");
      for (const vr of report.validationResults) {
        lines.push(`- ${vr}`);
      }
      lines.push("");
    }

    if (report.qualityResults.length > 0) {
      lines.push("## Quality Results\n");
      for (const qr of report.qualityResults) {
        lines.push(`- ${qr}`);
      }
      lines.push("");
    }

    if (report.artifacts.length > 0) {
      lines.push("## Artifacts\n");
      for (const art of report.artifacts) {
        lines.push(`- ${art}`);
      }
      lines.push("");
    }

    if (report.planMarkdown) {
      lines.push("## Plan\n\n```\n");
      lines.push(report.planMarkdown);
      lines.push("```\n");
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
