# FlowTask Local Web UI — React Component Structure

> **Status:** draft | **Last reviewed:** 2026-06-30 | **Audience:** contributors

## 1. Tech Stack

| Layer            | Choice                    | Rationale                                                           |
| ---------------- | ------------------------- | ------------------------------------------------------------------- |
| Framework        | React 19 + TypeScript     | tsconfig already has `"jsx": "preserve"`; React 19 for latest APIs  |
| Build tool       | Vite                      | Fast HMR, ES module native, good DX                                 |
| Routing          | React Router v7           | Nested layouts for sidebar + detail panels                          |
| Styling          | Tailwind CSS v4           | Utility-first, responsive, low bundle, no external component lib    |
| Real-time bridge | EventBus (existing) + SSE | Existing `src/ui/event-bus.ts` replays events; SSE for live streams |
| HTTP server      | Express or Hono (lite)    | Local-only, bind to `localhost`, serve API + static files           |
| WebSocket        | ws (or built-in SSE)      | Bidirectional for waiting_input and interactive approval            |
| Testing          | vitest + @testing-library | Consistency with existing project test runner                       |
| Icons            | lucide-react              | Lightweight, tree-shakeable, accessible by default                  |

## 2. Directory Layout

```
src/ui/web/
  index.html                  # Vite entry
  main.tsx                   # React root mount
  router.tsx                 # Route definitions
  App.tsx                    # Root layout (sidebar + content)

  api/
    flowtask-bridge.ts       # HTTP/SSE client to FlowTask backend
    types.ts                 # API response types

  context/
    AppStateProvider.tsx      # Global state provider (Context + useReducer)
    useAppState.ts           # Consumer hook
    useSSE.ts                # SSE connection lifecycle hook

  hooks/
    useWorkflows.ts          # Fetch + cache workflows
    useRuns.ts               # Fetch + cache runs
    useRunLogs.ts            # Real-time log subscription
    useWaitingInput.ts       # Waiting input poll/subscribe
    useFlowTaskConfig.ts     # Config CRUD operations
    useAIConfig.ts           # AI provider config operations

  components/
    layout/
      Sidebar.tsx            # Navigation sidebar
      Header.tsx             # Top header bar
      MainContent.tsx        # Content area wrapper
      ErrorBoundary.tsx      # Error boundary wrapper

    workflow/
      WorkflowEditor.tsx     # Main workflow editor (drag tasks)
      WorkflowGraph.tsx      # DAG visualization of task dependencies
      WorkflowNode.tsx       # Single task node in graph
      WorkflowEdge.tsx       # Connection line between nodes
      TaskList.tsx           # Flat list of tasks with status
      TaskCard.tsx           # Individual task card (drag-ready)
      TaskForm.tsx           # Create/edit task form
      DependencyPicker.tsx   # Task dependency selector

    orchestrator/
      OrchestratorConfig.tsx # Planner + executor + validation config
      PlannerConfig.tsx      # Planner mode, provider, model, retry config
      ExecutorConfig.tsx     # CLI executor settings table
      ExecutorCard.tsx       # Single executor settings
      ValidationConfig.tsx   # Validation profile, commands, timeout
      RetryPolicy.tsx        # Max retries, timeout, fallback behavior
      StepDependencies.tsx   # Step dependency graph config

    ai-provider/
      AIProviderConfig.tsx   # AI provider management page
      ProviderList.tsx       # List of configured providers
      ProviderForm.tsx       # Add/edit provider form (type, key, model, url)
      ModelSelector.tsx      # Model dropdown with presets
      PromptEditor.tsx       # Custom prompt template editor
      EnvVarManager.tsx      # Environment variable CRUD table

    run/
      RunMonitor.tsx         # Main run monitoring view
      RunList.tsx            # History of runs with status badges
      RunDetail.tsx          # Single run detail view
      RunControls.tsx        # Start, stop, cancel, resume buttons
      RunProgress.tsx        # Progress bar + task count
      RunTimeline.tsx        # Time-based event timeline

    run-logs/
      RunLogs.tsx            # Full log viewer with filters
      LogEntry.tsx           # Single log line (ansi→html)
      LogFilter.tsx          # Filter by level, task, search text
      LogSearch.tsx          # Full-text search within logs

    waiting-input/
      WaitingInputHandler.tsx # Top-level handler for waiting_input events
      ApprovalDialog.tsx     # "Approve risky action?" modal
      ClarificationInput.tsx # Free-text input for AI clarification
      LoginCredentialForm.tsx# Username/password/token fields
      ConfirmationPrompt.tsx # Yes/No confirmation dialog

    status/
      WorkflowStatusBadge.tsx# pending/running/waiting_input/success/failed/skipped
      TaskStatusIcon.tsx     # Status icon (spin for running, check for done, etc.)
      StatusDashboard.tsx    # Aggregate status overview widget
      RunSummaryCard.tsx     # Summary card with key metrics

    config/
      ConfigEditor.tsx       # JSON-safe config editor with schema validation
      ConfigSection.tsx      # Collapsible config section
      ConfigField.tsx        # Typed field (string, number, boolean, array)
      ConfigExportImport.tsx # Export/import config JSON

    shared/
      Modal.tsx              # Reusable modal/dialog
      ConfirmDialog.tsx      # Generic confirm/cancel dialog
      Spinner.tsx            # Loading spinner
      Badge.tsx              # Status badge component
      Button.tsx             # Accessible button
      Input.tsx              # Accessible input field
      Select.tsx             # Accessible select dropdown
      Toggle.tsx             # Boolean toggle switch
      Toast.tsx              # Toast notification
      Tooltip.tsx            # Hover tooltip
      CodeBlock.tsx          # Syntax-highlighted code display
      IconButton.tsx         # Icon-only button (accessible label)
      EmptyState.tsx         # "No data" placeholder
      ErrorDisplay.tsx       # Error state with retry option

  routes/
    Dashboard.tsx            # Home page — project overview
    WorkflowsPage.tsx        # Workflow list + editor route
    WorkflowDetail.tsx       # Single workflow detail
    OrchestratorPage.tsx     # Orchestrator config route
    AIProvidersPage.tsx      # AI provider config route
    RunsPage.tsx             # Run history list
    RunDetailPage.tsx        # Single run detail with logs
    ConfigPage.tsx           # Global config editor
    SettingsPage.tsx         # App settings (theme, port, etc.)

  styles/
    globals.css              # Tailwind base + custom tokens
    tailwind.config.ts       # Tailwind configuration

  __tests__/
    WorkflowEditor.test.tsx
    OrchestratorConfig.test.tsx
    AIProviderConfig.test.tsx
    RunMonitor.test.tsx
    RunLogs.test.tsx
    WaitingInputHandler.test.tsx
    WorkflowGraph.test.tsx
    ConfigEditor.test.tsx
    EventBusLive.test.tsx
    ApprovalFlow.test.tsx
```

