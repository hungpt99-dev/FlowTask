import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";
import type { AiProvider } from "../../src/ai/ai-provider.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import { InternalAiPlanner } from "../../src/planner/internal-ai-planner.js";
import { ProviderRegistry } from "../../src/ai/provider-registry.js";
import { AiPlannerOutputSchema } from "../../src/schemas/planner.schema.js";

function initGitRepo(dir: string): void {
  spawnSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: dir, stdio: "ignore" });
}

function gitCommit(dir: string, msg = "initial"): void {
  spawnSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["commit", "-m", msg], { cwd: dir, stdio: "ignore" });
}

const VALID_PLAN_RESPONSE = {
  title: "Implement authentication feature",
  summary: "Add user authentication with login and register endpoints",
  tasks: [
    {
      title: "Create auth service with login and register methods",
      description:
        "Implement src/auth-service.ts with login() authenticating via email/password and register() creating a new user account",
      executor: "shell",
      riskLevel: "safe",
      acceptanceCriteria: ["auth-service.ts exists with login() and register() exports"],
      commands: ["touch src/auth-service.ts"],
      validation: {
        commands: ["pnpm typecheck"],
        requireGitDiff: false,
      },
      expectedResult:
        "src/auth-service.ts is created with login() and register() exports and compiles without type errors",
      outputPlan: [
        {
          action: "create",
          target: "src/auth-service.ts",
          description: "Auth service module with login and register functions",
          validationMethod: "file_exists",
        },
      ],
      taskType: "coding",
      actionType: "create",
      inputContext: "Project structure, existing auth patterns",
      targetFiles: ["src/auth-service.ts"],
      targetArtifacts: [],
      evidence: ["src/auth-service.ts exists", "File exports login() and register()"],
      verificationCommand: "pnpm typecheck",
      approvalRequired: false,
      retryPolicy: { maxRetries: 2, retryDelayMs: 1000, retryBackoff: "linear" },
      timeout: { durationMs: 60000, action: "fail" },
      finalOutputContribution: "Core auth service that all auth features depend on",
    },
    {
      title: "Add tests for auth service",
      description:
        "Create tests/services/auth-service.test.ts with test cases covering login success, login failure, and registration flows",
      executor: "shell",
      riskLevel: "safe",
      dependsOn: ["Create auth service with login and register methods"],
      acceptanceCriteria: ["Test file exists and covers login/register scenarios"],
      commands: ["touch tests/services/auth-service.test.ts"],
      validation: {
        commands: ["pnpm test -- tests/services/auth-service.test.ts"],
        requireGitDiff: false,
      },
      expectedResult: "Tests for auth service pass successfully covering all scenarios",
      outputPlan: [
        {
          action: "create",
          target: "tests/services/auth-service.test.ts",
          description: "Test suite for auth service",
          validationMethod: "file_exists",
        },
        {
          action: "modify",
          target: "src/auth-service.ts",
          description: "Auth service updated during test-driven development",
          validationMethod: "file_diff",
        },
      ],
      taskType: "testing",
      actionType: "create",
      inputContext: "Auth service implementation from previous step",
      targetFiles: ["tests/services/auth-service.test.ts"],
      targetArtifacts: [],
      evidence: ["Test file exists", "Tests pass successfully"],
      verificationCommand: "pnpm test -- tests/services/auth-service.test.ts",
      approvalRequired: false,
      retryPolicy: { maxRetries: 2, retryDelayMs: 1000, retryBackoff: "linear" },
      timeout: { durationMs: 120000, action: "fail" },
      finalOutputContribution: "Test coverage ensuring auth service correctness",
    },
    {
      title: "Add auth routes to Express server",
      description:
        "Create src/routes/auth-routes.ts with POST /login and POST /register endpoints using the auth service",
      executor: "shell",
      riskLevel: "risky",
      dependsOn: ["Create auth service with login and register methods"],
      acceptanceCriteria: ["Auth routes file exists with login and register endpoints"],
      commands: ["touch src/routes/auth-routes.ts"],
      validation: {
        commands: ["pnpm typecheck"],
        requireGitDiff: false,
      },
      expectedResult: "Auth routes are created and integrated with Express server",
      outputPlan: [
        {
          action: "create",
          target: "src/routes/auth-routes.ts",
          description: "Express routes for login and register endpoints",
          validationMethod: "file_exists",
        },
      ],
      taskType: "coding",
      actionType: "create",
      inputContext: "Auth service, test feedback",
      targetFiles: ["src/routes/auth-routes.ts"],
      targetArtifacts: [],
      evidence: ["src/routes/auth-routes.ts exists", "Typecheck passes"],
      verificationCommand: "pnpm typecheck",
      approvalRequired: false,
      retryPolicy: { maxRetries: 2, retryDelayMs: 1000, retryBackoff: "linear" },
      timeout: { durationMs: 60000, action: "fail" },
      finalOutputContribution: "HTTP endpoints that expose auth functionality to users",
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

describe("FlowTask API — Scan-First Code-Aware Planning (E2E)", () => {
  let testDir: string;
  let api: FlowTaskAPI;
  let projectId: string;
  let runId: string;

  beforeAll(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "flowtask-scan-planning-e2e-"));

    // Create sample code project structure
    await fs.mkdir(path.join(testDir, "src"), { recursive: true });
    await fs.mkdir(path.join(testDir, "tests"), { recursive: true });
    await fs.mkdir(path.join(testDir, "docs"), { recursive: true });

    await fs.writeFile(
      path.join(testDir, "src", "index.ts"),
      [
        'import { createApp } from "./app.js";',
        "const app = createApp();",
        "app.listen(3000, () => console.log('Server started'));",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(testDir, "src", "app.ts"),
      [
        'import express from "express";',
        "export function createApp() {",
        "  const app = express();",
        "  app.use(express.json());",
        "  return app;",
        "}",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(testDir, "src", "auth-service.ts"),
      [
        'import { db } from "./db.js";',
        "export class AuthService {",
        "  async login(email: string, password: string) {",
        "    const user = db.users.find((u) => u.email === email);",
        "    if (!user || user.password !== password) {",
        "      throw new Error('Invalid credentials');",
        "    }",
        "    return { token: 'mock-jwt-' + user.id };",
        "  }",
        "  async register(email: string, password: string) {",
        "    const id = Date.now().toString();",
        "    db.users.push({ id, email, password });",
        "    return { id, email };",
        "  }",
        "}",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(testDir, "src", "user-service.ts"),
      [
        'import { db } from "./db.js";',
        "export class UserService {",
        "  async findByEmail(email: string) {",
        "    return db.users.find((u) => u.email === email);",
        "  }",
        "  async createUser(data: { email: string; password: string }) {",
        "    const id = Date.now().toString();",
        "    db.users.push({ id, ...data });",
        "    return id;",
        "  }",
        "}",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(testDir, "src", "db.ts"),
      [
        "export const db = {",
        "  users: [] as Array<{ id: string; email: string; password: string }>,",
        "};",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(testDir, "src", "config.ts"),
      [
        "export const config = {",
        "  port: 3000,",
        "  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',",
        "};",
      ].join("\n"),
    );

    await fs.writeFile(
      path.join(testDir, "tests", "auth-service.test.ts"),
      [
        'import { AuthService } from "../src/auth-service.js";',
        'import { db } from "../src/db.js";',
        'describe("AuthService", () => {',
        "  beforeEach(() => { db.users = []; });",
        '  it("login returns token for valid credentials", async () => {',
        '    db.users.push({ id: "1", email: "a@b.com", password: "p" });',
        "    const svc = new AuthService();",
        '    const result = await svc.login("a@b.com", "p");',
        "    expect(result.token).toBeDefined();",
        "  });",
        '  it("login throws for invalid password", async () => {',
        '    db.users.push({ id: "1", email: "a@b.com", password: "p" });',
        "    const svc = new AuthService();",
        '    await expect(svc.login("a@b.com", "wrong")).rejects.toThrow();',
        "  });",
        '  it("register creates a new user", async () => {',
        "    const svc = new AuthService();",
        '    const result = await svc.register("new@b.com", "pass");',
        "    expect(result.id).toBeDefined();",
        '    expect(result.email).toBe("new@b.com");',
        "  });",
        "});",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(testDir, "tests", "health.test.ts"),
      [
        'import { createApp } from "../src/app.js";',
        'describe("Health endpoint", () => {',
        '  it("returns 200", async () => {',
        "    const app = createApp();",
        "    expect(app).toBeDefined();",
        "  });",
        "});",
      ].join("\n"),
    );

    await fs.writeFile(
      path.join(testDir, "docs", "architecture.md"),
      "# Architecture\nService-based architecture with Express.\n",
    );

    await fs.writeFile(
      path.join(testDir, "package.json"),
      JSON.stringify({
        name: "e2e-auth-app",
        version: "1.0.0",
        main: "src/index.ts",
        packageManager: "pnpm@9.0.0",
        scripts: {
          test: "vitest run",
          "test:watch": "vitest",
          build: "tsup src/index.ts",
          dev: "tsx src/index.ts",
          typecheck: "tsc --noEmit",
          quality: "pnpm typecheck && pnpm lint && pnpm test",
        },
        dependencies: { express: "^4.18.0" },
        devDependencies: {
          vitest: "^1.0.0",
          typescript: "^5.0.0",
          tsup: "^8.0.0",
          tsx: "^4.0.0",
        },
      }),
    );
    await fs.writeFile(
      path.join(testDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022", module: "NodeNext" },
      }),
    );

    initGitRepo(testDir);
    gitCommit(testDir, "feat: initial auth app setup");

    // Initialize FlowTask project
    api = new FlowTaskAPI({ rootPath: testDir });
    const project = await api.initProject("E2E Auth App", "development");
    projectId = project.projectId;

    // Initialize database
    await api.initDatabase();
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Step 1 — Project scan builds complete TaskContext", () => {
    it("should detect project metadata from source files", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      expect(ctx.context.projectMeta).toBeDefined();
      expect(ctx.context.projectMeta.name).toBe("e2e-auth-app");
      expect(ctx.context.projectMeta.type).toBe("mixed");
      expect(ctx.context.projectMeta.languages).toContain("typescript");
      expect(ctx.context.projectMeta.frameworks).toContain("express");
      expect(ctx.context.projectMeta.testFramework).toBe("vitest");
      expect(ctx.context.projectMeta.packageManager).toBe("pnpm");
      expect(ctx.context.projectMeta.buildTool).toBe("tsup");
      expect(ctx.context.projectMeta.hasTests).toBe(true);
      expect(ctx.context.projectMeta.entryPoints).toContain("src/index.ts");

      expect(ctx.summary).toContain("e2e-auth-app");
      expect(ctx.summary).toContain("mixed");
    });

    it("should detect git status", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      expect(ctx.context.gitStatus).toBeDefined();
      expect(ctx.context.gitStatus.branch).toBe("main");
      expect(ctx.context.gitStatus.recentCommits.length).toBeGreaterThanOrEqual(1);
      expect(ctx.context.gitStatus.recentCommits[0]!.subject).toBe("feat: initial auth app setup");
    });

    it("should find relevant files by keyword from prompt", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      expect(ctx.context.keywordMatches).toBeDefined();
      expect(ctx.context.keywordMatches.length).toBeGreaterThan(0);

      const authMatches = ctx.context.keywordMatches.filter(
        (m) => m.relativePath.includes("auth") || m.relativePath.includes("login"),
      );
      expect(authMatches.length).toBeGreaterThan(0);

      const hasAuthService = ctx.context.keywordMatches.some(
        (m) => m.relativePath === "src/auth-service.ts",
      );
      expect(hasAuthService).toBe(true);

      const hasMatchByContent = ctx.context.keywordMatches.some((m) => m.matchedBy === "content");
      expect(hasMatchByContent).toBe(true);
    });

    it("should build code graph for code projects with relevant files", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      expect(ctx.context.codeGraph).not.toBeNull();
      if (ctx.context.codeGraph) {
        expect(ctx.context.codeGraph.files.length).toBeGreaterThanOrEqual(2);
        expect(ctx.context.codeGraph.edges.length).toBeGreaterThanOrEqual(1);

        const authSvc = ctx.context.codeGraph.files.find(
          (f) => f.relativePath === "src/auth-service.ts",
        );
        expect(authSvc).toBeDefined();
        expect(authSvc!.exports).toContain("AuthService");
        expect(authSvc!.imports).toContain("./db");
      }
    });

    it("should find related tests", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      expect(ctx.context.testResult).not.toBeNull();
      if (ctx.context.testResult) {
        expect(ctx.context.testResult.testFileCount).toBeGreaterThanOrEqual(2);
        expect(ctx.context.testResult.frameworks.some((f) => f.name === "vitest")).toBe(true);

        const userSvcTest = ctx.context.testResult.testFiles.find((f) =>
          f.relativePath.includes("auth-service"),
        );
        expect(userSvcTest).toBeDefined();
      }
    });

    it("should build a comprehensive context pack with all sections", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      expect(ctx.context.contextPack).toBeDefined();
      expect(ctx.context.contextPack.length).toBeGreaterThan(0);
      expect(ctx.context.contextPack).toContain("Project Context");
      expect(ctx.context.contextPack).toContain("Git Status");
      expect(ctx.context.contextPack).toContain("Relevant Files");
      expect(ctx.context.contextPack).toContain("Code Graph");
      expect(ctx.context.contextPack).toContain("Tests");
      expect(ctx.context.contextPack).toContain("e2e-auth-app");
      expect(ctx.context.contextPack).toContain("src/auth-service.ts");
      expect(ctx.context.contextPack).toContain("vitest");
      expect(ctx.context.contextPack).toContain("AuthService");
    });
  });

  describe("Step 2 — Planner generates code-aware plan with TaskContext", () => {
    let mockGenerate: ReturnType<typeof vi.fn>;
    let planner: InternalAiPlanner;

    beforeAll(async () => {
      mockGenerate = vi.fn().mockResolvedValue({
        text: JSON.stringify(VALID_PLAN_RESPONSE),
        usage: { inputTokens: 20, outputTokens: 80 },
      });

      vi.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(
        makeMockProvider(mockGenerate),
      );

      planner = new InternalAiPlanner(makeTestConfig());
    });

    afterAll(() => {
      vi.restoreAllMocks();
    });

    it("should call AI provider user prompt with TaskContext sections", async () => {
      const ctx = await api.getTaskContext("implement auth login");
      const prompt = "Implement authentication feature";

      await planner.createPlan({
        projectRoot: testDir,
        prompt,
        rulesContext: "",
        projectFilesContext: ctx.context.contextPack,
      });

      expect(mockGenerate).toHaveBeenCalledTimes(1);
      const requestArg = mockGenerate.mock.calls[0]![0] as { userPrompt: string };
      expect(requestArg).toBeDefined();

      const userPrompt = requestArg.userPrompt;
      expect(userPrompt).toContain("Project Context");
      expect(userPrompt).toContain("Code Graph");
      expect(userPrompt).toContain("Relevant Files");
      expect(userPrompt).toContain("Tests");
      expect(userPrompt).toContain("src/auth-service.ts");
      expect(userPrompt).toContain("AuthService");
    });

    it("should generate a plan with tasks that include all required fields", async () => {
      const ctx = await api.getTaskContext("implement auth login");
      const prompt = "Implement authentication feature";

      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt,
        rulesContext: "",
        projectFilesContext: ctx.context.contextPack,
      });

      expect(result.title).toBe("Implement authentication feature");
      expect(result.tasks.length).toBe(3);

      for (const task of result.tasks) {
        expect(task.title.length).toBeGreaterThan(0);
        expect(task.description?.length ?? 0).toBeGreaterThan(0);
        expect(task.executor).toBeDefined();
        expect(task.acceptanceCriteria).toBeDefined();
        expect(task.acceptanceCriteria.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("should validate the raw AiPlannerOutput against schema (includes riskLevel)", async () => {
      const planOutput = {
        title: VALID_PLAN_RESPONSE.title,
        summary: VALID_PLAN_RESPONSE.summary,
        tasks: VALID_PLAN_RESPONSE.tasks.map((t) => ({
          title: t.title,
          description: t.description,
          executor: t.executor,
          acceptanceCriteria: t.acceptanceCriteria,
          riskLevel: t.riskLevel,
          commands: t.commands,
          validation: t.validation,
          expectedResult: t.expectedResult,
          outputPlan: t.outputPlan,
          dependsOn: t.dependsOn ?? [],
        })),
      };

      const parseResult = AiPlannerOutputSchema.safeParse(planOutput);
      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        const parsed = parseResult.data;
        expect(parsed.tasks.length).toBe(3);
        for (const task of parsed.tasks) {
          expect(["safe", "risky", "dangerous", "low", "medium", "high"]).toContain(task.riskLevel);
          expect(task.expectedResult).toBeDefined();
          expect(task.outputPlan).toBeDefined();
          expect(task.acceptanceCriteria.length).toBeGreaterThan(0);
          expect(task.validation?.commands).toBeDefined();
        }
      }
    });

    it("should include expectedResult for each task", async () => {
      const ctx = await api.getTaskContext("implement auth login");
      const prompt = "Implement authentication feature";

      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt,
        rulesContext: "",
        projectFilesContext: ctx.context.contextPack,
      });

      for (const task of result.tasks) {
        expect(task.expectedResult).toBeDefined();
        expect(task.expectedResult!.length).toBeGreaterThan(0);
      }
    });

    it("should include outputPlan with action, target, and validationMethod", async () => {
      const ctx = await api.getTaskContext("implement auth login");
      const prompt = "Implement authentication feature";

      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt,
        rulesContext: "",
        projectFilesContext: ctx.context.contextPack,
      });

      for (const task of result.tasks) {
        expect(task.outputPlan).toBeDefined();
        expect(Array.isArray(task.outputPlan)).toBe(true);
        expect(task.outputPlan!.length).toBeGreaterThanOrEqual(1);

        for (const item of task.outputPlan!) {
          expect(item.action).toBeDefined();
          expect(["create", "modify", "delete"]).toContain(item.action);
          expect(item.target).toBeDefined();
          expect(item.target.length).toBeGreaterThan(0);
          expect(item.validationMethod).toBeDefined();
          expect([
            "file_exists",
            "file_content",
            "file_diff",
            "command_output",
            "test",
            "ai_review",
            "manual",
          ]).toContain(item.validationMethod);
        }
      }
    });

    it("should include verification commands for tasks", async () => {
      const ctx = await api.getTaskContext("implement auth login");
      const prompt = "Implement authentication feature";

      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt,
        rulesContext: "",
        projectFilesContext: ctx.context.contextPack,
      });

      for (const task of result.tasks) {
        expect(task.validation).toBeDefined();
        expect(task.validation!.commands).toBeDefined();
        expect(Array.isArray(task.validation!.commands)).toBe(true);
      }
    });

    it("should include dependencies between tasks where applicable", async () => {
      const ctx = await api.getTaskContext("implement auth login");
      const prompt = "Implement authentication feature";

      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt,
        rulesContext: "",
        projectFilesContext: ctx.context.contextPack,
      });

      const hasDep = result.tasks.some((t) => t.dependsOn && t.dependsOn.length > 0);
      expect(hasDep).toBe(true);
    });

    it("should verify AiPlannerOutput schema validates the complete plan", async () => {
      const output = {
        title: VALID_PLAN_RESPONSE.title,
        summary: VALID_PLAN_RESPONSE.summary,
        tasks: VALID_PLAN_RESPONSE.tasks.map((t) => ({
          title: t.title,
          description: t.description,
          executor: t.executor,
          acceptanceCriteria: t.acceptanceCriteria,
          riskLevel: t.riskLevel,
          commands: t.commands,
          validation: t.validation,
          expectedResult: t.expectedResult,
          outputPlan: t.outputPlan,
          dependsOn: t.dependsOn ?? [],
        })),
      };

      const parseResult = AiPlannerOutputSchema.safeParse(output);
      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        const parsed = parseResult.data;
        expect(parsed.tasks.length).toBe(3);
        for (const task of parsed.tasks) {
          expect(task.riskLevel).toBeDefined();
          expect(task.expectedResult).toBeDefined();
          expect(task.outputPlan).toBeDefined();
          expect(task.acceptanceCriteria.length).toBeGreaterThan(0);
          expect(task.validation?.commands).toBeDefined();
        }
      }
    });
  });

  describe("Step 3 — Full lifecycle: create run, scan, plan, and verify integration", () => {
    let mockGenerate: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      mockGenerate = vi.fn().mockResolvedValue({
        text: JSON.stringify(VALID_PLAN_RESPONSE),
        usage: { inputTokens: 25, outputTokens: 100 },
      });

      vi.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(
        makeMockProvider(mockGenerate),
      );
    });

    afterAll(() => {
      vi.restoreAllMocks();
    });

    it("1. should create a run in FlowTask", async () => {
      const run = await api.createRun(projectId, "Implement auth feature", "auto");
      runId = run.runId;

      expect(run.status).toBe("created");
      expect(run.mode).toBe("auto");
    });

    it("2. should scan project and build TaskContext from the run context", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      expect(ctx.context.projectMeta.name).toBe("e2e-auth-app");
      expect(ctx.context.projectMeta.hasTests).toBe(true);
      expect(ctx.context.codeGraph).not.toBeNull();
      expect(ctx.context.testResult).not.toBeNull();

      expect(ctx.context.contextPack).toContain("Project Context");
      expect(ctx.context.contextPack).toContain("Code Graph");
      expect(ctx.context.contextPack).toContain("Tests");
      expect(ctx.context.contextPack).toContain("Relevant Files");
      expect(ctx.context.contextPack).toContain("Git Status");
    });

    it("3. should invoke AI planner with TaskContext and generate a complete plan", async () => {
      const ctx = await api.getTaskContext("implement auth login");
      const prompt = "Implement authentication feature";

      const planner = new InternalAiPlanner(makeTestConfig());
      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt,
        rulesContext: "",
        projectFilesContext: ctx.context.contextPack,
      });

      // Verify the AI provider received the full context
      expect(mockGenerate).toHaveBeenCalled();
      const requestArg = mockGenerate.mock.calls[0]![0] as { userPrompt: string };
      expect(requestArg.userPrompt).toContain("Code Graph");
      expect(requestArg.userPrompt).toContain("src/auth-service.ts");

      // Verify the plan has all expected structure
      expect(result.title).toBeTruthy();
      expect(result.tasks.length).toBeGreaterThanOrEqual(2);

      // Every task must have: action blueprint, expected result, targets, evidence, verification
      for (const task of result.tasks) {
        expect(task.description?.length ?? 0).toBeGreaterThan(0);
        expect(task.expectedResult?.length ?? 0).toBeGreaterThan(0);
        expect(task.acceptanceCriteria?.length).toBeGreaterThanOrEqual(1);
        expect(task.outputPlan?.length).toBeGreaterThanOrEqual(1);
        expect(task.validation?.commands).toBeDefined();
      }
    });

    it("4. should save the generated tasks to the run", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      const planner = new InternalAiPlanner(makeTestConfig());
      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt: "Implement authentication feature",
        rulesContext: "",
        projectFilesContext: ctx.context.contextPack,
      });

      const now = new Date().toISOString();
      const tasks = result.tasks.map((t, i) => ({
        id: `plan_task_${i + 1}`,
        runId,
        title: t.title,
        description: t.description,
        status: "pending" as const,
        executor: t.executor,
        dependsOn: t.dependsOn ?? [],
        acceptanceCriteria: t.acceptanceCriteria,
        validation: t.validation ?? {},
        expectedResult: t.expectedResult ?? "",
        outputPlan: t.outputPlan ?? [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      }));

      await api.saveTasks(runId, tasks);
      const loaded = await api.loadTasks(runId);
      expect(loaded.length).toBe(result.tasks.length);
    });

    it("5. should validate the plan schema matches FlowTask task schema", async () => {
      const loaded = await api.loadTasks(runId);

      for (const task of loaded) {
        expect(task.id).toBeTruthy();
        expect(task.runId).toBe(runId);
        expect(task.title).toBeTruthy();
        expect(task.executor).toBeTruthy();
        expect(task.status).toBe("pending");
        expect(task.acceptanceCriteria.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("Step 4 — Scan context shapes code-aware plan content", () => {
    let mockGenerate: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      mockGenerate = vi.fn().mockResolvedValue({
        text: JSON.stringify(VALID_PLAN_RESPONSE),
        usage: { inputTokens: 20, outputTokens: 80 },
      });

      vi.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(
        makeMockProvider(mockGenerate),
      );
    });

    afterAll(() => {
      vi.restoreAllMocks();
    });

    it("should reference actual project files from the scanned context in the plan", async () => {
      const ctx = await api.getTaskContext("update auth tests");

      const planner = new InternalAiPlanner(makeTestConfig());
      const result = await planner.createPlan({
        projectRoot: testDir,
        prompt: "Add tests for authentication",
        rulesContext: "",
        projectFilesContext: ctx.context.contextPack,
      });

      // The planner user prompt should include scanned file references
      const requestArg = mockGenerate.mock.calls[0]![0] as { userPrompt: string };
      expect(requestArg.userPrompt).toContain("src/auth-service.ts");
      expect(requestArg.userPrompt).toContain("AuthService");
      expect(requestArg.userPrompt).toContain("vitest");
      expect(requestArg.userPrompt).toContain("Git Status");

      // Plan tasks should reference concrete file paths
      for (const task of result.tasks) {
        expect(task.title).toMatch(/auth|test|service|route/i);
      }
    });

    it("should include risk assessment context (git status, branch)", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      expect(ctx.context.gitStatus.branch).toBe("main");
      expect(ctx.context.contextPack).toContain("main");

      // Context pack should have change information
      expect(ctx.context.contextPack).toContain("Modified");
    });

    it("should map test files to source modules in the context", async () => {
      const ctx = await api.getTaskContext("implement auth login");

      expect(ctx.context.testResult).not.toBeNull();
      if (ctx.context.testResult) {
        const hasRelationship = ctx.context.testResult.testFiles.some(
          (tf) => tf.relatedSourceModule && tf.relatedSourceModule.includes("auth-service"),
        );
        expect(hasRelationship).toBe(true);
      }

      // Code graph modules should reference related tests
      if (ctx.context.codeGraph) {
        const authSvcModule = ctx.context.codeGraph.files.find(
          (f) => f.relativePath === "src/auth-service.ts",
        );
        expect(authSvcModule).toBeDefined();
        expect(authSvcModule!.relatedTests.length).toBeGreaterThanOrEqual(1);
        expect(authSvcModule!.relatedTests.some((t) => t.includes("auth-service.test"))).toBe(true);
      }
    });
  });
});
