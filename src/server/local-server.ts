import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { FlowTaskAPI } from "../api/flowtask-api.js";
import type { RunMode } from "../schemas/run.schema.js";
import type { PlannerMode } from "../planner/planner-registry.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  rootPath?: string;
  staticDir?: string;
  allowPublicExposure?: boolean;
}

interface SseConnection {
  runId: string;
  res: http.ServerResponse;
}

const DEFAULT_PORT = 3487;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_STATIC_DIR = "dist/ui";

export class LocalServer {
  private options: Required<ServerOptions>;
  private server: http.Server;
  private api: FlowTaskAPI;
  private sseConnections: SseConnection[] = [];
  private unsubscribers: Map<string, () => void> = new Map();

  constructor(options: ServerOptions = {}) {
    this.options = {
      port: options.port ?? DEFAULT_PORT,
      host: options.allowPublicExposure ? (options.host ?? DEFAULT_HOST) : DEFAULT_HOST,
      rootPath: options.rootPath ?? process.cwd(),
      staticDir: options.staticDir ?? DEFAULT_STATIC_DIR,
      allowPublicExposure: options.allowPublicExposure ?? false,
    };
    this.api = new FlowTaskAPI({ rootPath: this.options.rootPath });
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  private getStaticDir(): string {
    return path.resolve(this.options.rootPath, this.options.staticDir);
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.options.port, this.options.host, () => {
        console.log(
          `FlowTask UI server listening on http://${this.options.host}:${this.options.port}`,
        );
        if (!this.options.allowPublicExposure) {
          console.log(
            "Bound to localhost only (secure). Set allowPublicExposure to expose publicly.",
          );
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers.values()) {
      unsub();
    }
    this.unsubscribers.clear();
    this.sseConnections = [];
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  getPort(): number {
    return this.options.port;
  }

  getHost(): string {
    return this.options.host;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname;
      const method = req.method ?? "GET";

      if (pathname.startsWith("/api/")) {
        await this.handleApiRequest(method, pathname, url, req, res);
        return;
      }

      if (pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      await this.serveStatic(pathname === "/" ? "/index.html" : pathname, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  }

  private parsePath(pathname: string): { parts: string[]; query: URLSearchParams } {
    const url = new URL(pathname, "http://localhost");
    return { parts: url.pathname.split("/").filter(Boolean), query: url.searchParams };
  }

  private async handleApiRequest(
    method: string,
    pathname: string,
    url: URL,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const { parts } = this.parsePath(pathname);
    const [, ...rest] = parts;

    res.setHeader("Content-Type", "application/json");

    const sendJson = (status: number, data: unknown) => {
      if (!res.headersSent) {
        res.writeHead(status);
      }
      res.end(JSON.stringify(data));
    };

    const sendError = (status: number, message: string) => {
      sendJson(status, { error: message });
    };

    const readBody = (): Promise<Record<string, unknown>> =>
      new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          if (!raw) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(raw) as Record<string, unknown>);
          } catch {
            reject(new Error("Invalid JSON body"));
          }
        });
        req.on("error", reject);
      });