## 3. Component Hierarchy

```
App
├── AppStateProvider (global context)
│   └── Router
│       ├── Layout
│       │   ├── Sidebar (nav links)
│       │   ├── Header (breadcrumb, global actions)
│       │   └── ErrorBoundary
│       │       └── MainContent
│       │           └── <Outlet /> (routes below)
│       │
│       ├── Dashboard
│       │   ├── StatusDashboard
│       │   ├── RunSummaryCard (latest run)
│       │   └── QuickActions (new run, open config)
│       │
│       ├── WorkflowsPage
│       │   └── WorkflowEditor
│       │       ├── WorkflowGraph
│       │       │   ├── WorkflowNode (×N)
│       │       │   │   ├── TaskStatusIcon
│       │       │   │   └── Badge (executor type)
│       │       │   └── WorkflowEdge (×N)
│       │       ├── TaskList
│       │       │   └── TaskCard (×N, draggable)
│       │       └── TaskForm (modal or side panel)
│       │           └── DependencyPicker
│       │
│       ├── WorkflowDetail
│       │   ├── WorkflowGraph (read-only)
│       │   ├── TaskList (with status)
│       │   └── RunControls
│       │
│       ├── OrchestratorPage
│       │   └── OrchestratorConfig
│       │       ├── PlannerConfig
│       │       ├── ExecutorConfig
│       │       │   └── ExecutorCard (×N)
│       │       ├── ValidationConfig
│       │       ├── RetryPolicy
│       │       └── StepDependencies
│       │
│       ├── AIProvidersPage
│       │   └── AIProviderConfig
│       │       ├── ProviderList
│       │       └── ProviderForm (modal)
│       │           ├── ModelSelector
│       │           ├── PromptEditor
│       │           └── EnvVarManager
│       │
│       ├── RunsPage
│       │   └── RunList
│       │       └── RunSummaryCard (×N)
│       │
│       ├── RunDetailPage
│       │   └── RunDetail
│       │       ├── RunMonitor
│       │       │   ├── RunProgress
│       │       │   ├── RunTimeline
│       │       │   └── RunControls
│       │       ├── WorkflowGraph (live status)
│       │       └── RunLogs
│       │           ├── LogFilter
│       │           ├── LogSearch
│       │           └── LogEntry (×N)
│       │
│       ├── ConfigPage
│       │   └── ConfigEditor
│       │       ├── ConfigSection (×N)
│       │       │   └── ConfigField (×N)
│       │       └── ConfigExportImport
│       │
│       └── SettingsPage
│           └── (theme toggle, port config, about)
│
├── WaitingInputHandler (global overlay)
│   ├── ApprovalDialog
│   ├── ClarificationInput
│   ├── LoginCredentialForm
│   └── ConfirmationPrompt
│
└── Toast (global notification overlay)
```

