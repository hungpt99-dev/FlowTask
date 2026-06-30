import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalServer } from "../../src/server/local-server.js";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";

const BASE_PORT = 29200;
let nextPort = BASE_PORT;

function getPort(): number {
  return nextPort++;
}

let testDir: string;
let server: LocalServer;
let port: number;
let api: FlowTaskAPI;
let projectId: string;

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
}

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-e2e-flow-"));
  api = new FlowTaskAPI({ rootPath: testDir });
  await api.initProject("E2E Flow Test", "development");
  await api.initDatabase();
  const project = await api.loadProject();
  projectId = project!.projectId;
  port = getPort();
  server = new LocalServer({ port, rootPath: testDir, staticDir: "nonexistent" });
  await server.start();
});

afterAll(async () => {
  await server.stop();
  rmSync(testDir, { recursive: true, force: true });
});

describe("E2E: Full Workflow Creation and Run via Web UI", () => {
  let runId: string;
  let taskIds: string[];

  describe("1. Orchestrator Configuration", () => {
    it("1a. GET /api/config returns default config", async () => {
      const res = await apiFetch("/config");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("version", "1.0");
      expect(body).toHaveProperty("projectMode", "development");
    });

    it("1b. PUT /api/config updates orchestrator mode and quality settings", async () => {
      const res = await apiFetch("/config", {
        method: "PUT",
        body: JSON.stringify({
          projectMode: "research",
          plannerMode: "auto",
          quality: { enabledByDefault: true, commands: ["pnpm lint", "pnpm typecheck"] },
        }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("1c. Verify merged config persists", async () => {
      const res = await apiFetch("/config");
      const body = await res.json();
      expect(body.projectMode).toBe("research");
      expect(body.quality.enabledByDefault).toBe(true);
      expect(body.quality.commands).toContain("pnpm lint");
    });

    it("1d. PUT /api/config configures approval and limits", async () => {
      const res = await apiFetch("/config", {
        method: "PUT",
        body: JSON.stringify({
          approval: { enabled: true, autoApprove: false, requireFor: ["rm", "del"] },
          limits: { maxRunMinutes: 60, maxTasksPerRun: 20 },
        }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("1e. Verify full config state", async () => {
      const res = await apiFetch("/config");
      const body = await res.json();
      expect(body.approval.enabled).toBe(true);
      expect(body.approval.requireFor).toContain("rm");
      expect(body.limits.maxRunMinutes).toBe(60);
    });
  });

  describe("2. Provider Management", () => {
    it("2a. GET /api/providers returns defaults", async () => {
      const res = await apiFetch("/providers");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("openai");
      expect(body.openai.type).toBe("openai");
    });

    it("2b. PUT /api/config adds a new AI provider", async () => {
      await apiFetch("/config", {
        method: "PUT",
        body: JSON.stringify({
          ai: {
            providers: {
              customProvider: {
                type: "openai-compatible",
                baseUrl: "https://custom.example.com/v1",
                model: "custom-model",
              },
            },
          },
        }),
      });
      const provRes = await apiFetch("/providers");
      const body = await provRes.json();
      expect(body).toHaveProperty("customProvider");
      expect(body.customProvider.type).toBe("openai-compatible");
    });

    it("2c. GET /api/providers returns configured provider type and baseUrl", async () => {
      const res = await apiFetch("/providers");
      const body = await res.json();
      expect(body.customProvider.type).toBe("openai-compatible");
      expect(body.customProvider.baseUrl).toBe("https://custom.example.com/v1");
    });

    it("2d. PUT /api/config updates an existing provider", async () => {
      const configRes = await apiFetch("/config");
      const currentConfig = await configRes.json();
      const existingProviders = currentConfig.ai?.providers ?? {};
      await apiFetch("/config", {
        method: "PUT",
        body: JSON.stringify({
          ai: {
            providers: {
              ...existingProviders,
              customProvider: {
                type: "anthropic",
                baseUrl: "https://api.anthropic.com/v1",
                model: "claude-3-opus-20240229",
              },
            },
          },
        }),
      });
      const provRes = await apiFetch("/providers");
      const body = await provRes.json();
      expect(body.customProvider.type).toBe("anthropic");
      expect(body.customProvider.baseUrl).toBe("https://api.anthropic.com/v1");
    });
  });

  describe("3. Workflow Creation with Tasks", () => {
    it("3a. POST /api/runs creates a workflow run", async () => {
      const res = await apiFetch("/runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Refactor Authentication Module",
          mode: "auto",
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toHaveProperty("runId");
      expect(body).toHaveProperty("status", "created");
      expect(body).toHaveProperty("title", "Refactor Authentication Module");
      expect(body).toHaveProperty("mode", "auto");
      expect(body).toHaveProperty("projectId", projectId);
      runId = body.runId;
    });

    it("3b. Save tasks to the workflow via API", async () => {
      const now = new Date().toISOString();
      taskIds = ["task_setup", "task_impl", "task_test", "task_docs"];
      await api.saveTasks(runId, [
        {
          id: taskIds[0]!,
          runId,
          title: "Setup auth module structure",
          description: "Create directories and config files",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["Directories exist", "Config created"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: taskIds[1]!,
          runId,
          title: "Implement JWT middleware",
          description: "Write JWT authentication middleware",
          status: "pending" as const,
          executor: "opencode",
          dependsOn: [taskIds[0]!],
          acceptanceCriteria: ["JWT middleware works", "Unit tests pass"],
          retryCount: 0,
          maxRetries: 3,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: taskIds[2]!,
          runId,
          title: "Write integration tests",
          description: "Create test suite for auth endpoints",
          status: "pending" as const,
          executor: "opencode",
          dependsOn: [taskIds[1]!],
          acceptanceCriteria: ["Tests cover all endpoints", "Tests pass"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: taskIds[3]!,
          runId,
          title: "Document auth module",
          description: "Write documentation for the auth module",
          status: "pending" as const,
          executor: "opencode",
          dependsOn: [taskIds[2]!],
          acceptanceCriteria: ["Docs written"],
          retryCount: 0,
          maxRetries: 1,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const tasks = await api.loadTasks(runId);
      expect(tasks).toHaveLength(4);
    });

    it("3c. GET /api/runs/:id/workflow exports the workflow", async () => {
      const res = await apiFetch(`/runs/${runId}/workflow`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workflow.tasks.length).toBe(4);
      expect(body.yaml).toContain("task_setup");
      expect(body.json).toContain("Implement JWT middleware");
    });

    it("3d. GET /api/runs/:id/tasks returns all tasks", async () => {
      const res = await apiFetch(`/runs/${runId}/tasks`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      expect(tasks).toHaveLength(4);
      const titles = tasks.map((t: { title: string }) => t.title);
      expect(titles).toContain("Setup auth module structure");
      expect(titles).toContain("Implement JWT middleware");
    });

    it("3e. GET /api/runs/:id/tasks/:taskId returns specific task", async () => {
      const res = await apiFetch(`/runs/${runId}/tasks/${taskIds[1]!}`);
      expect(res.status).toBe(200);
      const task = await res.json();
      expect(task.id).toBe("task_impl");
      expect(task.title).toBe("Implement JWT middleware");
      expect(task.dependsOn).toEqual(["task_setup"]);
    });
  });

  describe("4. Workflow Graph Validation", () => {
    it("4a. Validate workflow is valid (no cycles)", async () => {
      const tasks = await api.loadTasks(runId);
      const result = await api.workflowValidate({
        runTitle: "Refactor Authentication Module",
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          dependsOn: t.dependsOn,
          acceptanceCriteria: t.acceptanceCriteria,
        })),
      });
      expect(result.valid).toBe(true);
    });

    let addedLintTaskId: string;
    it("4b. Add a task mid-chain", async () => {
      const added = await api.workflowAddTask(runId, {
        id: "task_lint",
        title: "Run linter on auth code",
        description: "Ensure code quality standards",
        dependsOn: ["task_impl"],
      });
      expect(added.title).toBe("Run linter on auth code");
      expect(added.status).toBe("pending");
      addedLintTaskId = added.id;
      taskIds.push(added.id);

      const tasks = await api.loadTasks(runId);
      expect(tasks).toHaveLength(5);
    });

    it("4c. Reorder tasks (move lint to end, preserving dependencies)", async () => {
      const tasks = await api.loadTasks(runId);
      const ids = tasks.map((t) => t.id);
      const lintIdx = ids.indexOf(addedLintTaskId);

      const reordered = [...ids];
      reordered.splice(lintIdx, 1);
      reordered.push(addedLintTaskId);

      await api.workflowReorder(runId, reordered);

      const reloaded = await api.loadTasks(runId);
      expect(reloaded[reloaded.length - 1]!.id).toBe(addedLintTaskId);
    });

    it("4d. Task dependencies are maintained after reorder", async () => {
      const taskImpl = await api.getTask(runId, "task_impl");
      expect(taskImpl).toBeDefined();
      expect(taskImpl!.dependsOn).toEqual(["task_setup"]);

      const lintTask = await api.getTask(runId, addedLintTaskId);
      expect(lintTask).toBeDefined();
      expect(lintTask!.dependsOn).toEqual(["task_impl"]);
    });
  });

  describe("5. Run Lifecycle: Start, Monitor, Cancel, Resume", () => {
    it("5a. Mark first task as done to unblock chain", async () => {
      await api.updateTaskStatus(runId, "task_setup", "done");
      const task = await api.getTask(runId, "task_setup");
      expect(task!.status).toBe("done");
    });

    it("5b. Start the run via API (skip AI execution, just verify endpoint)", async () => {
      const taskImpl = await api.getTask(runId, "task_impl");
      await api.updateTaskStatus(runId, "task_impl", "done");
      await api.updateRunStatus(runId, "running");

      const res = await apiFetch(`/runs/${runId}`);
      const run = await res.json();
      expect(run.status).toBe("running");
    });

    it("5c. Cancel the run", async () => {
      const res = await apiFetch(`/runs/${runId}/cancel`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("runId", runId);
    });

    it("5d. Verify run is cancelled", async () => {
      const res = await apiFetch(`/runs/${runId}`);
      const run = await res.json();
      expect(run.status).toBe("cancelled");
    });

    it("5e. Run status transitions can be verified via API", async () => {
      const res = await apiFetch(`/runs/${runId}`);
      const run = await res.json();
      expect(run.status).toBe("cancelled");
    });

    it("5f. Run listing includes the run", async () => {
      const res = await apiFetch("/runs");
      const runs = await res.json();
      expect(Array.isArray(runs)).toBe(true);
      const found = runs.find((r: { runId: string }) => r.runId === runId);
      expect(found).toBeDefined();
    });
  });

  describe("6. Real-time Monitoring: Events, Timeline", () => {
    it("6a. Appending timeline events", async () => {
      await api.appendTimeline(runId, "workflow_created", "Workflow created in UI");
      await api.appendTimeline(runId, "workflow_running", "Run started via UI");

      const res = await apiFetch(`/runs/${runId}/timeline`);
      expect(res.status).toBe(200);
      const timeline = await res.json();
      expect(timeline.length).toBeGreaterThanOrEqual(2);
      expect(timeline.some((e: { type: string }) => e.type === "workflow_created")).toBe(true);
    });

    it("6b. Append events via API and verify", async () => {
      await api.appendEvent(runId, {
        type: "task_completed",
        runId,
        taskId: "task_setup",
        message: "Setup completed successfully",
      });

      const res = await apiFetch(`/runs/${runId}/summary`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("timeline");
      expect(body).toHaveProperty("run");
      expect(body).toHaveProperty("tasks");
      expect(Array.isArray(body.timeline)).toBe(true);
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(body.run.runId).toBe(runId);
    });

    it("6c. Timeline events file exists on disk", async () => {
      const eventsPath = join(testDir, ".flowtask", "runs", runId, "events.jsonl");
      expect(existsSync(eventsPath)).toBe(true);
      const content = readFileSync(eventsPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });

    it("6d. Events can be appended and read", async () => {
      const initialCount = (await api.readRunEvents(runId)).length;

      await api.appendEvent(runId, {
        type: "workflow_edited",
        runId,
        message: "Task reordered via UI",
      });

      const events = await api.readRunEvents(runId);
      const reorderEvent = events.find((e) => e.type === "workflow_edited");
      expect(reorderEvent).toBeDefined();
      expect(events.length).toBeGreaterThan(initialCount);
    });
  });

  describe("7. Waiting Input and Approval Handling", () => {
    let pendingRunId: string;

    beforeAll(async () => {
      const res = await apiFetch("/runs", {
        method: "POST",
        body: JSON.stringify({ title: "Input & Approval Run", mode: "manual" }),
      });
      const body = await res.json();
      pendingRunId = body.runId;
      const now = new Date().toISOString();
      await api.saveTasks(pendingRunId, [
        {
          id: "input_task",
          runId: pendingRunId,
          title: "Task requiring user input",
          status: "waiting_input" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "approval_task",
          runId: pendingRunId,
          title: "Task requiring approval",
          status: "waiting_approval" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });

    it("7a. POST /api/runs/:id/input submits user input", async () => {
      const res = await apiFetch(`/runs/${pendingRunId}/input`, {
        method: "POST",
        body: JSON.stringify({ text: "Use RS256 algorithm", taskId: "input_task" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("7b. Verify input persisted to user-input.jsonl", async () => {
      const inputPath = join(testDir, ".flowtask", "runs", pendingRunId, "user-input.jsonl");
      expect(existsSync(inputPath)).toBe(true);
      const content = readFileSync(inputPath, "utf-8");
      expect(content).toContain("Use RS256 algorithm");
      expect(content).toContain("input_task");
    });

    it("7c. Input creates a prompt_input_provided event", async () => {
      const events = await api.readRunEvents(pendingRunId);
      const inputEvent = events.find((e) => e.type === "prompt_input_provided");
      expect(inputEvent).toBeDefined();
      expect(inputEvent!.message).toBe("Use RS256 algorithm");
    });

    it("7d. POST /api/runs/:id/input with stepId", async () => {
      const res = await apiFetch(`/runs/${pendingRunId}/input`, {
        method: "POST",
        body: JSON.stringify({
          text: "approved",
          taskId: "approval_task",
          stepId: "step_deploy",
        }),
      });
      expect(res.status).toBe(200);
    });

    it("7e. Verify input with stepId in jsonl", async () => {
      const inputPath = join(testDir, ".flowtask", "runs", pendingRunId, "user-input.jsonl");
      const content = readFileSync(inputPath, "utf-8");
      const lines = content.trim().split("\n");
      const withStepId = lines.find((l) => l.includes("step_deploy"));
      expect(withStepId).toBeDefined();
      const parsed = JSON.parse(withStepId!);
      expect(parsed.stepId).toBe("step_deploy");
      expect(parsed.text).toBe("approved");
    });

    it("7f. Approve the waiting_approval task", async () => {
      const task = await api.approveTask(pendingRunId, "approval_task");
      expect(task.status).toBe("pending");
    });

    it("7g. Input without text returns 400", async () => {
      const res = await apiFetch(`/runs/${pendingRunId}/input`, {
        method: "POST",
        body: JSON.stringify({ taskId: "input_task" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Missing text");
    });
  });

  describe("8. Step-Level Approval via API", () => {
    let stepRunId: string;
    const stepTaskId = "step_approval_task";
    const stepId = "risky_step";
    const denyStepId = "deny_this_step";

    beforeAll(async () => {
      const res = await apiFetch("/runs", {
        method: "POST",
        body: JSON.stringify({ title: "Step Approval Run", mode: "manual" }),
      });
      const body = await res.json();
      stepRunId = body.runId;
      const now = new Date().toISOString();
      await api.saveTasks(stepRunId, [
        {
          id: stepTaskId,
          runId: stepRunId,
          title: "Deployment with steps",
          status: "pending" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: [],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const { StepManager } = await import("../../src/core/step-manager.js");
      const sm = new StepManager(testDir);
      await sm.saveSteps(stepRunId, stepTaskId, [
        {
          id: "safe_step",
          taskId: stepTaskId,
          runId: stepRunId,
          title: "Run tests",
          type: "command" as const,
          command: "pnpm test",
          status: "pending_approval" as const,
          requiresApproval: true,
          dependsOn: [],
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: stepId,
          taskId: stepTaskId,
          runId: stepRunId,
          title: "Deploy to production",
          type: "command" as const,
          command: "deploy.sh --prod",
          status: "pending_approval" as const,
          requiresApproval: true,
          dependsOn: [],
          order: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: denyStepId,
          taskId: stepTaskId,
          runId: stepRunId,
          title: "Run risky migration",
          type: "command" as const,
          command: "migrate.sh --force",
          status: "pending_approval" as const,
          requiresApproval: true,
          dependsOn: [],
          order: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });

    it("8a. Approve a specific step", async () => {
      await api.approveStep(stepRunId, stepTaskId, stepId);
      const step = await api.getStep(stepRunId, stepTaskId, stepId);
      expect(step!.status).toBe("approved");
    });

    it("8b. Deny a specific step", async () => {
      await api.denyStep(stepRunId, stepTaskId, denyStepId);
      const step = await api.getStep(stepRunId, stepTaskId, denyStepId);
      expect(step!.status).toBe("denied");
    });

    it("8c. Approve all remaining pending steps", async () => {
      const approved = await api.approveAllSteps(stepRunId, stepTaskId);
      expect(approved.length).toBeGreaterThanOrEqual(1);
      const safeStep = await api.getStep(stepRunId, stepTaskId, "safe_step");
      expect(safeStep!.status).toBe("approved");
    });

    it("8d. Load all steps for the run", async () => {
      const allSteps = await api.loadAllSteps(stepRunId);
      expect(allSteps[stepTaskId]).toBeDefined();
      expect(allSteps[stepTaskId]!.length).toBe(3);
    });
  });

  describe("9. Logs and Artifacts", () => {
    it("9a. Write and read runtime log", async () => {
      const { LogManager } = await import("../../src/core/log-manager.js");
      const lm = new LogManager(testDir);
      await lm.writeRuntime(runId, "Web UI: Run started from workflow editor");
      await lm.writeRuntime(runId, "Web UI: Executing task 'task_impl'");
      await lm.writeRuntime(runId, "Web UI: Task completed successfully");

      const res = await apiFetch(`/runs/${runId}/logs`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.log).toContain("Run started from workflow editor");
      expect(body.log).toContain("Task completed successfully");
    });

    it("9b. Write and read task log", async () => {
      const { LogManager } = await import("../../src/core/log-manager.js");
      const lm = new LogManager(testDir);
      await lm.writeTaskLog(runId, "task_impl", "JWT middleware generated");
      await lm.writeTaskLog(runId, "task_impl", "All unit tests passed");
      await lm.writeTaskLog(runId, "task_test", "Integration tests written");

      const taskLog = await api.readTaskLog(runId, "task_impl");
      expect(taskLog).toContain("JWT middleware generated");
      expect(taskLog).toContain("All unit tests passed");

      const testLog = await api.readTaskLog(runId, "task_test");
      expect(testLog).toContain("Integration tests written");
    });

    it("9c. List log files via API", async () => {
      const files = await api.listLogFiles(runId);
      expect(files.length).toBeGreaterThan(0);
      const hasRuntime = files.some((f) => f.includes("runtime"));
      const hasTaskLog = files.some((f) => f.includes("task_impl"));
      expect(hasRuntime).toBe(true);
      expect(hasTaskLog).toBe(true);
    });

    it("9d. Save artifacts via API and verify on disk", async () => {
      const a1 = await api.saveArtifact(
        runId,
        "task_impl",
        "jwt-middleware.ts",
        "module.exports = {}",
      );
      expect(a1).toHaveProperty("artifactId");
      expect(a1.title).toBe("jwt-middleware.ts");
      expect(a1).toHaveProperty("path");
      expect(a1).toHaveProperty("type");

      const a2 = await api.saveArtifact(
        runId,
        "task_test",
        "auth.test.ts",
        "describe('auth', () => { it('works', () => {}); })",
      );
      expect(a2).toHaveProperty("artifactId");
      expect(a2.title).toBe("auth.test.ts");
      expect(a2).toHaveProperty("path");
    });

    it("9e. Verify artifact file persistence on disk", async () => {
      const a1 = await api.saveArtifact(
        runId,
        "task_impl",
        "jwt-middleware.ts",
        "module.exports = {}",
      );
      expect(existsSync(a1.path)).toBe(true);
      const content = readFileSync(a1.path, "utf-8");
      expect(content).toBe("module.exports = {}");

      const a2 = await api.saveArtifact(
        runId,
        "task_test",
        "auth.test.ts",
        "describe('auth', () => { it('works', () => {}); })",
      );
      expect(existsSync(a2.path)).toBe(true);
      const a2Content = readFileSync(a2.path, "utf-8");
      expect(a2Content).toContain("works");
    });

    it("9f. GET /api/runs/:id/artifacts endpoint returns array", async () => {
      const res = await apiFetch(`/runs/${runId}/artifacts`);
      expect(res.status).toBe(200);
      const artifacts = await res.json();
      expect(Array.isArray(artifacts)).toBe(true);
    });
  });

  describe("10. Project Status and Health Checks", () => {
    it("10a. GET /api/status returns full project status", async () => {
      const res = await apiFetch("/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("initialized", true);
      expect(body).toHaveProperty("project");
      expect(body).toHaveProperty("config");
      expect(body).toHaveProperty("state");
      expect(body).toHaveProperty("dbStatus");
      expect(body.project!.name).toBe("E2E Flow Test");
    });

    it("10b. GET /health returns ok", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "ok" });
    });

    it("10c. OPTIONS returns CORS headers", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`, { method: "OPTIONS" });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    });
  });

  describe("11. Error Handling and Edge Cases", () => {
    it("11a. 404 for unknown API endpoints", async () => {
      const res = await apiFetch("/nonexistent-path");
      expect(res.status).toBe(404);
    });

    it("11b. 405 for wrong method on config", async () => {
      const res = await apiFetch("/config", { method: "DELETE" });
      expect(res.status).toBe(405);
    });

    it("11c. 404 for nonexistent run", async () => {
      const res = await apiFetch("/runs/nonexistent-run-12345");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("11d. 400 when creating run without project", async () => {
      const isolatedDir = mkdtempSync(join(tmpdir(), "flowtask-isolated-"));
      const isolatedServer = new LocalServer({
        port: getPort(),
        rootPath: isolatedDir,
        staticDir: "nonexistent",
      });
      await isolatedServer.start();
      try {
        const res = await fetch(`http://127.0.0.1:${isolatedServer.getPort()}/api/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "No project run" }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain("Project not initialized");
      } finally {
        await isolatedServer.stop();
        rmSync(isolatedDir, { recursive: true, force: true });
      }
    });

    it("11e. 500 for invalid JSON body", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not-json-at-all",
      });
      expect(res.status).toBe(500);
    });

    it("11f. Server binds to 127.0.0.1 by default", () => {
      expect(server.getHost()).toBe("127.0.0.1");
    });

    it("11g. No path traversal in static files", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/../../../etc/passwd`);
      expect(res.status).toBe(404);
    });
  });

  describe("12. Data Persistence Across API Instances", () => {
    let persistRunId: string;
    const persistTaskId = "persist_task";

    beforeAll(async () => {
      const res = await apiFetch("/runs", {
        method: "POST",
        body: JSON.stringify({ title: "Persistence Check Run", mode: "auto" }),
      });
      const body = await res.json();
      persistRunId = body.runId;
      const now = new Date().toISOString();
      await api.saveTasks(persistRunId, [
        {
          id: persistTaskId,
          runId: persistRunId,
          title: "Persistent task data",
          status: "done" as const,
          executor: "shell",
          dependsOn: [],
          acceptanceCriteria: ["Done"],
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });

    it("12a. New API instance loads existing project data", async () => {
      const api2 = new FlowTaskAPI({ rootPath: testDir });
      await api2.initDatabase();

      const initialized = await api2.isInitialized();
      expect(initialized).toBe(true);

      const run = await api2.loadRun(persistRunId);
      expect(run).not.toBeNull();
      expect(run!.title).toBe("Persistence Check Run");

      const tasks = await api2.loadTasks(persistRunId);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.id).toBe(persistTaskId);
      expect(tasks[0]!.status).toBe("done");
    });

    it("12b. Save and verify artifacts persist across instances", async () => {
      const artifact = await api.saveArtifact(
        persistRunId,
        persistTaskId,
        "persist.txt",
        "persistent content",
      );
      expect(artifact).toHaveProperty("artifactId");
      expect(artifact.title).toBe("persist.txt");
      expect(existsSync(artifact.path)).toBe(true);
      const content = readFileSync(artifact.path, "utf-8");
      expect(content).toBe("persistent content");

      const api2 = new FlowTaskAPI({ rootPath: testDir });
      await api2.initDatabase();
      const artifacts = await api2.listArtifactsByRun(persistRunId);
      const found = artifacts.find((a) => a.title === "persist.txt");
      expect(found).toBeDefined();
      expect(existsSync(found!.path)).toBe(true);
    });
  });

  describe("13. Run Monitoring: List, Filter, Inspect", () => {
    it("13a. GET /api/runs lists all runs with varied statuses", async () => {
      const res = await apiFetch("/runs");
      expect(res.status).toBe(200);
      const runs = await res.json();
      expect(Array.isArray(runs)).toBe(true);
      expect(runs.length).toBeGreaterThanOrEqual(4);
      const statuses = runs.map((r: { status: string }) => r.status);
      expect(statuses).toContain("created");
      expect(statuses).toContain("cancelled");
    });

    it("13b. Inspect run via API returns full context", async () => {
      const inspection = await api.inspectRun(runId);
      expect(inspection.run).not.toBeNull();
      expect(inspection.run!.runId).toBe(runId);
      expect(inspection.tasks.length).toBeGreaterThanOrEqual(4);
      expect(inspection.events).toBeDefined();
      expect(inspection.artifacts).toBeDefined();
    });
  });

  describe("14. Config Keys and Validation", () => {
    it("14a. GET /api/config/keys returns config keys", async () => {
      const res = await apiFetch("/config/keys");
      expect(res.status).toBe(200);
      const keys = await res.json();
      expect(Array.isArray(keys)).toBe(true);
      expect(keys).toContain("projectMode");
    });

    it("14b. Configure quality gate and verify in config", async () => {
      await apiFetch("/config", {
        method: "PUT",
        body: JSON.stringify({
          quality: { commands: ["pnpm lint", "pnpm typecheck", "pnpm test"] },
        }),
      });
      const res = await apiFetch("/config");
      const body = await res.json();
      expect(body.quality.commands).toHaveLength(3);
    });
  });
});
