import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { InternalAiPlanner } from "../../src/planner/internal-ai-planner.js";
import { TaskContextBuilder } from "../../src/context/task-context-builder.js";
import type { TaskContext } from "../../src/context/task-context-builder.js";
import { ProviderRegistry } from "../../src/ai/provider-registry.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import type { AiProvider } from "../../src/ai/ai-provider.js";

const VALID_PLAN_RESPONSE = {
  title: "Implement authentication",
  summary: "Add authentication module with login and register",
  tasks: [
    {
      title: "Create auth.ts with login and register functions",
      description:
        "Implement src/auth.ts with login() authenticates user via credentials and register() creates a new user account",
      executor: "shell",
      acceptanceCriteria: ["auth.ts file exists with login() and register()"],
      commands: ["touch src/auth.ts"],
      validation: {
        commands: [],
        requiredArtifacts: [],
        requireGitDiff: false,
      },
      expectedResult: "src/auth.ts is created with login() and register() exports",
      outputPlan: [
        {
          action: "create" as const,
          target: "src/auth.ts",
          description: "Authentication module with login and register functions",
          validationMethod: "file_exists" as const,
        },
      ],
      taskType: "coding" as const,
      actionType: "create" as const,
      inputContext: "Project structure and existing auth patterns",
      targetFiles: ["src/auth.ts"],
      targetArtifacts: [],
      evidence: ["src/auth.ts file exists", "File exports login() and register()"],
      verificationCommand: "ls src/auth.ts",
      approvalRequired: false,
      retryPolicy: {
        maxRetries: 2,
        retryDelayMs: 1000,
        retryBackoff: "linear" as const,
      },
      timeout: {
        durationMs: 60000,
        action: "fail" as const,
      },
      finalOutputContribution: "Core authentication module that all auth features depend on",
    },
    {
      title: "Add validation middleware for auth routes",
      description:
        "Add input validation for login and register endpoints ensuring email format and password strength",
      executor: "shell",
      dependsOn: ["Create auth.ts with login and register functions"],
      acceptanceCriteria: ["Validation middleware exists"],
      commands: ["touch src/validation.ts"],
      validation: {
        commands: [],
        requiredArtifacts: [],
        requireGitDiff: false,
      },
      expectedResult: "Validation middleware file is created",
      outputPlan: [
        {
          action: "create" as const,
          target: "src/validation.ts",
          description: "Validation middleware for auth routes",
          validationMethod: "file_exists" as const,
        },
      ],
      taskType: "coding" as const,
      actionType: "create" as const,
      inputContext: "Auth module from previous step",
      targetFiles: ["src/validation.ts"],
      targetArtifacts: [],
      evidence: ["src/validation.ts file exists"],
      verificationCommand: "ls src/validation.ts",
      approvalRequired: false,
      retryPolicy: {
        maxRetries: 2,
        retryDelayMs: 1000,
        retryBackoff: "linear" as const,
      },
      timeout: {
        durationMs: 60000,
        action: "fail" as const,
      },
      finalOutputContribution: "Input validation layer that secures auth endpoints",
    },
  ],
};

function makeMockProvider(generateFn: ReturnType<typeof vi.fn>): AiProvider {
  return {
    name: "mock-test",
    supportsStreaming: false,
    supportsJsonObject: true,
    generate: generateFn,
  };
}

function makeTestConfig(): FlowTaskConfig {
  const defaults = generateDefaultConfig();
  return {
    ...defaults,
    planner: {
      ...defaults.planner!,
      provider: "mock-test",
      model: "gpt-4.1-mini",
    },
  };
}

