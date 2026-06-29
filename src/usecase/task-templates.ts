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
      acceptanceCriteria: ["Project rules files are read and key rules documented in a file"],
      expectedResult: "Project rules and conventions have been reviewed and documented in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules and conventions",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand requirements",
      description: "Analyze the user prompt and identify key requirements and acceptance criteria.",
      executor: "shell",
      acceptanceCriteria: ["Requirements document exists with acceptance criteria defined"],
      expectedResult: "Requirements are documented with acceptance criteria defined in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/requirements.md",
          description: "Documentation of analyzed requirements and acceptance criteria",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Inspect project structure",
      description: "Examine project structure, existing code, dependencies, and configuration.",
      executor: "shell",
      acceptanceCriteria: [
        "Project structure map file exists with key files and dependencies listed",
      ],
      expectedResult:
        "Project structure, key files, and dependencies have been documented in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/project-structure.md",
          description: "Documentation of project structure, key files, and dependencies",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Design solution approach",
      description:
        "Design the solution, define types, interfaces, and identify files to create or modify.",
      executor: "shell",
      acceptanceCriteria: [
        "Solution design document exists with file list, types, and implementation approach",
      ],
      expectedResult:
        "Solution design document exists with file list, types, and implementation approach",
      outputPlan: [
        {
          action: "create",
          target: "docs/solution-design.md",
          description: "Documentation of solution design with file list, types, and approach",
          validationMethod: "file_exists",
        },
      ],
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
      expectedResult: "Implementation files have been created or modified with correct code",
      outputPlan: [
        {
          action: "modify",
          target: "src/",
          description: "Modified source files for the implementation",
          validationMethod: "file_diff",
        },
        {
          action: "create",
          target: "src/",
          description: "New source files created during implementation",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Add tests",
      description: "Write unit tests and/or integration tests for the new implementation.",
      executor: "shell",
      acceptanceCriteria: [
        "Test files exist covering new implementation with verifiable assertions",
      ],
      expectedResult: "Test files exist and cover the new implementation",
      outputPlan: [
        {
          action: "create",
          target: "tests/",
          description: "Test files covering the new implementation",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Run validation",
      description: "Execute type checking, linting, and tests to verify the implementation.",
      executor: "shell",
      acceptanceCriteria: ["Type check passes", "Lint passes", "Tests pass"],
      expectedResult: "Type check, lint, and test commands all exit successfully",
      outputPlan: [],
    },
    {
      title: "Generate final report",
      description: "Document what was done, what changed, and any next steps.",
      executor: "shell",
      acceptanceCriteria: ["Final report file exists with summary of changes and outcomes"],
      expectedResult: "Final report file exists with summary of changes and outcomes",
      outputPlan: [
        {
          action: "create",
          target: "reports/final-report.md",
          description: "Final report with summary of changes and outcomes",
          validationMethod: "file_exists",
        },
      ],
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
      acceptanceCriteria: ["Documentation standards and conventions file is reviewed"],
      expectedResult: "Documentation standards and conventions have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules and conventions",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand requirements",
      description: "Analyze what documentation is needed and who the audience is.",
      executor: "shell",
      acceptanceCriteria: [
        "Documentation scope, audience, and requirements are documented in a file",
      ],
      expectedResult: "Documentation scope, audience, and requirements are defined in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/requirements.md",
          description: "Documentation of scope, audience, and requirements",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Review existing documentation",
      description: "Examine existing documentation to understand current state and gaps.",
      executor: "shell",
      acceptanceCriteria: ["Existing documentation gaps file exists with identified gaps listed"],
      expectedResult: "Existing documentation has been reviewed and gaps identified in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/existing-docs-review.md",
          description: "Documentation of existing documentation gaps and review findings",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Create documentation outline",
      description: "Structure the documentation with clear sections and flow.",
      executor: "shell",
      acceptanceCriteria: ["Documentation outline file exists with structured sections"],
      expectedResult: "Documentation outline exists with structured sections",
      outputPlan: [
        {
          action: "create",
          target: "docs/outline.md",
          description: "Documentation outline with structured sections",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Write documentation",
      description: "Write the documentation content following project standards.",
      executor: "shell",
      acceptanceCriteria: ["Documentation files exist with complete content"],
      expectedResult: "Documentation files exist with complete content",
      outputPlan: [
        {
          action: "create",
          target: "docs/",
          description: "Written documentation files with complete content",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Review and finalize",
      description: "Review documentation for clarity, accuracy, and completeness.",
      executor: "shell",
      acceptanceCriteria: ["Documentation review file exists with edits and final version noted"],
      expectedResult: "Documentation has been reviewed, edited, and finalized",
      outputPlan: [
        {
          action: "create",
          target: "docs/review-notes.md",
          description: "Review notes with edits and final version documentation",
          validationMethod: "file_exists",
        },
        {
          action: "modify",
          target: "docs/",
          description: "Updated documentation files after review and edits",
          validationMethod: "file_diff",
        },
      ],
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
      acceptanceCriteria: ["Project rules files are reviewed"],
      expectedResult: "Project rules have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand the error",
      description: "Analyze the error message, stack trace, or unexpected behavior.",
      executor: "shell",
      acceptanceCriteria: [
        "Error analysis document exists with error details and reproduction steps",
      ],
      expectedResult: "Error or bug behavior has been documented with reproduction steps",
      outputPlan: [
        {
          action: "create",
          target: "docs/error-analysis.md",
          description: "Documentation of error analysis with reproduction steps",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Inspect relevant code",
      description: "Examine the code related to the error to understand the context.",
      executor: "shell",
      acceptanceCriteria: ["Relevant code areas file exists with examined code paths documented"],
      expectedResult: "Relevant code areas have been examined and documented in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/code-inspection.md",
          description: "Documentation of examined code paths and relevant code areas",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Identify root cause",
      description: "Find the root cause of the issue through analysis and investigation.",
      executor: "shell",
      acceptanceCriteria: ["Root cause document exists with identified cause and evidence"],
      expectedResult: "Root cause has been identified and documented in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/root-cause-analysis.md",
          description: "Documentation of root cause with supporting evidence",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Implement fix",
      description: "Apply the fix for the identified root cause.",
      executor: "shell",
      acceptanceCriteria: ["Fix code changes are applied to relevant files"],
      expectedResult: "Fix has been applied to the relevant code files",
      outputPlan: [
        {
          action: "modify",
          target: "src/",
          description: "Modified files with the fix applied",
          validationMethod: "file_diff",
        },
      ],
    },
    {
      title: "Verify fix",
      description: "Run tests and validation to confirm the fix works and nothing is broken.",
      executor: "shell",
      acceptanceCriteria: ["Tests pass after fix", "No regressions introduced"],
      expectedResult: "Tests and validation commands pass after the fix",
      outputPlan: [],
    },
    {
      title: "Generate report",
      description: "Document what was fixed, root cause, and verification results.",
      executor: "shell",
      acceptanceCriteria: ["Debugging report file exists with root cause and fix details"],
      expectedResult: "Debugging report file exists with root cause and fix details",
      outputPlan: [
        {
          action: "create",
          target: "reports/debug-report.md",
          description: "Debugging report with root cause and fix details",
          validationMethod: "file_exists",
        },
      ],
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
      acceptanceCriteria: ["Project rules files are reviewed"],
      expectedResult: "Project rules have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Define research questions",
      description: "Clarify the specific questions the research should answer.",
      executor: "shell",
      acceptanceCriteria: ["Research questions document exists with clear questions defined"],
      expectedResult: "Research questions have been clearly defined in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/research-questions.md",
          description: "Documentation of defined research questions",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Gather information",
      description: "Collect relevant information from project files, documentation, and sources.",
      executor: "shell",
      acceptanceCriteria: ["Information gathering file exists with sources and collected data"],
      expectedResult: "Relevant information has been gathered from identified sources",
      outputPlan: [
        {
          action: "create",
          target: "docs/research-findings.md",
          description: "Documentation of gathered information from identified sources",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Analyze findings",
      description: "Analyze the gathered information and draw conclusions.",
      executor: "shell",
      acceptanceCriteria: ["Analysis document exists with findings and documented conclusions"],
      expectedResult: "Findings have been analyzed with documented conclusions",
      outputPlan: [
        {
          action: "create",
          target: "docs/analysis.md",
          description: "Documentation of analysis findings and conclusions",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Document results",
      description: "Document research findings, comparisons, and recommendations.",
      executor: "shell",
      acceptanceCriteria: ["Research results file exists with comparisons and recommendations"],
      expectedResult: "Research results have been documented with comparisons and recommendations",
      outputPlan: [
        {
          action: "create",
          target: "docs/results.md",
          description: "Documentation of results with comparisons and recommendations",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Generate report",
      description: "Create a final research report with findings and recommendations.",
      executor: "shell",
      acceptanceCriteria: ["Research report file exists with findings and recommendations"],
      expectedResult: "Research report file exists with findings and recommendations",
      outputPlan: [
        {
          action: "create",
          target: "reports/research-report.md",
          description: "Final research report with findings and recommendations",
          validationMethod: "file_exists",
        },
      ],
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
      acceptanceCriteria: ["Project rules files are reviewed"],
      expectedResult: "Project rules have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand context and goals",
      description: "Understand the project context, constraints, and goals.",
      executor: "shell",
      acceptanceCriteria: ["Context and goals document exists with constraints and objectives"],
      expectedResult: "Project context, constraints, and goals have been documented in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/context-and-goals.md",
          description: "Documentation of project context, constraints, and goals",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Analyze requirements",
      description: "Break down requirements into detailed specifications.",
      executor: "shell",
      acceptanceCriteria: ["Requirements analysis file exists with detailed specifications"],
      expectedResult: "Requirements have been analyzed and specified in detail",
      outputPlan: [
        {
          action: "create",
          target: "docs/requirements-analysis.md",
          description: "Documentation of detailed requirements specifications",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Create detailed plan",
      description: "Create a detailed execution plan with tasks, timeline, and dependencies.",
      executor: "shell",
      acceptanceCriteria: ["Execution plan file exists with task breakdown and dependencies"],
      expectedResult: "Detailed execution plan exists with task breakdown and dependencies",
      outputPlan: [
        {
          action: "create",
          target: "docs/execution-plan.md",
          description: "Detailed execution plan with task breakdown and dependencies",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Review and finalize plan",
      description: "Review the plan for completeness and feasibility.",
      executor: "shell",
      acceptanceCriteria: ["Reviewed plan file exists with final plan and review notes"],
      expectedResult: "Plan has been reviewed, finalized, and is ready for execution",
      outputPlan: [
        {
          action: "create",
          target: "docs/final-plan.md",
          description: "Finalized plan with review notes",
          validationMethod: "file_exists",
        },
      ],
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
      acceptanceCriteria: ["Setup requirements and project rules file is reviewed"],
      expectedResult: "Setup requirements and project rules have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules and setup requirements",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand setup requirements",
      description: "Analyze what needs to be configured or set up.",
      executor: "shell",
      acceptanceCriteria: ["Setup scope document exists with requirements defined"],
      expectedResult: "Setup scope and requirements have been defined in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/setup-requirements.md",
          description: "Documentation of setup scope and requirements",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Create project structure",
      description: "Create the initial project structure, directories, and configuration files.",
      executor: "shell",
      acceptanceCriteria: ["Project directories exist and configuration files are created"],
      expectedResult: "Project structure with directories and config files exists",
      outputPlan: [
        {
          action: "create",
          target: ".flowtask/",
          description: "Project structure directories",
          validationMethod: "file_exists",
        },
        {
          action: "create",
          target: "package.json",
          description: "Project configuration files",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Configure tools and dependencies",
      description: "Install and configure required tools, dependencies, and settings.",
      executor: "shell",
      acceptanceCriteria: [
        "Tools and dependencies configuration file exists and verification passes",
      ],
      expectedResult: "Tools and dependencies are installed and configured correctly",
      outputPlan: [
        {
          action: "modify",
          target: "package.json",
          description: "Updated package.json with installed dependencies",
          validationMethod: "file_diff",
        },
        {
          action: "create",
          target: "node_modules/",
          description: "Installed dependencies",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Verify setup",
      description: "Run verification to confirm the setup is working correctly.",
      executor: "shell",
      acceptanceCriteria: ["Setup verification commands exit successfully"],
      expectedResult: "Setup verification commands exit successfully",
      outputPlan: [],
    },
    {
      title: "Generate report",
      description: "Document the setup process and configuration details.",
      executor: "shell",
      acceptanceCriteria: ["Setup report file exists with configuration details"],
      expectedResult: "Setup report file exists with configuration details",
      outputPlan: [
        {
          action: "create",
          target: "reports/setup-report.md",
          description: "Setup report with configuration details",
          validationMethod: "file_exists",
        },
      ],
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
      acceptanceCriteria: ["Testing standards and project rules file is reviewed"],
      expectedResult: "Testing standards and project rules have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules and testing standards",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand the code to test",
      description: "Analyze the existing code to understand what needs to be tested.",
      executor: "shell",
      acceptanceCriteria: [
        "Code analysis file exists with test areas and coverage targets identified",
      ],
      expectedResult: "Code to test has been analyzed with test areas identified",
      outputPlan: [
        {
          action: "create",
          target: "docs/code-analysis.md",
          description: "Documentation of code analysis with test areas and coverage targets",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Design test strategy",
      description: "Plan test cases, edge cases, and testing approach.",
      executor: "shell",
      acceptanceCriteria: ["Test strategy document exists with test cases and edge cases"],
      expectedResult: "Test strategy document exists with test cases and edge cases",
      outputPlan: [
        {
          action: "create",
          target: "docs/test-strategy.md",
          description: "Test strategy with test cases and edge cases",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Implement test cases",
      description: "Write test implementations following project testing conventions.",
      executor: "shell",
      acceptanceCriteria: ["Test files exist with implemented test cases"],
      expectedResult: "Test files exist with implemented test cases",
      outputPlan: [
        {
          action: "create",
          target: "tests/",
          description: "Test files with implemented test cases",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Run tests",
      description: "Execute the test suite and verify all tests pass.",
      executor: "shell",
      acceptanceCriteria: ["Test suite runs and all tests pass"],
      expectedResult: "Test suite runs and all tests pass",
      outputPlan: [],
    },
    {
      title: "Fix any issues",
      description: "Fix any failing tests or issues discovered during test execution.",
      executor: "shell",
      acceptanceCriteria: ["All test issues are fixed and tests pass"],
      expectedResult: "All test issues have been fixed and tests pass",
      outputPlan: [
        {
          action: "modify",
          target: "tests/",
          description: "Modified test files with fixes applied",
          validationMethod: "file_diff",
        },
        {
          action: "modify",
          target: "src/",
          description: "Modified source files with fixes applied",
          validationMethod: "file_diff",
        },
      ],
    },
    {
      title: "Generate report",
      description: "Document test results, coverage, and any findings.",
      executor: "shell",
      acceptanceCriteria: ["Test report file exists with results and coverage details"],
      expectedResult: "Test report file exists with results and coverage details",
      outputPlan: [
        {
          action: "create",
          target: "reports/test-report.md",
          description: "Test report with results and coverage details",
          validationMethod: "file_exists",
        },
      ],
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
      acceptanceCriteria: ["Project rules and infrastructure requirements file is reviewed"],
      expectedResult: "Project rules and infrastructure requirements have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules and infrastructure requirements",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand infrastructure needs",
      description: "Analyze the deployment and infrastructure requirements.",
      executor: "shell",
      acceptanceCriteria: ["Infrastructure needs document exists with requirements detailed"],
      expectedResult: "Infrastructure needs have been documented in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/infrastructure-needs.md",
          description: "Documentation of infrastructure needs and requirements",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Create or update configuration",
      description: "Write or modify CI/CD pipeline, Docker, or infrastructure config files.",
      executor: "shell",
      acceptanceCriteria: ["Configuration files exist with updated infrastructure settings"],
      expectedResult: "Configuration files have been created or updated",
      outputPlan: [
        {
          action: "create",
          target: ".github/",
          description: "CI/CD pipeline configuration files",
          validationMethod: "file_exists",
        },
        {
          action: "modify",
          target: "Dockerfile",
          description: "Docker or infrastructure configuration files",
          validationMethod: "file_diff",
        },
      ],
    },
    {
      title: "Implement DevOps changes",
      description: "Apply the infrastructure and deployment changes.",
      executor: "shell",
      acceptanceCriteria: ["DevOps changes are applied and configuration files are updated"],
      expectedResult: "DevOps changes have been applied successfully",
      outputPlan: [
        {
          action: "modify",
          target: "deploy/",
          description: "Modified deployment configuration files",
          validationMethod: "file_diff",
        },
      ],
    },
    {
      title: "Validate deployment",
      description: "Verify the configuration works correctly with dry-run or validation.",
      executor: "shell",
      acceptanceCriteria: ["Deployment validation commands exit successfully"],
      expectedResult: "Deployment validation commands exit successfully",
      outputPlan: [],
    },
    {
      title: "Generate report",
      description: "Document the DevOps changes and configuration details.",
      executor: "shell",
      acceptanceCriteria: ["DevOps report file exists with change details"],
      expectedResult: "DevOps report file exists with change details",
      outputPlan: [
        {
          action: "create",
          target: "reports/devops-report.md",
          description: "DevOps report with change and configuration details",
          validationMethod: "file_exists",
        },
      ],
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
      acceptanceCriteria: ["Project rules files are reviewed"],
      expectedResult: "Project rules have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand data requirements",
      description: "Analyze what data is needed and what questions to answer.",
      executor: "shell",
      acceptanceCriteria: ["Data requirements document exists with analysis questions defined"],
      expectedResult: "Data requirements and analysis questions have been defined in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/data-requirements.md",
          description: "Documentation of data requirements and analysis questions",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Gather or load data",
      description: "Collect, load, or generate the required data.",
      executor: "shell",
      acceptanceCriteria: ["Data files exist and data validation passes"],
      expectedResult: "Required data has been gathered, loaded, and validated",
      outputPlan: [
        {
          action: "create",
          target: "data/",
          description: "Gathered or loaded data files",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Analyze and process data",
      description: "Process the data, run analysis, and compute statistics.",
      executor: "shell",
      acceptanceCriteria: ["Analysis output file exists with computed results"],
      expectedResult: "Data has been processed with analysis results computed",
      outputPlan: [
        {
          action: "create",
          target: "data/analysis-output.md",
          description: "Computed analysis results output file",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Create visualizations",
      description: "Create charts, graphs, or visual representations of the findings.",
      executor: "shell",
      acceptanceCriteria: ["Visualization files exist with charts and graphs"],
      expectedResult: "Visualization files exist with charts and graphs",
      outputPlan: [
        {
          action: "create",
          target: "visualizations/",
          description: "Created visualization files with charts and graphs",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Generate report",
      description: "Document the analysis methodology, findings, and conclusions.",
      executor: "shell",
      acceptanceCriteria: ["Analysis report file exists with methodology and findings"],
      expectedResult: "Analysis report file exists with methodology and findings",
      outputPlan: [
        {
          action: "create",
          target: "reports/analysis-report.md",
          description: "Analysis report with methodology and findings",
          validationMethod: "file_exists",
        },
      ],
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
      acceptanceCriteria: ["Design guidelines and project rules file is reviewed"],
      expectedResult: "Design guidelines and project rules have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed design guidelines and project rules",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand UI requirements",
      description: "Analyze the UI/UX requirements and user needs.",
      executor: "shell",
      acceptanceCriteria: ["UI requirements document exists with user needs and scope defined"],
      expectedResult: "UI/UX requirements have been documented in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/ui-requirements.md",
          description: "Documentation of UI/UX requirements and user needs",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Review existing UI",
      description: "Examine existing UI components and design patterns in the project.",
      executor: "shell",
      acceptanceCriteria: [
        "UI patterns review file exists with identified patterns and components",
      ],
      expectedResult: "Existing UI components and patterns have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/ui-review.md",
          description: "Documentation of existing UI components and patterns review",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Design UI components",
      description: "Design or plan the UI components needed for the task.",
      executor: "shell",
      acceptanceCriteria: ["UI component design file exists with component specifications"],
      expectedResult: "UI component designs are documented and ready for implementation",
      outputPlan: [
        {
          action: "create",
          target: "docs/ui-component-design.md",
          description: "UI component designs with specifications",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Implement UI changes",
      description: "Implement the UI components following design and accessibility standards.",
      executor: "shell",
      acceptanceCriteria: ["UI implementation files are created or modified"],
      expectedResult: "UI changes have been implemented in relevant files",
      outputPlan: [
        {
          action: "modify",
          target: "src/",
          description: "Modified UI component files",
          validationMethod: "file_diff",
        },
        {
          action: "create",
          target: "src/",
          description: "New UI component files",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Verify UI quality",
      description: "Check UI for consistency, accessibility, and responsiveness.",
      executor: "shell",
      acceptanceCriteria: ["UI quality validation commands exit successfully"],
      expectedResult: "UI quality checks have been completed successfully",
      outputPlan: [],
    },
    {
      title: "Generate report",
      description: "Document the UI changes and design decisions.",
      executor: "shell",
      acceptanceCriteria: ["UI report file exists with change details and design decisions"],
      expectedResult: "UI report file exists with change details and design decisions",
      outputPlan: [
        {
          action: "create",
          target: "reports/ui-report.md",
          description: "UI report with change details and design decisions",
          validationMethod: "file_exists",
        },
      ],
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
      acceptanceCriteria: ["Writing standards and project rules file is reviewed"],
      expectedResult: "Writing standards and project rules have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed writing standards and project rules",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand writing requirements",
      description: "Analyze the writing scope, audience, and tone.",
      executor: "shell",
      acceptanceCriteria: [
        "Writing requirements document exists with scope, audience, and tone defined",
      ],
      expectedResult: "Writing scope, audience, and tone have been defined in a file",
      outputPlan: [
        {
          action: "create",
          target: "docs/writing-requirements.md",
          description: "Documentation of writing scope, audience, and tone",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Research or outline content",
      description: "Create an outline or gather information needed for the content.",
      executor: "shell",
      acceptanceCriteria: ["Content outline file exists with structured sections"],
      expectedResult: "Content outline exists with structured sections",
      outputPlan: [
        {
          action: "create",
          target: "docs/content-outline.md",
          description: "Content outline with structured sections",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Write content",
      description: "Write the content following the outline and project style.",
      executor: "shell",
      acceptanceCriteria: ["Content files exist with complete written material"],
      expectedResult: "Content files exist with complete written material",
      outputPlan: [
        {
          action: "create",
          target: "docs/",
          description: "Written content files with complete material",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Review and finalize",
      description: "Review the content for quality, accuracy, and polish.",
      executor: "shell",
      acceptanceCriteria: ["Content review file exists with edits and final version noted"],
      expectedResult: "Content has been reviewed, edited, and finalized",
      outputPlan: [
        {
          action: "create",
          target: "docs/review-notes.md",
          description: "Review notes with edits and final version documentation",
          validationMethod: "file_exists",
        },
        {
          action: "modify",
          target: "docs/",
          description: "Updated content files after review and edits",
          validationMethod: "file_diff",
        },
      ],
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
      acceptanceCriteria: ["Project rules files are reviewed"],
      expectedResult: "Project rules have been reviewed",
      outputPlan: [
        {
          action: "create",
          target: "docs/rules-review.md",
          description: "Documentation of reviewed project rules",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Understand request",
      description: "Analyze the user prompt and identify key requirements.",
      executor: "shell",
      acceptanceCriteria: ["Requirements document exists with key requirements extracted"],
      expectedResult: "Requirements have been documented from the prompt",
      outputPlan: [
        {
          action: "create",
          target: "docs/requirements.md",
          description: "Documentation of requirements extracted from the prompt",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Inspect project",
      description: "Examine project structure, existing code, and dependencies.",
      executor: "shell",
      acceptanceCriteria: [
        "Project structure document exists with key files and dependencies listed",
      ],
      expectedResult: "Project structure and key files have been documented",
      outputPlan: [
        {
          action: "create",
          target: "docs/project-structure.md",
          description: "Documentation of project structure and key files",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Create implementation plan",
      description: "Design the solution approach and outline required changes.",
      executor: "shell",
      acceptanceCriteria: ["Implementation plan file exists with approach and required changes"],
      expectedResult: "Implementation plan document exists with approach and changes",
      outputPlan: [
        {
          action: "create",
          target: "docs/implementation-plan.md",
          description: "Implementation plan with approach and required changes",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Execute implementation",
      description: "Implement the solution based on the plan.",
      executor: "shell",
      acceptanceCriteria: ["Implementation files are created or modified as specified in the plan"],
      expectedResult: "Implementation has been completed according to the plan",
      outputPlan: [
        {
          action: "modify",
          target: "src/",
          description: "Modified source files for the implementation",
          validationMethod: "file_diff",
        },
        {
          action: "create",
          target: "src/",
          description: "New source files created during implementation",
          validationMethod: "file_exists",
        },
      ],
    },
    {
      title: "Run validation",
      description: "Execute quality checks and verify the implementation.",
      executor: "shell",
      acceptanceCriteria: ["Validation commands exit successfully"],
      expectedResult: "Validation commands exit successfully with no errors",
      outputPlan: [],
    },
    {
      title: "Generate final report",
      description: "Document what was done, what changed, and next steps.",
      executor: "shell",
      acceptanceCriteria: ["Final report file exists with summary of changes and outcomes"],
      expectedResult: "Final report file exists with summary of changes and outcomes",
      outputPlan: [
        {
          action: "create",
          target: "reports/final-report.md",
          description: "Final report with summary of changes and outcomes",
          validationMethod: "file_exists",
        },
      ],
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
