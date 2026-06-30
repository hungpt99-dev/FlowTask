import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { WorkflowEditor } from "./components/WorkflowEditor.js";
import type { WorkflowFile } from "../schemas/workflow.schema.js";
import { OrchestratorConfig } from "./components/OrchestratorConfig.js";
import { AIProviderConfig } from "./components/AIProviderConfig.js";
import type {
  PlannerConfig,
  PlannerRetryPolicy,
  PlannerTimeout,
} from "../schemas/planner.schema.js";
import type { ExecutorEntry } from "../schemas/config.schema.js";
import type { AiProviderConfig } from "../ai/ai.schema.js";
import { RunMonitor } from "./components/RunMonitor.js";
import type { RunIndexEntry } from "../schemas/run.schema.js";
import { WorkflowGraph } from "./components/WorkflowGraph.js";
import type { TaskDisplayStatus } from "./components/WorkflowGraph.js";
import type { WorkflowTask } from "../schemas/workflow.schema.js";

interface OrchestratorConfigData {
  planner?: PlannerConfig;
  validation?: Record<string, unknown>;
  limits?: { maxRunMinutes?: number; maxTaskMinutes?: number; maxRetries?: number };
  executors?: Record<string, ExecutorEntry>;
  retryPolicy?: PlannerRetryPolicy;
  timeout?: PlannerTimeout;
  stepDependencies?: Record<string, string[]>;
}

interface AppState {
  workflow: WorkflowFile | null;
  orchestratorConfig: OrchestratorConfigData;
  aiProviders: Record<string, AiProviderConfig>;
  runs: RunIndexEntry[];
  runTaskStatuses: Record<string, TaskDisplayStatus>;
  serverStatus: "connected" | "disconnected" | "connecting";
  sidebarCollapsed: boolean;
}

interface AppContextValue {
  state: AppState;
  setWorkflow: (workflow: WorkflowFile | null) => void;
  setOrchestratorConfig: (config: OrchestratorConfigData) => void;
  setAiProviders: (providers: Record<string, AiProviderConfig>) => void;
  setRuns: (runs: RunIndexEntry[]) => void;
  setRunTaskStatuses: (statuses: Record<string, TaskDisplayStatus>) => void;
  setServerStatus: (status: "connected" | "disconnected" | "connecting") => void;
  toggleSidebar: () => void;
  saveWorkflow: (workflow: WorkflowFile) => Promise<void>;
  saveOrchestratorConfig: (config: Record<string, unknown>) => Promise<void>;
  saveAiProviders: (config: Record<string, unknown>) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const initialOrchestratorConfig: OrchestratorConfigData = {};

const initialState: AppState = {
  workflow: null,
  orchestratorConfig: initialOrchestratorConfig,
  aiProviders: {},
  runs: [],
  runTaskStatuses: {},
  serverStatus: "connecting",
  sidebarCollapsed: false,
};

export function useAppState(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppState must be used within an AppStateProvider");
  }
  return ctx;
}

interface AppStateProviderProps {
  children: ReactNode;
  initialWorkflow?: WorkflowFile | null;
  initialOrchestratorConfig?: OrchestratorConfigData;
  initialAiProviders?: Record<string, AiProviderConfig>;
  initialRuns?: RunIndexEntry[];
  onSaveWorkflow?: (workflow: WorkflowFile) => Promise<void>;
  onSaveOrchestratorConfig?: (config: Record<string, unknown>) => Promise<void>;
  onSaveAiProviders?: (config: Record<string, unknown>) => Promise<void>;
}

