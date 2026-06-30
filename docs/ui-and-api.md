# FlowTask Local Web UI and Public API

> **Status:** maintained | **Last reviewed:** 2026-06-30 | **Audience:** users, developers, integrators

FlowTask includes a local web UI dashboard and a public HTTP API for managing workflows, monitoring runs, and integrating with third-party tools. The API is stable, CORS-enabled, and documented to support custom UIs, scripts, CI/CD pipelines, and external agents.

---

## Table of Contents

- [Setup](#setup)
- [Starting the Server](#starting-the-server)
- [Web UI Overview](#web-ui-overview)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Integration Tips](#integration-tips)

---

## Setup

### Build the UI

```bash
pnpm build:ui
```

This compiles the React application (Vite + React 19 + React Router 7) from `src/ui/` into `dist/ui/` — a set of static HTML, JS, and CSS assets served by the LocalServer.

### Dependencies

The web UI depends on the same project initialization as the CLI. Before starting the server:

```bash
pnpm dev init --name "My Project" --mode development
```

---

## Starting the Server

The LocalServer is a pure Node.js HTTP server (no Express required) that serves the static UI and exposes the REST API on a single port.

### Programmatic Start

```typescript
import { createServer } from "./src/server/local-server.js";

const server = createServer({
  port: 3487,
  host: "127.0.0.1",
  rootPath: process.cwd(),
  staticDir: "dist/ui",
});

await server.start();
console.log(`FlowTask UI: http://${server.getHost()}:${server.getPort()}`);
```

### CLI Integration

The server is also available via the `createServer` export. The default config:

| Option                | Default         | Description                                         |
| --------------------- | --------------- | --------------------------------------------------- |
| `port`                | `3487`          | HTTP server port                                    |
| `host`                | `127.0.0.1`     | Bind address (local-only by default)                |
| `rootPath`            | `process.cwd()` | Project root directory                              |
| `staticDir`           | `dist/ui`       | Directory for static UI assets                      |
| `allowPublicExposure` | `false`         | If `true`, binds to configured host (not localhost) |
| `corsOrigins`         | `*`             | CORS `Access-Control-Allow-Origin` header value     |

### Development Mode

For hot-reload UI development:

```bash
pnpm dev:ui
```

Then run the API server separately on the default port (`3487`). The Vite dev server (port `5173`) can proxy API calls to the LocalServer.

---

## Web UI Overview

The web UI is a single-page application (SPA) with client-side routing. It is served at `http://127.0.0.1:3487/` by default.

### Pages

| Route              | Component          | Description                                     |
| ------------------ | ------------------ | ----------------------------------------------- |
| `/`                | DashboardPage      | Summary cards, current workflow, recent runs    |
| `/workflow-editor` | WorkflowEditor     | Edit tasks, acceptance criteria, dependencies   |
| `/workflow-graph`  | WorkflowGraph      | Visual DAG of task dependencies                 |
| `/orchestrator`    | OrchestratorConfig | Planner mode, validation, limits, executors     |
| `/ai-providers`    | AIProviderConfig   | AI provider list (OpenAI, Anthropic, Gemini...) |
| `/run-monitor`     | RunMonitor         | Real-time run monitoring, logs, SSE events      |
| `/workflows`       | WorkflowManager    | Manage existing workflow runs                   |

### Dashboard

Shows four summary cards: **Workflow Tasks**, **Active Runs**, **AI Providers**, and **Server Status**. Below the cards it displays the current workflow summary (if loaded) and a list of recent runs.

### Workflow Editor

Form-based editor for creating and modifying workflows. Each task has: id, title, description, executor, dependsOn, acceptanceCriteria, validation config, expectedResult, and outputPlan. Workflows can be saved via the API.

### Workflow Graph

Displays task dependencies as a directed acyclic graph (DAG). Nodes are color-coded by status (pending, running, done, failed). Hovering shows task details.

### Orchestrator Config

Form controls for:

- **Planner mode**: `simple`, `ai`, or `auto`
- **Planner provider/model**: which AI provider drives the planner
- **Validation**: enable/disable, custom validation commands
- **Limits**: max runs, max tasks per run, max retries
- **Executor entries**: shell, opencode, claude, codex, aider, custom
- **Retry policy**: max attempts, delay between retries
- **Timeouts**: per-task and per-run

### AI Providers

List and configure AI providers. Each provider entry shows: name, type, base URL, model, API key availability, and validation status. Supports all 8 provider types (OpenAI, Anthropic, Gemini, Mistral, Azure OpenAI, Ollama, OpenAI-Compatible, Custom).

### Run Monitor

Real-time run monitoring with:

- **Run list**: all runs with status badges
- **Detail panel**: tasks, steps, events, and artifacts for a selected run
- **Live stream**: SSE (Server-Sent Events) feed for real-time event updates
- **Action buttons**: cancel, resume, retry tasks
- **Log viewer**: runtime logs, task logs
- **Artifact browser**: list of files generated during a run

### Workflow Manager

Lists workflow runs and shows the current active workflow. Provides navigation context for the graph and editor.

### Server Connection Status

The sidebar footer shows a green (connected), yellow (connecting), or red (disconnected) indicator. The UI automatically fetches data from `http://{hostname}:3487/api/*`.

---

## API Reference

The API lives under `/api/` on the LocalServer. All endpoints return JSON. CORS headers allow cross-origin requests from any origin by default.

### Base URL

```
http://127.0.0.1:3487/api
```

### Standard Responses

- **200** — Success with JSON body
- **201** — Resource created (runs)
- **204** — No content (OPTIONS preflight)
- **400** — Bad request (missing fields, invalid input)
- **404** — Not found (unknown endpoint, run, task)
- **405** — Method not allowed
- **500** — Internal server error

Error bodies follow this shape:

```json
{ "error": "Human-readable error message" }
```

### Health

| Method | Path      | Description               |
| ------ | --------- | ------------------------- |
| `GET`  | `/health` | Returns `{"status":"ok"}` |

### Project Status

| Method | Path          | Description                                                           |
| ------ | ------------- | --------------------------------------------------------------------- |
| `GET`  | `/api/status` | Returns project status: initialized, project, config, state, dbStatus |

### Config Management

| Method | Path               | Description                   |
| ------ | ------------------ | ----------------------------- |
| `GET`  | `/api/config`      | Get full configuration        |
| `PUT`  | `/api/config`      | Merge config (partial update) |
| `GET`  | `/api/config/keys` | List all config key paths     |

`PUT /api/config` merges the provided JSON into the existing config. Omitted fields are preserved.

### AI Providers

| Method | Path             | Description                              |
| ------ | ---------------- | ---------------------------------------- |
| `GET`  | `/api/providers` | List configured AI providers with status |

### Run Management

| Method | Path                   | Description                 |
| ------ | ---------------------- | --------------------------- |
| `GET`  | `/api/runs`            | List all runs               |
| `POST` | `/api/runs`            | Create a new run            |
| `GET`  | `/api/runs/:id`        | Get run details             |
| `POST` | `/api/runs/:id/start`  | Execute a run from a prompt |
| `POST` | `/api/runs/:id/cancel` | Cancel a running run        |
| `POST` | `/api/runs/:id/resume` | Resume an interrupted run   |

**POST /api/runs** request body:

```json
{
  "title": "My Workflow Run",
  "mode": "auto"
}
```

| Field   | Type   | Default         | Description                                                 |
| ------- | ------ | --------------- | ----------------------------------------------------------- |
| `title` | string | `"Web UI Run"`  | Run title                                                   |
| `mode`  | string | project default | Run mode: `auto`, `manual`, `plan-only`, `dry-run`, `debug` |

**POST /api/runs/:id/start** request body:

```json
{
  "prompt": "Implement the authentication module",
  "mode": "auto",
  "plannerMode": "auto"
}
```

| Field         | Type   | Default | Description                          |
| ------------- | ------ | ------- | ------------------------------------ |
| `prompt`      | string | `""`    | The workflow prompt                  |
| `mode`        | string | —       | Run mode override                    |
| `plannerMode` | string | —       | Planner mode: `simple`, `ai`, `auto` |

### Tasks

| Method | Path                          | Description               |
| ------ | ----------------------------- | ------------------------- |
| `GET`  | `/api/runs/:id/tasks`         | List all tasks for a run  |
| `GET`  | `/api/runs/:id/tasks/:taskId` | Get specific task details |

### Timeline, Summary, Workflow, Artifacts

| Method | Path                      | Description                      |
| ------ | ------------------------- | -------------------------------- |
| `GET`  | `/api/runs/:id/timeline`  | Get timeline events for a run    |
| `GET`  | `/api/runs/:id/summary`   | Combined run + tasks + timeline  |
| `GET`  | `/api/runs/:id/workflow`  | Export workflow as YAML/JSON     |
| `GET`  | `/api/runs/:id/artifacts` | List artifacts produced by a run |
| `GET`  | `/api/runs/:id/logs`      | Read runtime log content         |

### User Input

| Method | Path                  | Description                         |
| ------ | --------------------- | ----------------------------------- |
| `POST` | `/api/runs/:id/input` | Submit user input to a waiting task |

**POST /api/runs/:id/input** request body:

```json
{
  "text": "Use RS256 algorithm",
  "taskId": "task_auth",
  "stepId": "step_impl"
}
```

| Field    | Type   | Required | Description    |
| -------- | ------ | -------- | -------------- |
| `text`   | string | yes      | The input text |
| `taskId` | string | no       | Target task ID |
| `stepId` | string | no       | Target step ID |

### Real-Time Events (SSE)

| Method | Path                   | Description                                     |
| ------ | ---------------------- | ----------------------------------------------- |
| `GET`  | `/api/runs/:id/events` | Server-Sent Events stream for real-time updates |

The SSE endpoint streams `FlowTaskEvent` objects as JSON:

```
data: {"type":"task_started","runId":"...","taskId":"...","message":"Starting task"}
data: {"type":"executor_output","runId":"...","taskId":"...","message":"...AI output..."}
data: {"type":"task_completed","runId":"...","taskId":"...","message":"Task completed"}
```

Heartbeat messages (`: heartbeat`) are sent every 15 seconds to keep the connection alive.

### Full Capabilities (via FlowTaskAPI class)

The programmatic `FlowTaskAPI` class exposes every operation used by the CLI:

| Category       | Methods                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database       | `initDatabase`, `getDbStatus`, `backupDatabase`, `vacuumDatabase`, `integrityCheck`                                                                 |
| Project        | `initProject`, `loadProject`, `loadProjectState`, `saveProjectState`, `loadConfig`, `isInitialized`                                                 |
| Run            | `createRun`, `loadRun`, `saveRun`, `listRuns`, `updateRunStatus`, `deleteRun`, `inspectRun`, `cancelRun`, `cleanRuns`, `listRunsFiltered`           |
| Task           | `loadTasks`, `saveTasks`, `getTask`, `updateTaskStatus`, `updateTask`, `approveTask`, `denyTask`, `getNextTask`, `loadTaskOutput`, `getTaskResults` |
| Step           | `loadSteps`, `getStep`, `updateStep`, `updateStepStatus`, `approveStep`, `denyStep`, `approveAllSteps`, `loadAllSteps`                              |
| Workflow       | `exportWorkflow`, `workflowDiff`, `workflowApply`, `workflowAddTask`, `workflowRemoveTask`, `workflowReorder`, `workflowValidate`, `workflowReplan` |
| Artifact       | `saveArtifact`, `loadArtifact`, `listArtifactsByRun`, `listArtifactsByTask`                                                                         |
| Checkpoint     | `getLatestCheckpoint`, `listCheckpoints`, `cleanCheckpoints`                                                                                        |
| Events         | `readRunEvents`, `queryEvents`, `appendEvent`                                                                                                       |
| Timeline       | `appendTimeline`, `getTimeline`, `searchTimeline`, `getTimelineSummary`                                                                             |
| Audit          | `appendAudit`, `getAuditLog`, `searchAuditLog`, `getAuditSummary`                                                                                   |
| Logs           | `readRuntimeLog`, `readValidationLog`, `readTaskLog`, `listLogFiles`                                                                                |
| Config         | `getConfig`, `getConfigValue`, `setConfigValue`, `listConfigKeys`, `updateConfig`                                                                   |
| Plugin         | `initPlugins`, `registerPlugin`, `unregisterPlugin`, `listPlugins`, `getPlugin`, `getPluginsByCapability`                                           |
| Run Lifecycle  | `executeRun`, `resumeRun`, `retryTask`, `runQualityGate`, `flushLogs`                                                                               |
| State          | `loadRunState`, `saveRunState`                                                                                                                      |
| Providers      | `listProviders`, `getProvider`, `testProvider`                                                                                                      |
| Templates      | `listTemplateNames`, `getTemplate`, `findTemplates`, `inferTemplate`                                                                                |
| Reports        | `getFinalReportData`, `getFinalReportMarkdown`                                                                                                      |
| Info           | `getProjectStatus`, `getApiInfo`, `healthCheck`                                                                                                     |
| Input/Approval | `submitUserInput`, `submitApproval`                                                                                                                 |
| Webhooks       | `listWebhooks`, `registerWebhook`, `unregisterWebhook`, `getWebhook`                                                                                |

---

## Usage Examples

### curl

```bash
# Health check
curl http://127.0.0.1:3487/health

# Get project status
curl http://127.0.0.1:3487/api/status

# List all runs
curl http://127.0.0.1:3487/api/runs

# Create a new run
curl -X POST http://127.0.0.1:3487/api/runs \
  -H "Content-Type: application/json" \
  -d '{"title": "Refactor Auth", "mode": "auto"}'

# Get run details
curl http://127.0.0.1:3487/api/runs/<runId>

# Cancel a run
curl -X POST http://127.0.0.1:3487/api/runs/<runId>/cancel

# List tasks
curl http://127.0.0.1:3487/api/runs/<runId>/tasks

# Get timeline
curl http://127.0.0.1:3487/api/runs/<runId>/timeline

# Export workflow
curl http://127.0.0.1:3487/api/runs/<runId>/workflow

# Read logs
curl http://127.0.0.1:3487/api/runs/<runId>/logs

# Submit user input
curl -X POST http://127.0.0.1:3487/api/runs/<runId>/input \
  -H "Content-Type: application/json" \
  -d '{"text": "Use RS256", "taskId": "task_1"}'

# Get config
curl http://127.0.0.1:3487/api/config

# Update config
curl -X PUT http://127.0.0.1:3487/api/config \
  -H "Content-Type: application/json" \
  -d '{"projectMode": "research", "plannerMode": "auto"}'

# List AI providers
curl http://127.0.0.1:3487/api/providers
```

### JavaScript (fetch)

```javascript
const API = "http://127.0.0.1:3487/api";

// List runs
async function listRuns() {
  const res = await fetch(`${API}/runs`);
  return res.json();
}

// Create and start a run
async function createAndStartRun(title, prompt) {
  const run = await fetch(`${API}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, mode: "auto" }),
  }).then((r) => r.json());

  const result = await fetch(`${API}/runs/${run.runId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  }).then((r) => r.json());

  return result;
}

// Subscribe to real-time events (SSE)
function subscribeToRun(runId) {
  const events = new EventSource(`http://127.0.0.1:3487/api/runs/${runId}/events`);
  events.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log(data.type, data.message);
  };
  events.onerror = (err) => console.error("SSE error", err);
  return () => events.close();
}