    try {
      // ── SSE event stream ──────────────────────────────
      if (rest.length >= 2 && rest[0] === "runs" && rest[2] === "events" && method === "GET") {
        const runId = rest[1]!;
        this.handleSse(runId, req, res);
        return;
      }

      // ── API routing ───────────────────────────────────
      switch (rest[0]) {
        // GET /api/status
        case "status": {
          if (method !== "GET") {
            sendError(405, "Method not allowed");
            return;
          }
          const status = await this.api.getProjectStatus();
          sendJson(200, status);
          return;
        }

        // GET/PUT /api/config
        case "config": {
          if (rest.length === 1) {
            if (method === "GET") {
              const config = await this.api.getConfig();
              sendJson(200, config);
              return;
            }
            if (method === "PUT") {
              const body = await readBody();
              const { atomicWriteJsonFile, readJsonFile, fileExists } =
                await import("../utils/fs.js");
              const { configJsonPath } = await import("../utils/paths.js");
              const cPath = configJsonPath(this.options.rootPath);
              let config: Record<string, unknown> = {};
              if (await fileExists(cPath)) {
                config = await readJsonFile<Record<string, unknown>>(cPath);
              }
              const merged = { ...config, ...body };
              await atomicWriteJsonFile(cPath, merged);
              sendJson(200, { ok: true });
              return;
            }
            sendError(405, "Method not allowed");
            return;
          }
          if (rest.length === 2 && rest[1] === "keys" && method === "GET") {
            const keys = await this.api.listConfigKeys();
            sendJson(200, keys);
            return;
          }
          sendError(404, "Not found");
          return;
        }

        // GET /api/providers
        case "providers": {
          if (method !== "GET") {
            sendError(405, "Method not allowed");
            return;
          }
          const config = await this.api.getConfig();
          sendJson(200, config.ai?.providers ?? {});
          return;
        }

        // /api/runs/*
        case "runs": {
          await this.handleRunRoutes(method, rest, url, req, res, sendJson, sendError, readBody);
          return;
        }

        default:
          sendError(404, `Unknown API endpoint: ${pathname}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(500, message);
    }
  }

  private async handleRunRoutes(
    method: string,
    rest: string[],
    url: URL,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sendJson: (status: number, data: unknown) => void,
    sendError: (status: number, message: string) => void,
    readBody: () => Promise<Record<string, unknown>>,
  ): Promise<void> {
    // GET /api/runs
    if (rest.length === 1 && method === "GET") {
      const runs = await this.api.listRuns();
      sendJson(200, runs);
      return;
    }

    // POST /api/runs
    if (rest.length === 1 && method === "POST") {
      const body = await readBody();
      const project = await this.api.loadProject();
      if (!project) {
        sendError(400, "Project not initialized");
        return;
      }
      const run = await this.api.createRun(
        project.projectId,
        (body.title as string) ?? "Web UI Run",
        body.mode as RunMode | undefined,
      );
      sendJson(201, run);
      return;
    }

    if (rest.length < 2) {
      sendError(404, "Not found");
      return;
    }

    const runId = rest[1]!;

    // GET /api/runs/:id
    if (rest.length === 2 && method === "GET") {
      const run = await this.api.loadRun(runId);
      if (!run) {
        sendError(404, "Run not found");
        return;
      }
      sendJson(200, run);
      return;
    }

    // POST /api/runs/:id/start
    if (rest.length === 3 && rest[2] === "start" && method === "POST") {
      const body = await readBody();
      const prompt = (body.prompt as string) ?? "";
      const result = await this.api.executeRun(prompt, {
        mode: body.mode as RunMode | undefined,
        plannerMode: body.plannerMode as PlannerMode | undefined,
      });
      sendJson(200, result);
      return;
    }

    // POST /api/runs/:id/cancel
    if (rest.length === 3 && rest[2] === "cancel" && method === "POST") {
      const run = await this.api.cancelRun(runId);
      sendJson(200, run);
      return;
    }

    // POST /api/runs/:id/resume
    if (rest.length === 3 && rest[2] === "resume" && method === "POST") {
      const body = await readBody();
      const result = await this.api.resumeRun(runId, !!body.quality, !!body.skipValidation);
      sendJson(200, { success: result.success, paused: result.paused });
      return;
    }

    // GET /api/runs/:id/input?type=
    // POST /api/runs/:id/input
    if (rest.length === 3 && rest[2] === "input") {
      if (method === "POST") {
        const body = await readBody();
        const text = body.text as string | undefined;
        const taskId = body.taskId as string | undefined;
        const stepId = body.stepId as string | undefined;
        if (!text) {
          sendError(400, "Missing text field");
          return;
        }
        await this.api.appendEvent(runId, {
          type: "prompt_input_provided",
          runId,
          taskId: taskId ?? undefined,
          message: text,
        });
        const { appendToFile } = await import("../utils/fs.js");
        const { getRunDir } = await import("../utils/paths.js");
        const inputPath = path.join(getRunDir(this.options.rootPath, runId), "user-input.jsonl");
        await appendToFile(
          inputPath,
          JSON.stringify({
            time: new Date().toISOString(),
            runId,
            taskId: taskId ?? undefined,
            stepId: stepId ?? undefined,
            text,
          }) + "\n",
        );
        sendJson(200, { ok: true });
        return;
      }
      sendError(405, "Method not allowed");
      return;
    }

    // GET /api/runs/:id/logs
    if (rest.length === 3 && rest[2] === "logs" && method === "GET") {
      const runLog = await this.api.readRuntimeLog(runId);
      sendJson(200, { log: runLog });
      return;
    }

    // GET /api/runs/:id/tasks
    if (rest.length === 3 && rest[2] === "tasks" && method === "GET") {
      const tasks = await this.api.loadTasks(runId);
      sendJson(200, tasks);
      return;
    }

    // GET /api/runs/:id/tasks/:taskId
    if (rest.length === 4 && rest[2] === "tasks" && method === "GET") {
      const task = await this.api.getTask(runId, rest[3]!);
      if (!task) {
        sendError(404, "Task not found");
        return;
      }
      sendJson(200, task);
      return;
    }

    // GET /api/runs/:id/timeline
    if (rest.length === 3 && rest[2] === "timeline" && method === "GET") {
      const timeline = await this.api.getTimeline(runId);
      sendJson(200, timeline);
      return;
    }

    // GET /api/runs/:id/workflow
    if (rest.length === 3 && rest[2] === "workflow" && method === "GET") {
      const workflow = await this.api.exportWorkflow(runId);
      sendJson(200, workflow);
      return;
    }

    // GET /api/runs/:id/summary
    if (rest.length === 3 && rest[2] === "summary" && method === "GET") {
      const timeline = await this.api.getTimeline(runId);
      const run = await this.api.loadRun(runId);
      const tasks = await this.api.loadTasks(runId);
      sendJson(200, { timeline, run, tasks });
      return;
    }

    sendError(404, `Unknown run endpoint: /api/runs/${rest.slice(2).join("/")}`);
  }

  private handleSse(runId: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 15000);

    const unsub = this.api.subscribeToRun(runId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    this.sseConnections.push({ runId, res });
    this.unsubscribers.set(runId, unsub);

    req.on("close", () => {
      clearInterval(heartbeat);
      this.sseConnections = this.sseConnections.filter((c) => c.res !== res);
      unsub();
    });
  }

  private mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map": "application/json",
  };

  private async serveStatic(urlPath: string, res: http.ServerResponse): Promise<void> {
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    const fullPath = path.join(this.getStaticDir(), safePath);

    if (!fullPath.startsWith(this.getStaticDir())) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isFile()) {
        throw new Error("Not a file");
      }

      const ext = path.extname(fullPath).toLowerCase();
      const mimeType = this.mimeTypes[ext] ?? "application/octet-stream";

      if (ext === ".html" || ext === ".js") {
        res.writeHead(200, {
          "Content-Type": mimeType,
          "Cache-Control": "no-cache",
        });
      } else {
        res.writeHead(200, { "Content-Type": mimeType });
      }

      const stream = fs.createReadStream(fullPath);
      stream.pipe(res);
      stream.on("error", () => {
        res.writeHead(500);
        res.end("Internal error");
      });
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
}

export function createServer(options: ServerOptions = {}): LocalServer {
  return new LocalServer(options);
}
