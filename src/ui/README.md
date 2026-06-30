# FlowTask Local Web UI

> **Status:** draft | **Last reviewed:** 2026-06-30 | **Audience:** contributors

## Architecture Overview

The FlowTask local web UI (`src/ui/`) is a React 19 single-page application that communicates with the local FlowTask HTTP server. It provides a visual interface for workflow orchestration management — creating workflows, configuring orchestrator/providers/executors/validators, monitoring runs in real time, viewing logs and artifacts, and responding to waiting_input or approval prompts.

### Data Flow

```
Browser (React SPA)
  │
  ├── HTTP REST ─────────► FlowTask API (src/api/flowtask-api.ts)
  │    (CRUD workflows,        │
  │     manage config,         └──► .flowtask/ (config, runs, logs)
  │     start/stop runs)
  │
  └── SSE stream ─────────► /api/events (tails events.jsonl + log files)
       (task updates,
        executor output,
        waiting_input,
        logs)
```

### Tech Stack

| Layer            | Choice                                 |
| ---------------- | -------------------------------------- |
| Framework        | React 19 + TypeScript (strict mode)    |
| Build tool       | Vite (fast HMR, ES modules)            |
| Routing          | React Router v7 (nested layouts)       |
| Styling          | Tailwind CSS v4 + custom design tokens |
| State management | React Context + useReducer (no Redux)  |
| Real-time        | EventBus (`event-bus.ts`) + SSE stream |
| HTTP client      | fetch (standard, no extra dependency)  |
| Icons            | lucide-react (lightweight, accessible) |
| Testing          | vitest + @testing-library/react        |

### Design Principles

1. **Local-first** — runs entirely on localhost; no auth, no cloud dependencies
2. **Schema-driven** — forms and config editors derive inputs from zod schemas
3. **Real-time by default** — SSE pushes events; UI reacts without polling
4. **Accessible** — keyboard navigation, ARIA labels, WCAG AA contrast, reduced-motion support
5. **Responsive** — desktop-first with tablet/mobile adaptations

## Directory Layout

```
src/ui/
  App.tsx                    # Root component: provider + router + layout
  event-bus.ts              # EventBus singleton for real-time events
  output-mode.ts            # Output formatting mode definitions

  components/               # React components
    WorkflowEditor.tsx       # Drag-and-drop workflow task editor
    WorkflowGraph.tsx        # SVG-based DAG visualization
    OrchestratorConfig.tsx   # Planner/executor/validation config form
    AIProviderConfig.tsx     # AI provider CRUD management
    RunMonitor.tsx           # Run status, progress, controls
    WaitingInputHandler.tsx  # Global overlay for waiting_input/approval

  formatters/               # Output formatters (terminal rendering)
  ink/                      # Ink-based terminal UI components
  renderers/                # Terminal renderer implementations
  utils/                    # UI utility functions
```

For the full proposed component tree including sub-components, layout components, hooks, route pages, and test structure, see `ComponentStructure.md`.

## State Management

**Strategy:** Single `AppStateProvider` (React Context + `useReducer`) for global state, `useState`/`useReducer` at component level for ephemeral UI state.

```
AppStateProvider
  ├── state: AppState (global)
  │     ├── workflow     — current workflow file
  │     ├── config       — orchestrator config
  │     ├── providers    — AI provider configs
  │     ├── runs         — run index entries
  │     ├── live         — real-time events, connection status
  │     └── ui           — sidebar state, toasts
  │
  └── dispatch ─► reducer slices
```

No Redux — the app is single-user and local-only, with bounded complexity. See `ComponentStructure.md §4` for reducer slice details.

## Routing

| Path               | Page               | Purpose                         |
| ------------------ | ------------------ | ------------------------------- |
| `/`                | Dashboard          | Project overview, quick actions |
| `/workflow-editor` | WorkflowEditor     | Create/edit workflow tasks      |
| `/workflow-graph`  | WorkflowGraph      | DAG visualization of workflow   |
| `/orchestrator`    | OrchestratorConfig | Planner/executor/validation cfg |
| `/ai-providers`    | AIProviderConfig   | AI provider management          |
| `/run-monitor`     | RunMonitor         | Run history + live status       |

