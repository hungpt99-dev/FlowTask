import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalServer } from "../../src/server/local-server.js";
import { FlowTaskAPI } from "../../src/api/flowtask-api.js";

const BASE_PORT = 28800;
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
  testDir = mkdtempSync(join(tmpdir(), "flowtask-integration-"));
  api = new FlowTaskAPI({ rootPath: testDir });
  await api.initProject("Integration Test", "development");
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

describe("API Integration — Server Startup & Health", () => {
  it("server starts and binds to default host", () => {
    expect(server.getHost()).toBe("127.0.0.1");
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
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

  it("OPTIONS returns 204 with CORS headers", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns 405 for wrong method on /api/status", async () => {
    const res = await apiFetch("/status", { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown API endpoints", async () => {
    const res = await apiFetch("/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("API Integration — Config Management", () => {
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
  });

  it("PUT /api/config does not overwrite existing fields", async () => {
    await apiFetch("/config", {
      method: "PUT",
      body: JSON.stringify({ logLevel: "debug" }),
    });
    const configRes = await apiFetch("/config");
    const config = await configRes.json();
    expect(config.projectMode).toBe("writing");
    expect(config.logLevel).toBe("debug");
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

  it("PUT /api/config with empty object returns ok", async () => {
    const res = await apiFetch("/config", {
      method: "PUT",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("returns 405 for DELETE on /api/config", async () => {
    const res = await apiFetch("/config", { method: "DELETE" });
    expect(res.status).toBe(405);
  });

  it("GET /api/providers returns default provider config", async () => {
    const res = await apiFetch("/providers");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("openai");
    expect(body.openai).toHaveProperty("type", "openai");
    expect(body.openai).toHaveProperty("baseUrl", "https://api.openai.com/v1");
  });
});

describe("API Integration — Workflow CRUD (Run-based)", () => {
  const createdRunIds: string[] = [];

  it("POST /api/runs creates a new run", async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Integration Test Run" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("runId");
    expect(body).toHaveProperty("status", "created");
    expect(body).toHaveProperty("title", "Integration Test Run");
    expect(body).toHaveProperty("projectId", projectId);
    expect(body).toHaveProperty("mode");
    expect(body).toHaveProperty("createdAt");
    expect(body).toHaveProperty("updatedAt");
    createdRunIds.push(body.runId);
  });

  it("POST /api/runs with custom mode creates run with that mode", async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Manual Mode Run", mode: "manual" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mode).toBe("manual");
    createdRunIds.push(body.runId);
  });

  it("GET /api/runs lists all runs", async () => {
    const res = await apiFetch("/runs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
    const run = body.find((r: { title: string }) => r.title === "Integration Test Run");
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
    expect(body).toHaveProperty("title");
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("projectId");
  });

  it("GET /api/runs/nonexistent returns 404", async () => {
    const res = await apiFetch("/runs/nonexistent-run-id");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("POST /api/runs with title creates run with correct title", async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Another Test Run" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Another Test Run");
    createdRunIds.push(body.runId);
  });
});

describe("API Integration — Run Lifecycle", () => {
  let runId: string;

  beforeAll(async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Lifecycle Test Run" }),
    });
    const body = await res.json();
    runId = body.runId;
  });

  it("POST /api/runs/:id/cancel cancels a run", async () => {
    const res = await apiFetch(`/runs/${runId}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("runId", runId);
    expect(body).toHaveProperty("status");
  });

  it("cancelled run status is updated in list", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    const cancelled = runs.find((r: { runId: string }) => r.runId === runId);
    expect(cancelled).toBeDefined();
  });

  it("POST /api/runs/:id/resume resumes a run", async () => {
    const res = await apiFetch(`/runs/${runId}/resume`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("success");
    expect(body).toHaveProperty("paused");
  });

  it("POST /api/runs/:id/cancel on nonexistent run returns 500", async () => {
    const res = await apiFetch("/runs/nonexistent/cancel", { method: "POST" });
    expect(res.status).toBe(500);
  });

  it("POST /api/runs/:id/resume with options", async () => {
    const res = await apiFetch(`/runs/${runId}/resume`, {
      method: "POST",
      body: JSON.stringify({ quality: true, skipValidation: false }),
    });
    expect(res.status).toBe(200);
  });
});

describe("API Integration — Tasks & Timeline", () => {
  let runId: string;

  beforeAll(async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Tasks Timeline Run" }),
    });
    const body = await res.json();
    runId = body.runId;
  });

  it("GET /api/runs/:id/tasks returns empty task list for new run", async () => {
    const res = await apiFetch(`/runs/${runId}/tasks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("GET /api/runs/:id/timeline returns timeline events", async () => {
    const res = await apiFetch(`/runs/${runId}/timeline`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/runs/:id/workflow exports workflow", async () => {
    const res = await apiFetch(`/runs/${runId}/workflow`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("workflow");
  });

  it("GET /api/runs/:id/summary returns combined summary", async () => {
    const res = await apiFetch(`/runs/${runId}/summary`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("timeline");
    expect(body).toHaveProperty("run");
    expect(body).toHaveProperty("tasks");
  });

  it("GET /api/runs/:id/artifacts returns empty list for new run", async () => {
    const res = await apiFetch(`/runs/${runId}/artifacts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("GET /api/runs/:id/tasks/:taskId returns 404 for nonexistent task", async () => {
    const res = await apiFetch(`/runs/${runId}/tasks/nonexistent-task`);
    expect(res.status).toBe(404);
  });

  it("timeline supports appending events via API", async () => {
    await api.appendTimeline(runId, "workflow_created", "Run created via API");
    const res = await apiFetch(`/runs/${runId}/timeline`);
    const timeline = await res.json();
    expect(timeline.length).toBeGreaterThanOrEqual(1);
    expect(timeline.some((e: { type: string }) => e.type === "workflow_created")).toBe(true);
  });

  it("summary returns updated data after events", async () => {
    const res = await apiFetch(`/runs/${runId}/summary`);
    const body = await res.json();
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(body.timeline.length).toBeGreaterThanOrEqual(1);
  });
});

describe("API Integration — Logs & Real-time", () => {
  let runId: string;

  beforeAll(async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Logs SSE Run" }),
    });
    const body = await res.json();
    runId = body.runId;
  });

  it("GET /api/runs/:id/logs returns runtime log content", async () => {
    const res = await apiFetch(`/runs/${runId}/logs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("log");
    expect(typeof body.log).toBe("string");
  });

  it("log endpoint returns 200 even for runs with no log output", async () => {
    const res = await apiFetch(`/runs/${runId}/logs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.log).toBe("string");
    expect(body.log).toBe("");
  });

  it("events can be appended and read via the API", async () => {
    await api.appendEvent(runId, {
      type: "run_started",
      runId,
      message: "Test event for monitoring",
    });
    await api.appendEvent(runId, {
      type: "task_started",
      runId,
      taskId: "task_1",
      message: "Started task 1",
    });
    const events = await api.readRunEvents(runId);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === "run_started")).toBe(true);
    expect(events.some((e) => e.type === "task_started")).toBe(true);
  });

  it("events JSONL file is created on disk", async () => {
    const eventsPath = join(testDir, ".flowtask", "runs", runId, "events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);
    const content = readFileSync(eventsPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

describe("API Integration — Input & Approval", () => {
  let runId: string;

  beforeAll(async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Input Approval Run" }),
    });
    const body = await res.json();
    runId = body.runId;
  });

  it("POST /api/runs/:id/input stores user input", async () => {
    const res = await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({ text: "user clarification response", taskId: "task_1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("POST /api/runs/:id/input creates user-input.jsonl file", async () => {
    await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({ text: "login credentials provided" }),
    });
    const inputFilePath = join(testDir, ".flowtask", "runs", runId, "user-input.jsonl");
    expect(existsSync(inputFilePath)).toBe(true);
    const content = readFileSync(inputFilePath, "utf-8");
    expect(content).toContain("login credentials provided");
  });

  it("POST /api/runs/:id/input without text returns 400", async () => {
    const res = await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({ taskId: "task_1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toContain("Missing text");
  });

  it("POST /api/runs/:id/input with stepId stores input correctly", async () => {
    const res = await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({
        text: "approved",
        taskId: "task_2",
        stepId: "step_1",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("user-input.jsonl contains input entries with stepId", async () => {
    const inputFilePath = join(testDir, ".flowtask", "runs", runId, "user-input.jsonl");
    const content = readFileSync(inputFilePath, "utf-8");
    const lines = content.trim().split("\n");
    const withStepId = lines.find((l) => l.includes("step_1"));
    expect(withStepId).toBeDefined();
    const parsed = JSON.parse(withStepId!);
    expect(parsed.stepId).toBe("step_1");
    expect(parsed.text).toBe("approved");
  });

  it("POST /api/runs/:id/input appends multiple entries to user-input.jsonl", async () => {
    await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({ text: "first input" }),
    });
    await apiFetch(`/runs/${runId}/input`, {
      method: "POST",
      body: JSON.stringify({ text: "second input" }),
    });
    const inputFilePath = join(testDir, ".flowtask", "runs", runId, "user-input.jsonl");
    const content = readFileSync(inputFilePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(content).toContain("first input");
    expect(content).toContain("second input");
  });
});

describe("API Integration — Data Shape Compatibility with UI", () => {
  it("run response shape matches RunIndexEntry expected by UI", async () => {
    const res = await apiFetch("/runs", {
      method: "POST",
      body: JSON.stringify({ title: "Shape Check Run" }),
    });
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run).toMatchObject({
      runId: expect.any(String),
      title: "Shape Check Run",
      status: "created",
      projectId: expect.any(String),
    });
    expect(typeof run.createdAt).toBe("string");
    expect(typeof run.updatedAt).toBe("string");
  });

  it("run list entries match RunIndexEntry shape used by RunMonitor list", async () => {
    const res = await apiFetch("/runs");
    const runs = await res.json();
    for (const entry of runs) {
      expect(entry).toMatchObject({
        runId: expect.any(String),
        title: expect.any(String),
        status: expect.any(String),
      });
    }
  });

  it("task list entries match Task shape used by RunMonitor detail", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    if (runs.length > 0) {
      const tasksRes = await apiFetch(`/runs/${runs[0].runId}/tasks`);
      const tasks = await tasksRes.json();
      expect(Array.isArray(tasks)).toBe(true);
      for (const task of tasks) {
        expect(task).toHaveProperty("id");
        expect(task).toHaveProperty("runId");
        expect(task).toHaveProperty("title");
        expect(task).toHaveProperty("status");
      }
    }
  });

  it("timeline entries match FlowTaskEvent shape expected by UI", async () => {
    const listRes = await apiFetch("/runs");
    const runs = await listRes.json();
    if (runs.length > 0) {
      const timelineRes = await apiFetch(`/runs/${runs[0].runId}/timeline`);
      const timeline = await timelineRes.json();
      expect(Array.isArray(timeline)).toBe(true);
      for (const event of timeline) {
        expect(event).toHaveProperty("type");
        expect(event).toHaveProperty("runId");
        expect(typeof event.type).toBe("string");
      }
    }
  });
});

describe("API Integration — Error Handling & Edge Cases", () => {
  it("returns 500 for invalid request body on config", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{{broken",
    });
    expect(res.status).toBe(500);
  });

  it("returns 404 for malformed run routes", async () => {
    const res = await apiFetch("/runs/run-id-123/unknown-route");
    expect(res.status).toBe(404);
  });

  it("returns 405 for wrong method on providers endpoint", async () => {
    const res = await apiFetch("/providers", { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("returns proper error JSON format", async () => {
    const res = await apiFetch("/runs/nonexistent-run-id");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("handles missing project for run creation gracefully", async () => {
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
});

describe("API Integration — Provider Config Round Trip", () => {
  it("configures and reads back AI providers", async () => {
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
    const putRes = await apiFetch("/config", {
      method: "PUT",
      body: JSON.stringify(providerConfig),
    });
    expect(putRes.status).toBe(200);

    const getRes = await apiFetch("/config");
    const config = await getRes.json();
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
