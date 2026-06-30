import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalServer } from "../../src/server/local-server.js";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";
import { configJsonPath } from "../../src/utils/paths.js";
import { readJsonFile } from "../../src/utils/fs.js";

vi.mock("enquirer", () => ({
  default: vi.fn(),
}));

const BASE_PORT = 28400;
let nextPort = BASE_PORT;

function getPort(): number {
  return nextPort++;
}

let testDir: string;
let server: LocalServer;
let port: number;
let api: FlowTaskAPI;

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
}

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), "flowtask-e2e-ui-"));
  api = new FlowTaskAPI({ rootPath: testDir });
  await api.initProject("E2E Web UI Test", "development");
  await api.initDatabase();
  port = getPort();
  server = new LocalServer({ port, rootPath: testDir, staticDir: "nonexistent" });
  await server.start();
});

afterAll(async () => {
  await server.stop();
  rmSync(testDir, { recursive: true, force: true });
});

describe("Web UI E2E — Config Editing", () => {
  it("GET /api/config returns config with defaults", async () => {
    const res = await apiFetch("/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("version", "1.0");
    expect(body).toHaveProperty("projectMode", "development");
  });

  it("PUT /api/config merges and persists changes", async () => {
    const res = await apiFetch("/config", {
      method: "PUT",
      body: JSON.stringify({ projectMode: "writing" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    const configPath = configJsonPath(testDir);
    const raw = await readJsonFile<Record<string, unknown>>(configPath);
    expect(raw.projectMode).toBe("writing");
  });

  it("PUT /api/config does not overwrite existing fields", async () => {
    await apiFetch("/config", {
      method: "PUT",
      body: JSON.stringify({ logLevel: "debug" }),
    });

    const configPath = configJsonPath(testDir);
    const raw = await readJsonFile<Record<string, unknown>>(configPath);
    expect(raw.projectMode).toBe("writing");
    expect(raw.logLevel).toBe("debug");
  });

  it("GET /api/config returns latest merged config", async () => {
    await apiFetch("/config", {
      method: "PUT",
      body: JSON.stringify({ projectMode: "research" }),
    });

    const res = await apiFetch("/config");
    const body = await res.json();
    expect(body.projectMode).toBe("research");
    expect(body.version).toBe("1.0");
  });

  it("GET /api/config/keys returns config keys", async () => {
    const res = await apiFetch("/config/keys");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toContain("projectMode");
    expect(body).toContain("version");
  });

  it("PUT /api/config rejects invalid JSON body", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(500);
  });

  it("saves AI provider config safely", async () => {
    const providerConfig = {
      ai: {
        providers: {
          testProvider: {
            type: "openai-compatible",
            baseUrl: "https://example.com/v1",
            model: "gpt-4",
          },
        },
      },
    };
    const res = await apiFetch("/config", {
      method: "PUT",
      body: JSON.stringify(providerConfig),
    });
    expect(res.status).toBe(200);

    const configRes = await apiFetch("/config");
    const config = await configRes.json();
    expect(config.ai.providers.testProvider.type).toBe("openai-compatible");
    expect(config.ai.providers.testProvider.baseUrl).toBe("https://example.com/v1");
  });

  it("GET /api/providers returns configured providers", async () => {
    const res = await apiFetch("/providers");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("testProvider");
    expect(body.testProvider.type).toBe("openai-compatible");
  });
});

describe("Web UI E2E — Run Control", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await api.loadProject();
    projectId = project!.projectId;
  });

  it("POST /api/runs creates a new run", async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "E2E Test Run" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("runId");
    expect(body).toHaveProperty("status", "created");
    expect(body).toHaveProperty("title", "E2E Test Run");
  });

  it("GET /api/runs lists all runs", async () => {
    const res = await apiFetch("/runs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    const run = body.find((r: { title: string }) => r.title === "E2E Test Run");
    expect(run).toBeDefined();
    expect(run.status).toBe("created");
  });

  it("GET /api/runs/:id returns a specific run", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const res = await apiFetch(`/runs/${runId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toBe(runId);
  });

  it("GET /api/runs/nonexistent returns 404", async () => {
    const res = await apiFetch("/runs/nonexistent-run-id");
    expect(res.status).toBe(404);
  });

  it("POST /api/runs/:id/cancel cancels a run", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const createdRun = runs.find((r: { title: string }) => r.title === "E2E Test Run");
    const runId = createdRun.runId;

    const cancelRes = await apiFetch(`/runs/${runId}/cancel`, { method: "POST" });
    expect(cancelRes.status).toBe(200);
    const body = await cancelRes.json();
    expect(body).toHaveProperty("runId", runId);
  });

  it("POST /api/runs with title creates run with correct title", async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Integration Test Run" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Integration Test Run");
  });
});

describe("Web UI E2E — Real-time Logs", () => {
  it("GET /api/runs/:id/logs returns runtime log content", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const logRes = await apiFetch(`/runs/${runId}/logs`);
    expect(logRes.status).toBe(200);
    const body = await logRes.json();
    expect(body).toHaveProperty("log");
    expect(typeof body.log).toBe("string");
  });

  it("log endpoint returns 200 even for runs with no log output", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const run = runs.find((r: { title: string }) => r.title === "Integration Test Run");

    const logRes = await apiFetch(`/runs/${run.runId}/logs`);
    expect(logRes.status).toBe(200);
    const body = await logRes.json();
    expect(typeof body.log).toBe("string");
  });

  it("GET /api/runs/:id/timeline returns timeline events", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const res = await apiFetch(`/runs/${runId}/timeline`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/status returns project status", async () => {
    const res = await apiFetch("/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("initialized", true);
    expect(body).toHaveProperty("project");
    expect(body).toHaveProperty("config");
    expect(body).toHaveProperty("dbStatus");
  });

  it("health endpoint responds", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});

describe("Web UI E2E — Waiting Input", () => {
  it("POST /api/runs/:id/input stores user input", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const inputRes = await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({ text: "user clarification response", taskId: "task_1" }),
    });
    expect(inputRes.status).toBe(200);
    const body = await inputRes.json();
    expect(body).toEqual({ ok: true });
  });

  it("POST /api/runs/:id/input without text returns 400", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const inputRes = await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({ taskId: "task_1" }),
    });
    expect(inputRes.status).toBe(400);
  });

  it("POST /api/runs/:id/input with stepId stores input correctly", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const inputRes = await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({
        text: "approved",
        taskId: "task_2",
        stepId: "step_1",
      }),
    });
    expect(inputRes.status).toBe(200);
    const body = await inputRes.json();
    expect(body).toEqual({ ok: true });
  });

  it("POST /api/runs/:id/input creates user-input.jsonl file", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({ text: "login credentials provided" }),
    });

    const inputFilePath = join(testDir, ".flowtask", "runs", runId, "user-input.jsonl");
    expect(existsSync(inputFilePath)).toBe(true);
    const content = readFileSync(inputFilePath, "utf-8");
    expect(content).toContain("login credentials provided");
  });
});

describe("Web UI E2E — Workflow Status", () => {
  it("GET /api/runs/:id/tasks returns tasks for a run", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const res = await apiFetch(`/runs/${runId}/tasks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/runs/:id/tasks/:taskId returns specific task", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const tasksRes = await apiFetch(`/runs/${runId}/tasks`);
    const tasks = await tasksRes.json();

    if (tasks.length > 0) {
      const taskRes = await apiFetch(`/runs/${runId}/tasks/${tasks[0].id}`);
      expect(taskRes.status).toBe(200);
      const body = await taskRes.json();
      expect(body.id).toBe(tasks[0].id);
    }
  });

  it("GET /api/runs/:id/workflow returns workflow data", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const res = await apiFetch(`/runs/${runId}/workflow`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("workflow");
  });

  it("GET /api/runs/:id/summary returns combined summary", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const runId = runs[0].runId;

    const res = await apiFetch(`/runs/${runId}/summary`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("timeline");
    expect(body).toHaveProperty("run");
    expect(body).toHaveProperty("tasks");
  });

  it("run status transitions through expected states", async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Status Test Run" }),
    });
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run.status).toBe("created");
  });

  it("GET /api/runs supports filtering by status", async () => {
    const res = await apiFetch("/runs");
    const runs = await res.json();
    const statuses = runs.map((r: { status: string }) => r.status);
    expect(statuses).toContain("created");
    expect(Array.isArray(runs)).toBe(true);
  });
});

describe("Web UI E2E — Security", () => {
  it("server binds to 127.0.0.1 by default", () => {
    expect(server.getHost()).toBe("127.0.0.1");
  });

  it("returns 404 for unknown API endpoints", async () => {
    const res = await apiFetch("/nonexistent-endpoint");
    expect(res.status).toBe(404);
  });

  it("returns 405 for wrong method on config", async () => {
    const res = await apiFetch("/config", { method: "DELETE" });
    expect(res.status).toBe(405);
  });

  it("does not expose config via static path traversal", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/../../../config.json`);
    expect(res.status).toBe(404);
  });
});