## Component Architecture

### Component Categories

| Category          | Description                         | Key Components                           |
| ----------------- | ----------------------------------- | ---------------------------------------- |
| **Layout**        | App shell, navigation, structure    | Sidebar, Header, ErrorBoundary           |
| **Workflow**      | Workflow creation and visualization | WorkflowEditor, WorkflowGraph, TaskCard  |
| **Orchestrator**  | Config management                   | OrchestratorConfig, PlannerConfig, ...   |
| **AI Providers**  | Provider CRUD                       | AIProviderConfig, ProviderForm, ...      |
| **Run**           | Run monitoring and control          | RunMonitor, RunLogs, RunControls         |
| **Waiting Input** | Interactive prompt handling         | ApprovalDialog, ClarificationInput       |
| **Config**        | JSON-safe config editing            | ConfigEditor, ConfigSection, ConfigField |
| **Shared**        | Reusable primitives                 | Modal, Button, Input, Select, Badge,...  |

See `ComponentStructure.md §3` for the full component hierarchy tree.

## Accessibility

- All interactive elements keyboard-navigable (Tab/Enter/Space)
- Focus traps on modals and dialogs (Escape to close)
- `aria-label` on icon-only buttons and status indicators
- Log viewer uses `aria-live="polite"` for live updates
- Status transitions use `role="status"`
- WCAG AA 4.5:1 color contrast for all status indicators
- `prefers-reduced-motion` disables animations
- Custom focus rings (never `outline: none` only)
- Form errors linked via `aria-describedby`

See `ComponentStructure.md §7` for the full accessibility checklist and the WCAG AA status color palette (light and dark themes).

## Responsiveness

| Breakpoint | Target            | Layout behavior                                       |
| ---------- | ----------------- | ----------------------------------------------------- |
| ≥1024px    | Desktop (primary) | Sidebar always visible, split-panel layouts           |
| 768–1023px | Tablet            | Collapsible sidebar, single-column detail             |
| <768px     | Mobile            | Bottom nav bar, full-width panels, full-screen modals |

See `ComponentStructure.md §8` for responsive patterns per component (WorkflowGraph, RunMonitor, RunLogs, ProviderForm, Toast, data tables).

## Real-Time Architecture

The UI receives live events via **Server-Sent Events (SSE)** from the FlowTask HTTP server:

1. Server tails `.flowtask/runs/<runId>/events.jsonl` and log files
2. `useSSE` hook manages SSE connection, reconnection, and backoff
3. Incoming events dispatched to the global `EventBus` and `AppStateProvider`
4. `waiting_input` events trigger the `WaitingInputHandler` global overlay
5. User responses POST back via HTTP

The `EventBus` (`event-bus.ts`) supports sync/async delivery, event history replay (last 1000 events), and automatic disabling of erroring listeners.

## Security

| Concern            | Mitigation                                                   |
| ------------------ | ------------------------------------------------------------ |
| API key exposure   | Keys stored server-side; client sees only `hasKey: boolean`  |
| Localhost binding  | Server binds to `127.0.0.1` by default                       |
| CSRF / XSS         | Same-origin only; React default escaping; SSE text sanitized |
| File system access | All writes through zod-validated API endpoints               |

See `ComponentStructure.md §10` for full security details.

## Testing

Each major component has a corresponding test suite under `__tests__/` using `@testing-library/react` with a mock HTTP/SSE server. See `ComponentStructure.md §11` for the complete test plan covering:

- EventBus connection lifecycle
- Component interaction (drag-reorder, dependency linking, CRUD)
- Real-time status updates and progress calculation
- ANSI → HTML rendering
- Approval flow (SSE → overlay → POST → dismissal)

## Development

The web UI is in active development. Components are being migrated from the draft `ComponentStructure.md` design to production-ready implementations under `src/ui/components/`. Run the development server alongside the FlowTask API server for live iteration.