## 4. State Management

### 4.1 Strategy: React Context + useReducer (no Redux)

One global `AppStateProvider` with domain-split reducer slices, plus per-page local state for ephemeral UI state. No Redux — the app is single-user, local-only, and has bounded complexity.

### 4.2 Global State Shape

```typescript
interface AppState {
  // Project
  project: {
    name: string;
    rootPath: string;
    status: ProjectStatus;
  };

  // Config (cached from .flowtask/config.json)
  config: FlowTaskConfig;

  // Runs (paginated, with current run focus)
  runs: {
    items: RunSummary[];
    currentRunId: string | null;
    currentRun: RunDetail | null;
    loading: boolean;
    error: string | null;
  };

  // Workflows / tasks for the current context
  workflow: {
    tasks: TaskDefinition[];
    graph: { nodes: GraphNode[]; edges: GraphEdge[] };
    loading: boolean;
  };

  // Real-time events (from EventBus / SSE)
  live: {
    events: UiEvent[];
    connected: boolean;
    waitingInput: WaitingInputSession | null;
    activeTaskId: string | null;
  };

  // UI
  ui: {
    sidebarOpen: boolean;
    theme: "light" | "dark" | "system";
    toasts: ToastMessage[];
  };
}
```

### 4.3 Reducer Slices (via `combineReducers` pattern)

| Slice      | Key Actions                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `project`  | `SET_PROJECT`, `UPDATE_PROJECT`                                                                   |
| `config`   | `LOAD_CONFIG`, `UPDATE_CONFIG`, `SAVE_CONFIG_DONE`                                                |
| `runs`     | `SET_RUNS`, `SET_CURRENT_RUN`, `UPDATE_RUN_STATUS`, `APPEND_RUN`                                  |
| `workflow` | `SET_TASKS`, `UPDATE_TASK_STATUS`, `ADD_TASK`, `REMOVE_TASK`, `REORDER`                           |
| `live`     | `EVENT_RECEIVED`, `SSE_CONNECTED`, `SSE_DISCONNECTED`, `SET_WAITING_INPUT`, `CLEAR_WAITING_INPUT` |
| `ui`       | `TOGGLE_SIDEBAR`, `SET_THEME`, `ADD_TOAST`, `DISMISS_TOAST`                                       |

### 4.4 Data Flow

```
[FlowTask CLI / Backend]
    │
    ├── HTTP REST ──────► API Client ──► Context dispatch → re-render
    │    (config CRUD,
    │     start/stop runs,
    │     fetch history)
    │
    └── SSE stream ─────► useSSE hook ──► Context dispatch (live events)
         (task updates,
          executor output,
          waiting_input,
          logs)
```

- **SSE** carries the same `UiEvent` union type from `src/ui/event-bus.ts`, so the web UI subscribes to identical events as the terminal renderers.
- **HTTP** handles command-style actions: create run, stop run, save config, edit tasks.
- **Optimistic updates**: config edits update local state immediately, with rollback on HTTP error.

### 4.5 Per-Page Local State

Ephemeral state (form inputs, drag state, expanded/collapsed, search query) lives in local `useState` / `useReducer` per component, not in the global store.

## 5. Real-Time Architecture (SSE)