function makeFakeTaskContext(testDir: string): TaskContext {
  const contextPack = [
    "## Project Context",
    "- Name: test-project",
    "- Type: code",
    "- Languages: typescript",
    "- Frameworks: express",
    "- Package manager: npm",
    "- Test framework: vitest",
    "- Entry points: src/index.ts",
    "- Dependencies: 1 (dev: 2)",
    "",
    "### Git Status",
    "- Branch: main",
    "- Modified: 0 file(s) (0 staged, 0 unstaged, 0 untracked)",
    "",
    "### Relevant Files",
    "- src/auth.ts (matched by name)",
    "- src/utils.ts (matched by content)",
    "- docs/auth.md (matched by content)",
    "",
    "### Code Graph",
    "Modules: 2, Edges: 0",
    "Entry points: src/index.ts",
    "",
    "#### src/auth.ts",
    "  Exports: login, register",
    "",
    "#### src/utils.ts",
    "  Exports: helper",
    "",
    "### Tests",
    "Framework(s): vitest",
    "Test files: 1",
    "- tests/auth.test.ts → src/auth.ts",
  ].join("\n");

  return {
    projectMeta: {
      name: "test-project",
      type: "code",
      packageManager: "npm",
      buildTool: null,
      languages: ["typescript"],
      frameworks: ["express"],
      testFramework: "vitest",
      scripts: ["test", "build"],
      importantFolders: ["src", "docs", "tests"],
      configFiles: ["tsconfig.json"],
      docs: ["README.md"],
      entryPoints: ["src/index.ts"],
      dependencies: 1,
      devDependencies: 2,
      hasTests: true,
      gitBranch: "main",
      gitHasChanges: false,
    },
    gitStatus: {
      branch: "main",
      hasChanges: false,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      recentCommits: [],
      ahead: 0,
      behind: 0,
    },
    keywordMatches: [
      {
        filePath: path.join(testDir, "src", "auth.ts"),
        relativePath: "src/auth.ts",
        keyword: "auth",
        matchedBy: "name",
      },
      {
        filePath: path.join(testDir, "src", "utils.ts"),
        relativePath: "src/utils.ts",
        keyword: "auth",
        matchedBy: "content",
      },
      {
        filePath: path.join(testDir, "docs", "auth.md"),
        relativePath: "docs/auth.md",
        keyword: "auth",
        matchedBy: "content",
      },
    ],
    codeGraph: {
      files: [
        {
          filePath: path.join(testDir, "src", "auth.ts"),
          relativePath: "src/auth.ts",
          imports: [],
          exports: ["login", "register"],
          isEntryPoint: false,
          relatedTests: ["tests/auth.test.ts"],
        },
        {
          filePath: path.join(testDir, "src", "utils.ts"),
          relativePath: "src/utils.ts",
          imports: [],
          exports: ["helper"],
          isEntryPoint: false,
          relatedTests: [],
        },
      ],
      edges: [],
      entryPoints: ["src/index.ts"],
    },
    testResult: {
      frameworks: [{ name: "vitest", configFiles: [], configPresent: false }],
      testFiles: [
        {
          filePath: path.join(testDir, "tests", "auth.test.ts"),
          relativePath: "tests/auth.test.ts",
          framework: "vitest",
          relatedSourceModule: "src/auth.ts",
          size: 50,
        },
      ],
      coverage: { available: false, reports: [], lines: null, branches: null, functions: null },
      testFileCount: 1,
      summary: "Framework(s): vitest\nTest files: 1\nCoverage: not available",
    },
    contextPack,
    userGoal: "implement auth login",
    taskType: "code" as const,
    workflowType: "code_implementation" as const,
    contextItems: [],
    relevantFiles: ["src/auth.ts", "src/utils.ts", "docs/auth.md"],
    relevantDocuments: [],
    relevantArtifacts: [],
    relevantDataFiles: [],
    relatedCommands: ["npm test", "npm run build", "npm run lint", "test", "build"],
    previousDecisions: [],
    risks: [],
    constraints: [],
    expectedOutputs: [],
    validationMethods: [],
    planningHints: [],
    confidenceScore: 0.5,
    compactText:
      "# Task Context\n\n## Goal\nimplement auth login\n\n## Type\n- Task: code\n- Workflow: code_implementation\n\n## Confidence\n50%\n\n## Project\n- Name: test-project\n- Type: code\n",
  };
}

