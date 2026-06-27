import type { UseCaseType, TaskTemplate } from "./usecase-types.js";

const CODING_TEMPLATE: TaskTemplate = {
  useCase: "coding",
  title: "Coding Task",
  description: "Software development task — implement, refactor, or build code",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files and conventions.",
      executor: "shell",
      acceptanceCriteria: ["Project rules are loaded and understood"],
    },
    {
      title: "Understand requirements",
      description: "Analyze the user prompt and identify key requirements and acceptance criteria.",
      executor: "shell",
      acceptanceCriteria: ["Requirements are clearly documented"],
    },
    {
      title: "Inspect project structure",
      description: "Examine project structure, existing code, dependencies, and configuration.",
      executor: "shell",
      acceptanceCriteria: ["Project structure and key files are documented"],
    },
    {
      title: "Design solution approach",
      description:
        "Design the solution, define types, interfaces, and identify files to create or modify.",
      executor: "shell",
      acceptanceCriteria: ["Solution design is documented with file list and approach"],
    },
    {
      title: "Implement code changes",
      description:
        "Write the implementation code following project conventions and best practices.",
      executor: "shell",
      acceptanceCriteria: [
        "Implementation files are created or modified",
        "Code follows project conventions",
      ],
    },
    {
      title: "Add tests",
      description: "Write unit tests and/or integration tests for the new implementation.",
      executor: "shell",
      acceptanceCriteria: ["Tests cover the new implementation"],
    },
    {
      title: "Run validation",
      description: "Execute type checking, linting, and tests to verify the implementation.",
      executor: "shell",
      acceptanceCriteria: ["Type check passes", "Lint passes", "Tests pass"],
    },
    {
      title: "Generate final report",
      description: "Document what was done, what changed, and any next steps.",
      executor: "shell",
      acceptanceCriteria: ["Final report is generated and saved"],
    },
  ],
};

const DOCUMENTATION_TEMPLATE: TaskTemplate = {
  useCase: "documentation",
  title: "Documentation Task",
  description: "Writing and updating documentation",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files and documentation standards.",
      executor: "shell",
      acceptanceCriteria: ["Documentation standards are understood"],
    },
    {
      title: "Understand requirements",
      description: "Analyze what documentation is needed and who the audience is.",
      executor: "shell",
      acceptanceCriteria: ["Documentation scope and audience are defined"],
    },
    {
      title: "Review existing documentation",
      description: "Examine existing documentation to understand current state and gaps.",
      executor: "shell",
      acceptanceCriteria: ["Existing documentation gaps are identified"],
    },
    {
      title: "Create documentation outline",
      description: "Structure the documentation with clear sections and flow.",
      executor: "shell",
      acceptanceCriteria: ["Documentation outline is created and reviewed"],
    },
    {
      title: "Write documentation",
      description: "Write the documentation content following project standards.",
      executor: "shell",
      acceptanceCriteria: ["Documentation content is complete"],
    },
    {
      title: "Review and finalize",
      description: "Review documentation for clarity, accuracy, and completeness.",
      executor: "shell",
      acceptanceCriteria: ["Documentation is reviewed and finalized"],
    },
  ],
};

const DEBUGGING_TEMPLATE: TaskTemplate = {
  useCase: "debugging",
  title: "Debugging Task",
  description: "Investigating and fixing bugs or errors",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files.",
      executor: "shell",
      acceptanceCriteria: ["Project rules are loaded"],
    },
    {
      title: "Understand the error",
      description: "Analyze the error message, stack trace, or unexpected behavior.",
      executor: "shell",
      acceptanceCriteria: ["Error or bug is clearly documented"],
    },
    {
      title: "Inspect relevant code",
      description: "Examine the code related to the error to understand the context.",
      executor: "shell",
      acceptanceCriteria: ["Relevant code areas are identified"],
    },
    {
      title: "Identify root cause",
      description: "Find the root cause of the issue through analysis and investigation.",
      executor: "shell",
      acceptanceCriteria: ["Root cause is identified and documented"],
    },
    {
      title: "Implement fix",
      description: "Apply the fix for the identified root cause.",
      executor: "shell",
      acceptanceCriteria: ["Fix is applied correctly"],
    },
    {
      title: "Verify fix",
      description: "Run tests and validation to confirm the fix works and nothing is broken.",
      executor: "shell",
      acceptanceCriteria: ["Tests pass after fix", "No regressions introduced"],
    },
    {
      title: "Generate report",
      description: "Document what was fixed, root cause, and verification results.",
      executor: "shell",
      acceptanceCriteria: ["Debugging report is saved"],
    },
  ],
};