```
Browser ←────── SSE (text/event-stream) ──────── FlowTask HTTP server
                                                    │
                                              reads from
                                                    │
                                          .flowtask/runs/<runId>/
                                          events.jsonl, logs/*.log
```

- Server tails `events.jsonl` and task log files, emitting SSE events.
- `useSSE` hook maintains reconnection, backoff, and health checks.
- On initial connect, server replays last N events from `EventBus` history.
- `waiting_input` events trigger the `WaitingInputHandler` overlay.
- User responses (approval, text input, credentials) POST back via HTTP.

## 6. Routing

| Path             | Component          | Purpose                         |
| ---------------- | ------------------ | ------------------------------- |
| `/`              | `Dashboard`        | Project overview, quick actions |
| `/workflows`     | `WorkflowsPage`    | Create/edit workflows           |
| `/workflows/:id` | `WorkflowDetail`   | View single workflow            |
| `/orchestrator`  | `OrchestratorPage` | Planner/executor/validation cfg |
| `/providers`     | `AIProvidersPage`  | AI provider config              |
| `/runs`          | `RunsPage`         | Run history list                |
| `/runs/:runId`   | `RunDetailPage`    | Run detail + logs + graph       |
| `/config`        | `ConfigPage`       | JSON-safe config editor         |
| `/settings`      | `SettingsPage`     | App settings, about             |

## 7. Accessibility Considerations

| Principle      | Implementation                                                                |
| -------------- | ----------------------------------------------------------------------------- |
| Keyboard nav   | All interactive elements reachable via Tab; Enter/Space to activate           |
| Focus traps    | Modals, dialogs, and slide-overs trap focus and close on Escape               |
| Skip links     | "Skip to main content" link at page load                                      |
| ARIA labels    | IconButton, Badge, progress indicators have `aria-label`                      |
| Live regions   | Log viewer uses `aria-live="polite"`; status changes use `role="status"`      |
| Color contrast | All status colors (pending/running/success/failed/skipped) meet WCAG AA 4.5:1 |
| Screen readers | WorkflowGraph nodes are `role="treeitem"` with readable labels                |
| Reduced motion | `prefers-reduced-motion` disables task node animations and transitions        |
| Focus visible  | Custom focus ring (not just `outline: none`)                                  |
| Error messages | Form validation errors use `aria-describedby` linking to field                |
| Status updates | Toast notifications have `role="alert"` and `aria-live="assertive"`           |

### Status Color Palette (WCAG AA compliant)

| Status          | Dark theme        | Light theme       |
| --------------- | ----------------- | ----------------- |
| `pending`       | `text-yellow-300` | `text-yellow-700` |
| `running`       | `text-blue-400`   | `text-blue-600`   |
| `waiting_input` | `text-purple-400` | `text-purple-600` |
| `success`       | `text-green-400`  | `text-green-600`  |
| `failed`        | `text-red-400`    | `text-red-600`    |
| `skipped`       | `text-gray-400`   | `text-gray-500`   |

## 8. Responsiveness

| Breakpoint | Target            | Layout behavior                                                       |
| ---------- | ----------------- | --------------------------------------------------------------------- |
| ≥1024px    | Desktop (primary) | Sidebar always visible, split-panel (graph + logs), wide form layouts |
| 768–1023px | Tablet            | Collapsible sidebar (hamburger), single-column detail, stacked panels |
| <768px     | Mobile            | Bottom nav bar, full-width panels, modals become full-screen sheets   |

### Responsive Patterns

- **Sidebar**: `fixed` on desktop, overlay drawer on mobile (with backdrop).
- **WorkflowGraph**: Responsive SVG viewBox; collapses to a vertical list below 640px.
- **RunMonitor**: Three-column (progress | timeline | controls) shrinks to single column.
- **RunLogs**: Search/filter bar collapses into an expandable section on mobile.
- **ProviderForm**: Multi-column fields stack vertically below 768px.
- **Toast**: Top-right on desktop, bottom-center on mobile.
- **Data tables**: Horizontal scroll with sticky first column on small screens.

## 9. Key Component Responsibilities

### WorkflowEditor

- Drag-and-drop task creation, reordering, and dependency linking.
- Renders `WorkflowGraph` (DAG) + `TaskList` (flattened) side by side.
- Save compiles to `.flowtask/runs/<runId>/tasks.json` via API.

### OrchestratorConfig

