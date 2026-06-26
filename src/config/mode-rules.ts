import type { ProjectMode } from "./project-modes.js";

export function generateModeRules(mode: ProjectMode): string {
  switch (mode) {
    case "development":
      return `# Development Mode Rules

This project is in **development** mode.

## Behavior
- Inspect the project before editing.
- Make focused, small code changes.
- Follow existing code style and project conventions.
- Do not make unrelated changes.
- Validate with lint/typecheck/test when configured.
- Do not claim success without evidence.
- Risky actions (install dependency, delete files, git push) require approval.

## Validation
- Code validation is enabled by default.
- Run configured quality commands when available.
- Validation runs serially and safely by default.
- Avoid spawning many test workers at once.
- Use narrow, focused test commands when possible.
- Do not run expensive full test suites repeatedly.
- Git diff may be required for changes.
`;
    case "writing":
      return `# Writing Mode Rules

This project is in **writing** mode.

## Behavior
- Focus on clarity, structure, audience, and completeness.
- Understand the audience and goal before writing.
- Create an outline before drafting.
- Revise for clarity and completeness.
- Do not assume the task is about code.
- Do not run developer validation commands by default.

## Validation
- Document validation is enabled by default.
- Check that the final document exists and is non-empty.
- Do not run lint/typecheck/test unless explicitly requested.
`;
    case "research":
      return `# Research Mode Rules

This project is in **research** mode.

## Behavior
- Define the research question before collecting information.
- Collect source notes as you research.
- Separate facts, assumptions, and opinions clearly.
- Compare findings from different sources.
- Do not invent facts.
- Track source quality.
- Mention uncertainty when evidence is weak.

## Validation
- Research validation is enabled by default.
- Check for source notes and research brief artifacts.
- Require source references when configured.
- Do not require git diff by default.
`;
    case "general":
      return `# General Mode Rules

This project is in **general** mode.

## Behavior
- Clarify the objective before starting work.
- Break work into visible, sequential tasks.
- Produce useful artifacts for each task.
- Validate completion with evidence.
- Avoid developer-specific assumptions unless the prompt is clearly about code.

## Validation
- Manual/basic artifact validation is enabled by default.
- Check the final report and configured artifacts.
- Do not run developer validation commands by default.
`;
  }
}
