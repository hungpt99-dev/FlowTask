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

    parts.push("## Role\n");
    parts.push("You are the FlowTask AI planner.\n");
    parts.push("Your **only** job is to create a JSON task plan.\n");

    parts.push("## Critical Role Separation\n");
    parts.push("Important role separation:\n");
    parts.push("- Planner creates a JSON task plan only.\n");
    parts.push("- Planner does **not** implement the user request.\n");
    parts.push("- Planner does **not** edit files.\n");
    parts.push("- Planner does **not** write README content or any other file content.\n");
    parts.push("- Planner does **not** solve the task.\n");
    parts.push("- Planner does **not** write code.\n");
    parts.push("- Planner does **not** write documentation content.\n");
    parts.push("- Planner **only** returns tasks that FlowTask will execute later.\n");

    parts.push("## JSON-Only Response Requirement\n");
    parts.push("You must return **ONLY** valid JSON.\n");
    parts.push("Return ONLY valid JSON.\n");
    parts.push("Do not write markdown.\n");
    parts.push("Do not write explanation.\n");
    parts.push("Do not wrap JSON in ```json or ```.\n");
    parts.push("Do not include comments.\n");
    parts.push("Do not include trailing commas.\n");
    parts.push("Do not include prose before or after JSON.\n");
    parts.push("The first character of your response MUST be `{`.\n");
    parts.push("The last character of your response MUST be `}`.\n");
    parts.push("No text. No code fences. No explanation. ONLY `{...}`.\n");

    parts.push("\n## Role Reminder: You Are a Planner, Not an Executor\n");
    parts.push('If the user asks to "update README", you must NOT write the README content.\n');
    parts.push("You must NOT write any file content.\n");
    parts.push("You must create a JSON task plan for the executor to follow.\n");
    parts.push("The executor will write files. The planner only returns tasks.\n");

    parts.push(`## Original Prompt\n\n${input.prompt}\n`);
    parts.push(`## Rules Context\n\n${input.rulesContext}\n`);

    parts.push("## Project\n");
    parts.push(`- Root: ${input.projectRoot}\n`);

    const projectMode = input.config.projectMode ?? "development";
    parts.push("## Project Mode\n");
    parts.push(`This project is in **${projectMode}** mode.\n`);
    parts.push(getModeContextHint(projectMode));
    parts.push("\n");

    parts.push("## Available Executors\n");
    parts.push(
      `Valid executors: ${input.availableExecutors.join(", ")}, plus shell, manual, opencode.\n`,
    );
    parts.push("The `executor` field in each task must be one of these.\n");

    parts.push("## Expected JSON Output Schema\n");
    parts.push("```json\n");
    parts.push(`{
  "title": "Short run title",
  "summary": "One-line summary of the plan",
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description of what to do",
      "executor": "shell",
      "dependsOn": ["Exact title of previous task"],
      "riskLevel": "safe",
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "validation": {
        "commands": ["pnpm test"],
        "requiredFiles": ["src/generated/output.ts"],
        "requiredArtifacts": [],
        "requireGitDiff": false
      }
    }
  ]
}\n`);
    parts.push("```\n");

    parts.push("## Task Generation Instructions\n");
    parts.push("- Break the work into logical sequential tasks.\n");
    parts.push("- Each task must have at least one acceptance criterion.\n");
    parts.push("- Dependencies reference the exact `title` of previous tasks.\n");
    parts.push("- Maximum 15 tasks per run.\n");
    parts.push(
      '- If the user asks to "update README", create a task plan for updating README — do NOT write the README content.\n',
    );
    parts.push(
      '- Choose `executor` based on what the task needs: "shell" for read-only/file operations, "opencode" or other AI executors for creative work.\n',
    );

    parts.push("\n## Final Reminder — Read Carefully\n");
    parts.push("Return ONLY valid JSON.\n");
    parts.push("Do not write markdown.\n");
    parts.push("Do not write explanation.\n");
    parts.push("Do not wrap JSON in ```json.\n");
    parts.push("Do not include comments.\n");
    parts.push("Do not include trailing commas.\n");
    parts.push("Do not include prose before or after JSON.\n");
    parts.push("The first character of your response MUST be `{`.\n");
    parts.push("The last character of your response MUST be `}`.\n");
    parts.push(
      "If your output does not start with `{` and end with `}`, FlowTask will reject it.\n",
    );

    return parts.join("\n");
  }
}

function getModeContextHint(mode: string): string {
  switch (mode) {
    case "development":
      return "This is a software development project. Coding assumptions are allowed. Use development validation (lint, typecheck, test) when configured.";
    case "writing":
      return "This is a writing/document project. Do NOT assume this is a software development task unless the user explicitly asks for code. Focus on document structure, clarity, and completeness.";
    case "research":
      return "This is a research project. Do NOT invent facts. Separate facts from assumptions. Track sources. Do NOT assume this is a software development task.";
    case "general":
      return "This is a general AI task workflow. Avoid developer-specific assumptions unless the prompt is clearly about code. Focus on producing useful artifacts.";
    default:
      return "";
  }
}