describe("InternalAiPlanner — context enrichment with TaskContextBuilder", () => {
  let testDir: string;
  let mockGenerate: ReturnType<typeof vi.fn>;
  let buildSpy: unknown;

  beforeAll(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "ai-planner-context-test-"));

    await fs.mkdir(path.join(testDir, "src"), { recursive: true });
    await fs.mkdir(path.join(testDir, "docs"), { recursive: true });
    await fs.mkdir(path.join(testDir, "tests"), { recursive: true });
    await fs.mkdir(path.join(testDir, "node_modules", "some-lib"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testDir, ".git"), { recursive: true });
    await fs.mkdir(path.join(testDir, "dist"), { recursive: true });

    await fs.writeFile(
      path.join(testDir, "src", "auth.ts"),
      "export function login() {}\nexport function register() {}\n",
    );
    await fs.writeFile(
      path.join(testDir, "src", "user-service.ts"),
      "export class UserService {}\n",
    );
    await fs.writeFile(
      path.join(testDir, "docs", "auth.md"),
      "# Auth Module\nDiscusses authentication flow.\n",
    );
    await fs.writeFile(
      path.join(testDir, "src", "utils.ts"),
      "export function helper() {}\n// authentication helper\n",
    );
    await fs.writeFile(
      path.join(testDir, "tests", "auth.test.ts"),
      'import { login } from "../src/auth";\ndescribe("auth", () => { it("works", () => {}); });\n',
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockGenerate = vi.fn().mockResolvedValue({
      text: JSON.stringify(VALID_PLAN_RESPONSE),
      usage: { inputTokens: 15, outputTokens: 40 },
    });

    vi.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(
      makeMockProvider(mockGenerate),
    );

    buildSpy = vi
      .spyOn(TaskContextBuilder.prototype, "build")
      .mockResolvedValue(makeFakeTaskContext(testDir));
  });

  it("should call TaskContextBuilder.build with project root and prompt", async () => {
    const planner = new InternalAiPlanner(makeTestConfig());
    const prompt = "Implement authentication feature";

    await planner.createPlan({
      projectRoot: testDir,
      prompt,
      rulesContext: "",
    });

    expect(buildSpy).toHaveBeenCalledWith(testDir, prompt);
  });

  it("should include TaskContext context pack in the provider user prompt", async () => {
    const planner = new InternalAiPlanner(makeTestConfig());
    const prompt = "Implement authentication feature";

    await planner.createPlan({
      projectRoot: testDir,
      prompt,
      rulesContext: "",
    });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const requestArg = mockGenerate.mock.calls[0]![0] as {
      userPrompt: string;
    };
    expect(requestArg).toBeDefined();

    const userPrompt = requestArg.userPrompt;
    expect(userPrompt).toContain("## Project Context");
    expect(userPrompt).toContain("test-project");
    expect(userPrompt).toContain("### Git Status");
    expect(userPrompt).toContain("### Relevant Files");
    expect(userPrompt).toContain("src/auth.ts");
    expect(userPrompt).toContain("### Code Graph");
    expect(userPrompt).toContain("login, register");
    expect(userPrompt).toContain("### Tests");
    expect(userPrompt).toContain("vitest");
  });

  it("should produce tasks that reference concepts from the scanned files", async () => {
    const planner = new InternalAiPlanner(makeTestConfig());
    const prompt = "Implement authentication feature";

    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt,
      rulesContext: "",
    });

    expect(result.tasks.length).toBeGreaterThan(0);

    const authRelated = result.tasks.filter(
      (t) =>
        t.title.toLowerCase().includes("auth") ||
        t.description?.toLowerCase().includes("auth") ||
        t.description?.toLowerCase().includes("login") ||
        t.description?.toLowerCase().includes("register"),
    );
    expect(authRelated.length).toBeGreaterThan(0);
  });

  it("should pass task context through the entire pipeline end-to-end", async () => {
    const planner = new InternalAiPlanner(makeTestConfig());
    const prompt = "Implement authentication feature";

    const result = await planner.createPlan({
      projectRoot: testDir,
      prompt,
      rulesContext: "",
    });

    expect(buildSpy).toHaveBeenCalled();
    expect(mockGenerate).toHaveBeenCalled();

    expect(result.title).toBe("Implement authentication");
    expect(result.tasks.length).toBe(2);
    expect(result.tasks[0]!.title).toBe("Create auth.ts with login and register functions");
  });

  it("should use provided projectFilesContext instead of scanning", async () => {
    const planner = new InternalAiPlanner(makeTestConfig());
    const prompt = "Implement authentication feature";
    const customContext = "## Custom Context\nAlready provided.\n";

    await planner.createPlan({
      projectRoot: testDir,
      prompt,
      rulesContext: "",
      projectFilesContext: customContext,
    });

    expect(buildSpy).not.toHaveBeenCalled();
    expect(mockGenerate).toHaveBeenCalled();
    const requestArg = mockGenerate.mock.calls[0]![0] as {
      userPrompt: string;
    };
    expect(requestArg.userPrompt).toContain("## Custom Context");
    expect(requestArg.userPrompt).toContain("Already provided.");
  });
});