// Submit user input
async function submitInput(runId, text, taskId) {
  const res = await fetch(`${API}/runs/${runId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, taskId }),
  });
  return res.json();
}
```

### Python

```python
import requests, json

API = "http://127.0.0.1:3487/api"

# List runs
runs = requests.get(f"{API}/runs").json()

# Create a run
run = requests.post(f"{API}/runs", json={
    "title": "Python integration",
    "mode": "auto"
}).json()

# Start execution
result = requests.post(f"{API}/runs/{run['runId']}/start", json={
    "prompt": "Set up project structure"
}).json()

# Read logs
logs = requests.get(f"{API}/runs/{run['runId']}/logs").json()
print(logs["log"])
```

### TypeScript (programmatic API)

```typescript
import { FlowTaskAPI } from "flowtask/api/flowtask-api.js";

const api = new FlowTaskAPI({ rootPath: process.cwd() });
await api.initProject("My Project", "development");
await api.initDatabase();

const run = await api.createRun("proj-1", "Fix build errors", "auto");
await api.markRunActive(run.runId);

const tasks = await api.loadTasks(run.runId);
const events = await api.readRunEvents(run.runId);
const log = await api.readRuntimeLog(run.runId);
```

---

## Integration Tips

### CI/CD Integration

Use the HTTP API to create runs and check results in pipelines:

```bash
# Create a run
RUN=$(curl -s -X POST http://127.0.0.1:3487/api/runs \
  -H "Content-Type: application/json" \
  -d '{"title":"CI Run","mode":"auto"}' | jq -r '.runId')

# Start it
curl -s -X POST "http://127.0.0.1:3487/api/runs/$RUN/start" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Run lint and tests"}'

# Poll status until done
while true; do
  STATUS=$(curl -s "http://127.0.0.1:3487/api/runs/$RUN" | jq -r '.status')
  [ "$STATUS" = "completed" ] && echo "OK" && break
  [ "$STATUS" = "failed" ] && echo "FAILED" && exit 1
  sleep 2
done
```

### Custom UIs

Create custom frontends that talk to the API:

```javascript
// React hook example
function useFlowTaskRuns() {
  const [runs, setRuns] = useState([]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await fetch("http://127.0.0.1:3487/api/runs").then((r) => r.json());
      setRuns(data);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return runs;
}
```

### Webhook Registration

Register webhooks programmatically to receive run events:

```typescript
api.registerWebhook("my-webhook", "http://my-service.com/flowtask-events", [
  "run_completed",
  "task_failed",
  "approval_required",
]);
```

Webhooks are dispatched when events matching their registered types occur.

### CORS Configuration

By default the API allows all origins (`*`). To restrict:

```typescript
const server = createServer({ corsOrigins: "https://my-dashboard.example.com" });
```

### Error Handling

All API errors return a consistent JSON shape. Always check for the `error` field:

```javascript
const res = await fetch(`${API}/runs/invalid-id`);
if (!res.ok) {
  const { error } = await res.json();
  console.error("API error:", error);
}
```

### Security Notes

- The server binds to `127.0.0.1` by default (localhost only). Set `allowPublicExposure: true` to expose to the network.
- API keys for AI providers are validated client-side and never exposed through the API.
- Command safety classification (safe / risky / blocked) still applies when running through the API.
- SSE connections are authenticated only by network reachability — bind to localhost only in production.

### Rate Limiting

The API currently does not enforce rate limits. For heavy polling, use a reasonable interval (3+ seconds) and prefer SSE for real-time updates.

### SSE vs Polling

| Approach | Use Case                       | Implementation                    |
| -------- | ------------------------------ | --------------------------------- |
| SSE      | Real-time dashboards, monitors | Single connection, push-based     |
| Polling  | Simple status checks, CI/CD    | GET /api/runs/:id every N seconds |

Prefer SSE for interactive UIs. The RunMonitor component uses SSE for live updates and falls back to polling (3s interval) for run list refreshes.

### Data Persistence

All data persists on disk in the `.flowtask/` directory:

```
.flowtask/
  config.json         # Configuration
  project.json        # Project metadata
  runs/               # Run directories with events.jsonl, user-input.jsonl, approvals.jsonl
  flowtask.db         # SQLite database (artifacts, checkpoints, results)
```

Runs, tasks, config, and state survive server restarts. A new `FlowTaskAPI` instance with the same `rootPath` loads existing data from disk.