export function AppStateProvider({
  children,
  initialWorkflow = null,
  initialOrchestratorConfig: initOrch = initialOrchestratorConfig,
  initialAiProviders = {},
  initialRuns = [],
  onSaveWorkflow,
  onSaveOrchestratorConfig,
  onSaveAiProviders,
}: AppStateProviderProps) {
  const [state, setState] = useState<AppState>({
    ...initialState,
    workflow: initialWorkflow,
    orchestratorConfig: initOrch,
    aiProviders: initialAiProviders,
    runs: initialRuns,
  });

  const setWorkflow = useCallback((workflow: WorkflowFile | null) => {
    setState((prev) => ({ ...prev, workflow }));
  }, []);

  const setOrchestratorConfig = useCallback((config: OrchestratorConfigData) => {
    setState((prev) => ({ ...prev, orchestratorConfig: config }));
  }, []);

  const setAiProviders = useCallback((providers: Record<string, AiProviderConfig>) => {
    setState((prev) => ({ ...prev, aiProviders: providers }));
  }, []);

  const setRuns = useCallback((runs: RunIndexEntry[]) => {
    setState((prev) => ({ ...prev, runs }));
  }, []);

  const setRunTaskStatuses = useCallback((statuses: Record<string, TaskDisplayStatus>) => {
    setState((prev) => ({ ...prev, runTaskStatuses: statuses }));
  }, []);

  const setServerStatus = useCallback((status: "connected" | "disconnected" | "connecting") => {
    setState((prev) => ({ ...prev, serverStatus: status }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setState((prev) => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }));
  }, []);

  const saveWorkflow = useCallback(
    async (workflow: WorkflowFile) => {
      if (onSaveWorkflow) {
        await onSaveWorkflow(workflow);
      }
      setWorkflow(workflow);
    },
    [onSaveWorkflow, setWorkflow],
  );

  const saveOrchestratorConfig = useCallback(
    async (config: Record<string, unknown>) => {
      if (onSaveOrchestratorConfig) {
        await onSaveOrchestratorConfig(config);
      }
    },
    [onSaveOrchestratorConfig],
  );

  const saveAiProviders = useCallback(
    async (config: Record<string, unknown>) => {
      if (onSaveAiProviders) {
        await onSaveAiProviders(config);
      }
    },
    [onSaveAiProviders],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      setWorkflow,
      setOrchestratorConfig,
      setAiProviders,
      setRuns,
      setRunTaskStatuses,
      setServerStatus,
      toggleSidebar,
      saveWorkflow,
      saveOrchestratorConfig,
      saveAiProviders,
    }),
    [
      state,
      setWorkflow,
      setOrchestratorConfig,
      setAiProviders,
      setRuns,
      setRunTaskStatuses,
      setServerStatus,
      toggleSidebar,
      saveWorkflow,
      saveOrchestratorConfig,
      saveAiProviders,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

interface NavItem {
  path: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Dashboard" },
  { path: "/workflow-editor", label: "Workflow Editor" },
  { path: "/orchestrator", label: "Orchestrator Config" },
  { path: "/ai-providers", label: "AI Providers" },
  { path: "/run-monitor", label: "Run Monitor" },
  { path: "/workflow-graph", label: "Workflow Graph" },
];

const SIDEBAR_WIDTH = 200;
const SIDEBAR_COLLAPSED_WIDTH = 56;

const linkBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 500,
  color: "#374151",
  textDecoration: "none",
  transition: "background-color 0.15s, color 0.15s",
  whiteSpace: "nowrap",
  overflow: "hidden",
};

