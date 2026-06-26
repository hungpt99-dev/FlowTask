import type { ProjectMode } from "./project-modes.js";

export function generateModeSteps(mode: ProjectMode): string {
  switch (mode) {
    case "development":
      return `# Development Mode Steps

1. Understand request - Clarify the objective, requirements, and constraints.
2. Inspect project - Read relevant files, understand current structure and patterns.
3. Implement change - Make focused code changes following project conventions.
4. Run validation - Run configured quality commands and verify changes.
5. Final report - Summarize what was done and the results.
`;
    case "writing":
      return `# Writing Mode Steps

1. Understand goal and audience - Define the purpose, audience, and key message.
2. Outline - Create a structured outline before writing.
3. Draft - Write the first draft following the outline.
4. Revise - Review and refine for clarity, structure, and completeness.
5. Final document - Produce the final polished document.
6. Final report - Summarize what was created.
`;
    case "research":
      return `# Research Mode Steps

1. Define research question - Clarify what we need to learn and why.
2. Collect source notes - Gather information from available sources.
3. Compare findings - Analyze and compare information from different sources.
4. Research brief - Produce a structured research brief with findings.
5. Final report - Summarize the research process and conclusions.
`;
    case "general":
      return `# General Mode Steps

1. Understand objective - Clarify what needs to be accomplished.
2. Plan - Break the work into clear, actionable tasks.
3. Execute - Complete each task, producing visible artifacts.
4. Result artifact - Produce the final deliverable.
5. Final report - Summarize what was done and the outcomes.
`;
  }
}