const RESEARCH_TEMPLATE: TaskTemplate = {
  useCase: "research",
  title: "Research Task",
  description: "Investigating options, gathering information, and analyzing findings",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files.",
      executor: "shell",
      acceptanceCriteria: ["Project rules are loaded"],
    },
    {
      title: "Define research questions",
      description: "Clarify the specific questions the research should answer.",
      executor: "shell",
      acceptanceCriteria: ["Research questions are defined"],
    },
    {
      title: "Gather information",
      description: "Collect relevant information from project files, documentation, and sources.",
      executor: "shell",
      acceptanceCriteria: ["Information is gathered from relevant sources"],
    },
    {
      title: "Analyze findings",
      description: "Analyze the gathered information and draw conclusions.",
      executor: "shell",
      acceptanceCriteria: ["Findings are analyzed and conclusions are drawn"],
    },
    {
      title: "Document results",
      description: "Document research findings, comparisons, and recommendations.",
      executor: "shell",
      acceptanceCriteria: ["Research results are documented"],
    },
    {
      title: "Generate report",
      description: "Create a final research report with findings and recommendations.",
      executor: "shell",
      acceptanceCriteria: ["Research report is saved"],
    },
  ],
};

const PLANNING_TEMPLATE: TaskTemplate = {
  useCase: "planning",
  title: "Planning Task",
  description: "Creating plans, architecture designs, and breaking down work",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files.",
      executor: "shell",
      acceptanceCriteria: ["Project rules are loaded"],
    },
    {
      title: "Understand context and goals",
      description: "Understand the project context, constraints, and goals.",
      executor: "shell",
      acceptanceCriteria: ["Context and goals are documented"],
    },
    {
      title: "Analyze requirements",
      description: "Break down requirements into detailed specifications.",
      executor: "shell",
      acceptanceCriteria: ["Requirements are analyzed and documented"],
    },
    {
      title: "Create detailed plan",
      description: "Create a detailed execution plan with tasks, timeline, and dependencies.",
      executor: "shell",
      acceptanceCriteria: ["Detailed plan is created with task breakdown"],
    },
    {
      title: "Review and finalize plan",
      description: "Review the plan for completeness and feasibility.",
      executor: "shell",
      acceptanceCriteria: ["Plan is reviewed and finalized"],
    },
  ],
};

const PROJECT_SETUP_TEMPLATE: TaskTemplate = {
  useCase: "project-setup",
  title: "Project Setup Task",
  description: "Initializing projects, configuring tools, and setting up infrastructure",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files and setup requirements.",
      executor: "shell",
      acceptanceCriteria: ["Setup requirements are understood"],
    },
    {
      title: "Understand setup requirements",
      description: "Analyze what needs to be configured or set up.",
      executor: "shell",
      acceptanceCriteria: ["Setup scope is defined"],
    },
    {
      title: "Create project structure",
      description: "Create the initial project structure, directories, and configuration files.",
      executor: "shell",
      acceptanceCriteria: ["Project structure is created"],
    },
    {
      title: "Configure tools and dependencies",
      description: "Install and configure required tools, dependencies, and settings.",
      executor: "shell",
      acceptanceCriteria: ["Tools and dependencies are configured"],
    },
    {
      title: "Verify setup",
      description: "Run verification to confirm the setup is working correctly.",
      executor: "shell",
      acceptanceCriteria: ["Setup verification passes"],
    },
    {
      title: "Generate report",
      description: "Document the setup process and configuration details.",
      executor: "shell",
      acceptanceCriteria: ["Setup report is saved"],
    },
  ],
};