function AppLayout() {
  const { state, toggleSidebar } = useAppState();
  const { sidebarCollapsed, serverStatus } = state;

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <nav
        role="navigation"
        aria-label="Main navigation"
        style={{
          width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
          minWidth: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
          backgroundColor: "#f9fafb",
          borderRight: "1px solid #e5e7eb",
          display: "flex",
          flexDirection: "column",
          transition: "width 0.2s, min-width 0.2s",
        }}
      >
        <div
          style={{
            padding: "12px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {!sidebarCollapsed && (
            <span style={{ fontWeight: 700, fontSize: "15px", color: "#111827" }}>FlowTask</span>
          )}
          <button
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              fontSize: "16px",
              color: "#6b7280",
              lineHeight: 1,
            }}
          >
            {sidebarCollapsed ? "\u25B6" : "\u25C0"}
          </button>
        </div>

        <div
          style={{ flex: 1, padding: "8px", display: "flex", flexDirection: "column", gap: "2px" }}
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              style={({ isActive }) => ({
                ...linkBase,
                backgroundColor: isActive ? "#e5e7eb" : "transparent",
                color: isActive ? "#111827" : "#374151",
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                padding: sidebarCollapsed ? "8px" : "8px 12px",
              })}
              aria-label={sidebarCollapsed ? item.label : undefined}
            >
              <span style={{ fontSize: "14px", lineHeight: 1 }}>{item.label.charAt(0)}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </div>

        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid #e5e7eb",
            fontSize: "11px",
            color: "#9ca3af",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor:
                serverStatus === "connected"
                  ? "#22c55e"
                  : serverStatus === "connecting"
                    ? "#f59e0b"
                    : "#ef4444",
              display: "inline-block",
            }}
            aria-label={`Server status: ${serverStatus}`}
          />
          {!sidebarCollapsed && (
            <span>
              Server:{" "}
              {serverStatus === "connected"
                ? "Connected"
                : serverStatus === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
            </span>
          )}
        </div>
      </nav>

      <main
        role="main"
        style={{
          flex: 1,
          overflow: "auto",
          padding: "24px",
          backgroundColor: "#ffffff",
        }}
      >
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/workflow-editor" element={<WorkflowEditorPage />} />
          <Route path="/orchestrator" element={<OrchestratorPage />} />
          <Route path="/ai-providers" element={<AIProvidersPage />} />
          <Route path="/run-monitor" element={<RunMonitorPage />} />
          <Route path="/workflow-graph" element={<WorkflowGraphPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function DashboardPage() {
  const { state } = useAppState();
  const { workflow, orchestratorConfig, aiProviders, runs, serverStatus } = state;

  const activeRuns = runs.filter((r) =>
    ["running", "waiting_input", "waiting_approval", "planning", "validating"].includes(r.status),
  ).length;

  const cards: { title: string; value: string | number; color: string }[] = [
    {
      title: "Workflow Tasks",
      value: workflow?.tasks.length ?? 0,
      color: "#3b82f6",
    },
    {
      title: "Active Runs",
      value: activeRuns,
      color: "#22c55e",
    },
    {
      title: "AI Providers",
      value: Object.keys(aiProviders).length,
      color: "#a855f7",
    },
    {
      title: "Server Status",
      value:
        serverStatus === "connected"
          ? "Connected"
          : serverStatus === "connecting"
            ? "Connecting..."
            : "Disconnected",
      color:
        serverStatus === "connected"
          ? "#22c55e"
          : serverStatus === "connecting"
            ? "#f59e0b"
            : "#ef4444",
    },
  ];

  return (
    <div role="region" aria-label="Dashboard">
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: "0 0 20px" }}>
        Dashboard
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        {cards.map((card) => (
          <div
            key={card.title}
            style={{
              padding: "16px",
              borderRadius: "8px",
              border: `1px solid ${card.color}20`,
              backgroundColor: `${card.color}08`,
            }}
          >
            <div
              style={{ fontSize: "12px", color: "#6b7280", fontWeight: 500, marginBottom: "4px" }}
            >
              {card.title}
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {workflow && workflow.tasks.length > 0 && (
        <div
          style={{
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            marginBottom: "16px",
          }}
        >
          <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>
            Current Workflow
          </h2>
          <div style={{ fontSize: "13px", color: "#6b7280" }}>
            {workflow.runTitle && <div>Title: {workflow.runTitle}</div>}
            <div>
              {workflow.tasks.length} task{workflow.tasks.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
      )}

      {orchestratorConfig.planner && (
        <div
          style={{
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            marginBottom: "16px",
          }}
        >
          <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>
            Orchestrator
          </h2>
          <div style={{ fontSize: "13px", color: "#6b7280" }}>
            Mode: {orchestratorConfig.planner.default ?? "auto"}
            {orchestratorConfig.planner.provider && (
              <> &middot; Provider: {orchestratorConfig.planner.provider}</>
            )}
          </div>
        </div>
      )}

      {runs.length > 0 && (
        <div
          style={{
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>
            Recent Runs
          </h2>
          <div style={{ fontSize: "13px", color: "#6b7280" }}>
            {runs.length} total run{runs.length !== 1 ? "s" : ""} &middot; {activeRuns} active
          </div>
          {runs.slice(0, 5).map((run) => (
            <div
              key={run.runId}
              style={{
                padding: "8px 0",
                borderBottom: "1px solid #f3f4f6",
                fontSize: "12px",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{run.title}</span>
              <span style={{ color: "#6b7280" }}>{run.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowEditorPage() {
  const { saveWorkflow, state } = useAppState();

  const handleSave = useCallback(
    async (workflow: WorkflowFile) => {
      await saveWorkflow(workflow);
    },
    [saveWorkflow],
  );

  return (
    <div role="region" aria-label="Workflow editor page">
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: "0 0 20px" }}>
        Workflow Editor
      </h1>
      <WorkflowEditor workflow={state.workflow ?? undefined} onSave={handleSave} />
    </div>
  );
}

function OrchestratorPage() {
  const { saveOrchestratorConfig, state } = useAppState();

  return (
    <div role="region" aria-label="Orchestrator config page">
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: "0 0 20px" }}>
        Orchestrator Configuration
      </h1>
      <OrchestratorConfig
        defaultConfig={state.orchestratorConfig.planner}
        defaultLimits={state.orchestratorConfig.limits}
        executors={state.orchestratorConfig.executors}
        onSave={saveOrchestratorConfig}
      />
    </div>
  );
}

function AIProvidersPage() {
  const { saveAiProviders, state } = useAppState();

  return (
    <div role="region" aria-label="AI providers page">
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: "0 0 20px" }}>
        AI Providers
      </h1>
      <AIProviderConfig defaultProviders={state.aiProviders} onSave={saveAiProviders} />
    </div>
  );
}

function RunMonitorPage() {
  return (
    <div role="region" aria-label="Run monitor page" style={{ height: "calc(100vh - 100px)" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: "0 0 20px" }}>
        Run Monitor
      </h1>
      <div style={{ height: "calc(100% - 40px)" }}>
        <RunMonitor runs={[]} pollIntervalMs={3000} />
      </div>
    </div>
  );
}

function WorkflowGraphPage() {
  const { state } = useAppState();
  const tasks: WorkflowTask[] = state.workflow?.tasks ?? [];

  return (
    <div role="region" aria-label="Workflow graph page">
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: "0 0 20px" }}>
        Workflow Graph
      </h1>
      <div
        style={{
          padding: "16px",
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          overflow: "auto",
        }}
      >
        <WorkflowGraph tasks={tasks} taskStatuses={state.runTaskStatuses} />
      </div>
    </div>
  );
}

export function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    </AppStateProvider>
  );
}

export type { AppState, OrchestratorConfigData, AppContextValue };