- Sectioned form mapped to `.flowtask/config.json` schema.
- Planner subsection: mode select (simple/ai/auto), provider picker, model, fallback.
- Executor subsection: table of named executors with command, args, input mode, timeout.
- Validation subsection: profile (safe/balanced/thorough), concurrency, resource guards.
- Save validates with zod, writes back to config via `flowtask config set`.

### AIProviderConfig

- CRUD table of AI providers from `config.ai.providers`.
- ProviderForm shows conditional fields based on provider type (OpenAI vs Anthropic vs Gemini...).
- API keys stored via backend's secret store (`~/.flowtask/secrets.json`), never sent to browser client — only a "has key" indicator shown.
- EnvVarManager: key-value list scoped to provider, with masking for sensitive values.

### RunMonitor

- Polls/streams run state from backend on mount.
- Displays `RunProgress` (total/done/failed/pending counts), `RunTimeline`, `RunControls`.
- Subscribes to SSE for live status transitions.

### RunLogs

- Renders log lines from `executor_output` SSE events and historic log files.
- ANSI escape codes converted to styled HTML (e.g., `picocolors` → CSS classes).
- Supports follow mode (auto-scroll), pause-on-scroll-up, search highlighting.
- Filter by task ID, stream (stdout/stderr), and severity.

### WaitingInputHandler

- Global overlay triggered by `interactive_waiting` / `process_waiting_input` SSE events.
- Dispatches to the correct dialog based on `promptType` / `detectedPattern`:
  - `approval` → `ApprovalDialog`
  - `clarification` → `ClarificationInput`
  - `login` / `credential` → `LoginCredentialForm`
  - `confirmation` → `ConfirmationPrompt`
  - `password` / `token` → masked `LoginCredentialForm`
- User response POSTed back; overlay dismissed on `interactive_resumed` event.

### WorkflowGraph

- SVG-based DAG renderer showing task nodes and dependency edges.
- Node colors reflect task status (icon + badge).
- Draggable nodes reposition; auto-layout as default.
- Zoom/pan for large workflows.
- Accessible keyboard navigation between nodes.
- At <640px viewport, collapses to a vertical list with indentation showing dependency depth.

### ConfigEditor

- Renders `.flowtask/config.json` tree as nested collapsible sections.
- Each `ConfigField` infers input type from zod schema (string→text, number→number, boolean→toggle, array→list editor).
- Save validates against zod schema before submitting; shows inline field errors.
- JSON raw-text mode as fallback for unsupported schema shapes.
- Unsaved changes warning on navigation.

## 10. Security

| Concern            | Mitigation                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------- |
| API key exposure   | Keys stored server-side in `~/.flowtask/secrets.json`; client only sees `hasKey: boolean` |
| Localhost binding  | Server binds to `127.0.0.1` by default; must opt-in for `0.0.0.0`                         |
| CSRF               | Same-origin only (localhost); no auth tokens needed for local use                         |
| XSS                | React's default escaping; SSE event text sanitized before rendering                       |
| CORS               | Not needed (same origin via Vite proxy or bundled server)                                 |
| File system access | All file writes go through existing zod-validated API endpoints                           |

## 11. Testing Plan

| Test suite                     | Focus                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `EventBusLive.test.tsx`        | SSE connection lifecycle, reconnection, event replay                  |
| `WorkflowEditor.test.tsx`      | Drag-reorder, dependency linking, save cycle                          |
| `WorkflowGraph.test.tsx`       | Node rendering, status colors, responsive collapse, keyboard nav      |
| `OrchestratorConfig.test.tsx`  | Form editing, zod validation, save to backend                         |
| `AIProviderConfig.test.tsx`    | Provider CRUD, conditional fields, key masking indicator              |
| `RunMonitor.test.tsx`          | Live status updates, progress calculation, run control buttons        |
| `RunLogs.test.tsx`             | ANSI→HTML rendering, follow mode, filter/search, infinite scroll      |
| `WaitingInputHandler.test.tsx` | Dialog dispatch by type, input submission, dismissal on resume        |
| `ConfigEditor.test.tsx`        | Schema-driven field rendering, validation errors, dirty state warning |
| `ApprovalFlow.test.tsx`        | Full flow: SSE event → overlay → user action → POST → dismissal       |

Each test suite uses `@testing-library/react` for component interaction and a mock HTTP/SSE server for backend simulation.