const TESTING_TEMPLATE: TaskTemplate = {
  useCase: "testing",
  title: "Testing Task",
  description: "Writing tests, adding coverage, and verifying correctness",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files and testing standards.",
      executor: "shell",
      acceptanceCriteria: ["Testing standards are understood"],
    },
    {
      title: "Understand the code to test",
      description: "Analyze the existing code to understand what needs to be tested.",
      executor: "shell",
      acceptanceCriteria: ["Code to test is analyzed"],
    },
    {
      title: "Design test strategy",
      description: "Plan test cases, edge cases, and testing approach.",
      executor: "shell",
      acceptanceCriteria: ["Test strategy is documented"],
    },
    {
      title: "Implement test cases",
      description: "Write test implementations following project testing conventions.",
      executor: "shell",
      acceptanceCriteria: ["Test cases are implemented"],
    },
    {
      title: "Run tests",
      description: "Execute the test suite and verify all tests pass.",
      executor: "shell",
      acceptanceCriteria: ["All tests pass"],
    },
    {
      title: "Fix any issues",
      description: "Fix any failing tests or issues discovered during test execution.",
      executor: "shell",
      acceptanceCriteria: ["Test issues are resolved"],
    },
    {
      title: "Generate report",
      description: "Document test results, coverage, and any findings.",
      executor: "shell",
      acceptanceCriteria: ["Test report is saved"],
    },
  ],
};

const DEVOPS_TEMPLATE: TaskTemplate = {
  useCase: "devops",
  title: "DevOps Task",
  description: "CI/CD, deployment, infrastructure configuration",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files and infrastructure requirements.",
      executor: "shell",
      acceptanceCriteria: ["Infrastructure requirements are understood"],
    },
    {
      title: "Understand infrastructure needs",
      description: "Analyze the deployment and infrastructure requirements.",
      executor: "shell",
      acceptanceCriteria: ["Infrastructure needs are documented"],
    },
    {
      title: "Create or update configuration",
      description: "Write or modify CI/CD pipeline, Docker, or infrastructure config files.",
      executor: "shell",
      acceptanceCriteria: ["Configuration files are created or updated"],
    },
    {
      title: "Implement DevOps changes",
      description: "Apply the infrastructure and deployment changes.",
      executor: "shell",
      acceptanceCriteria: ["DevOps changes are applied"],
    },
    {
      title: "Validate deployment",
      description: "Verify the configuration works correctly with dry-run or validation.",
      executor: "shell",
      acceptanceCriteria: ["Deployment validation passes"],
    },
    {
      title: "Generate report",
      description: "Document the DevOps changes and configuration details.",
      executor: "shell",
      acceptanceCriteria: ["DevOps report is saved"],
    },
  ],
};

const DATA_ANALYSIS_TEMPLATE: TaskTemplate = {
  useCase: "data-analysis",
  title: "Data Analysis Task",
  description: "Data processing, statistics, and visualization",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files.",
      executor: "shell",
      acceptanceCriteria: ["Project rules are loaded"],
    },
    {
      title: "Understand data requirements",
      description: "Analyze what data is needed and what questions to answer.",
      executor: "shell",
      acceptanceCriteria: ["Data requirements are defined"],
    },
    {
      title: "Gather or load data",
      description: "Collect, load, or generate the required data.",
      executor: "shell",
      acceptanceCriteria: ["Data is loaded and validated"],
    },
    {
      title: "Analyze and process data",
      description: "Process the data, run analysis, and compute statistics.",
      executor: "shell",
      acceptanceCriteria: ["Data analysis is complete"],
    },
    {
      title: "Create visualizations",
      description: "Create charts, graphs, or visual representations of the findings.",
      executor: "shell",
      acceptanceCriteria: ["Visualizations are created"],
    },
    {
      title: "Generate report",
      description: "Document the analysis methodology, findings, and conclusions.",
      executor: "shell",
      acceptanceCriteria: ["Analysis report is saved"],
    },
  ],
};

const UI_DESIGN_TEMPLATE: TaskTemplate = {
  useCase: "ui-design",
  title: "UI/UX Design Task",
  description: "Designing and implementing user interfaces",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files and design guidelines.",
      executor: "shell",
      acceptanceCriteria: ["Design guidelines are understood"],
    },
    {
      title: "Understand UI requirements",
      description: "Analyze the UI/UX requirements and user needs.",
      executor: "shell",
      acceptanceCriteria: ["UI requirements are documented"],
    },
    {
      title: "Review existing UI",
      description: "Examine existing UI components and design patterns in the project.",
      executor: "shell",
      acceptanceCriteria: ["Existing UI patterns are identified"],
    },
    {
      title: "Design UI components",
      description: "Design or plan the UI components needed for the task.",
      executor: "shell",
      acceptanceCriteria: ["UI component designs are ready"],
    },
    {
      title: "Implement UI changes",
      description: "Implement the UI components following design and accessibility standards.",
      executor: "shell",
      acceptanceCriteria: ["UI changes are implemented"],
    },
    {
      title: "Verify UI quality",
      description: "Check UI for consistency, accessibility, and responsiveness.",
      executor: "shell",
      acceptanceCriteria: ["UI quality checks pass"],
    },
    {
      title: "Generate report",
      description: "Document the UI changes and design decisions.",
      executor: "shell",
      acceptanceCriteria: ["UI report is saved"],
    },
  ],
};

const WRITING_TEMPLATE: TaskTemplate = {
  useCase: "writing",
  title: "Writing Task",
  description: "Content writing, editing, and creation",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files and writing standards.",
      executor: "shell",
      acceptanceCriteria: ["Writing standards are understood"],
    },
    {
      title: "Understand writing requirements",
      description: "Analyze the writing scope, audience, and tone.",
      executor: "shell",
      acceptanceCriteria: ["Writing requirements are defined"],
    },
    {
      title: "Research or outline content",
      description: "Create an outline or gather information needed for the content.",
      executor: "shell",
      acceptanceCriteria: ["Content outline is created"],
    },
    {
      title: "Write content",
      description: "Write the content following the outline and project style.",
      executor: "shell",
      acceptanceCriteria: ["Content is written"],
    },
    {
      title: "Review and finalize",
      description: "Review the content for quality, accuracy, and polish.",
      executor: "shell",
      acceptanceCriteria: ["Content is reviewed and finalized"],
    },
  ],
};

const GENERAL_TEMPLATE: TaskTemplate = {
  useCase: "general",
  title: "General Task",
  description: "General AI-assisted work",
  tasks: [
    {
      title: "Read project rules",
      description: "Load and review project-level rule files.",
      executor: "shell",
      acceptanceCriteria: ["Project rules are loaded and reviewed"],
    },
    {
      title: "Understand request",
      description: "Analyze the user prompt and identify key requirements.",
      executor: "shell",
      acceptanceCriteria: ["Requirements are documented"],
    },
    {
      title: "Inspect project",
      description: "Examine project structure, existing code, and dependencies.",
      executor: "shell",
      acceptanceCriteria: ["Project structure is documented"],
    },
    {
      title: "Create implementation plan",
      description: "Design the solution approach and outline required changes.",
      executor: "shell",
      acceptanceCriteria: ["Implementation plan is documented"],
    },
    {
      title: "Execute implementation",
      description: "Implement the solution based on the plan.",
      executor: "shell",
      acceptanceCriteria: ["Implementation is complete according to plan"],
    },
    {
      title: "Run validation",
      description: "Execute quality checks and verify the implementation.",
      executor: "shell",
      acceptanceCriteria: ["All defined quality checks pass"],
    },
    {
      title: "Generate final report",
      description: "Document what was done, what changed, and next steps.",
      executor: "shell",
      acceptanceCriteria: ["Final report is generated and saved"],
    },
  ],
};

const TEMPLATE_MAP: Record<UseCaseType, TaskTemplate> = {
  coding: CODING_TEMPLATE,
  documentation: DOCUMENTATION_TEMPLATE,
  debugging: DEBUGGING_TEMPLATE,
  research: RESEARCH_TEMPLATE,
  planning: PLANNING_TEMPLATE,
  "project-setup": PROJECT_SETUP_TEMPLATE,
  testing: TESTING_TEMPLATE,
  devops: DEVOPS_TEMPLATE,
  "data-analysis": DATA_ANALYSIS_TEMPLATE,
  "ui-design": UI_DESIGN_TEMPLATE,
  writing: WRITING_TEMPLATE,
  general: GENERAL_TEMPLATE,
};

export function getTaskTemplate(useCase: UseCaseType): TaskTemplate {
  return TEMPLATE_MAP[useCase] ?? GENERAL_TEMPLATE;
}

export function getUseCaseName(useCase: UseCaseType): string {
  const names: Record<UseCaseType, string> = {
    coding: "Software Development",
    documentation: "Documentation",
    debugging: "Debugging",
    research: "Research",
    planning: "Planning",
    "project-setup": "Project Setup",
    testing: "Testing",
    devops: "DevOps",
    "data-analysis": "Data Analysis",
    "ui-design": "UI/UX Design",
    writing: "Writing",
    general: "General",
  };
  return names[useCase] ?? "General";
}
