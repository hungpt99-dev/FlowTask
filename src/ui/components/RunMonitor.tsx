import { useState, useCallback, useEffect, useId, useRef } from "react";
import type { ChangeEvent } from "react";
import type { RunIndexEntry, Run, RunError } from "../../schemas/run.schema.js";
import type { Task } from "../../schemas/task.schema.js";
import type { Step, StepError } from "../../schemas/step.schema.js";
import type { FlowTaskEvent } from "../../schemas/event.schema.js";
import { ApprovalInputHandler } from "./ApprovalInputHandler.js";

type FormErrors = Partial<Record<string, string>>;

interface RunDetail {
  run: Run;
  tasks: Task[];
  steps: Record<string, Step[]>;
  events: FlowTaskEvent[];
}

interface LogEntry {
  line: string;
  isError: boolean;
}

interface ArtifactRecord {
  artifactId: string;
  runId: string;
  taskId?: string;
  type: string;
  title: string;
  path: string;
  createdAt: string;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
type DetailView = "tasks" | "timeline" | "artifacts";

export interface RunMonitorProps {
  runs?: RunIndexEntry[];
  onListRuns?: () => Promise<RunIndexEntry[]>;
  onLoadRun?: (runId: string) => Promise<RunDetail>;
  onLoadLogs?: (runId: string, taskId?: string) => Promise<string>;
  onCancelRun?: (runId: string) => Promise<void>;
  onProvideInput?: (runId: string, taskId: string, stepId: string, input: string) => Promise<void>;
  onListArtifacts?: (runId: string) => Promise<ArtifactRecord[]>;
  pollIntervalMs?: number;
  sseUrl?: string;
}

function toLines(content: string): LogEntry[] {
  return content.split("\n").map((line) => ({
    line,
    isError: /error|fail|traceback|exception|error:/i.test(line),
  }));
}

function getStatusStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  };

  if (["succeeded", "completed", "done", "passed"].includes(status)) {
    return { ...base, backgroundColor: "#d4edda", color: "#155724" };
  }
  if (["failed", "stuck", "blocked"].includes(status)) {
    return { ...base, backgroundColor: "#f8d7da", color: "#721c24" };
  }
  if (
    ["waiting_input", "waiting_approval", "waiting_dependency", "waiting_plan_approval"].includes(
      status,
    )
  ) {
    return { ...base, backgroundColor: "#fff3cd", color: "#856404" };
  }
  if (["running", "validating", "retrying", "scanning", "planning"].includes(status)) {
    return { ...base, backgroundColor: "#cce5ff", color: "#004085" };
  }
  if (["skipped", "cancelled", "rolled_back", "interrupted", "paused"].includes(status)) {
    return { ...base, backgroundColor: "#e2e3e5", color: "#383d41" };
  }
  return { ...base, backgroundColor: "#f8f9fa", color: "#6c757d" };
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isActiveStatus(status: string): boolean {
  return [
    "running",
    "scanning",
    "planning",
    "validating",
    "retrying",
    "waiting_approval",
    "waiting_input",
    "waiting_dependency",
    "waiting_plan_approval",
    "needs_user_review",
  ].includes(status);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatShortDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "--";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function getWaitingStep(task: Task, steps: Step[]): Step | undefined {
  return steps.find((s) => s.status === "waiting_input" || s.status === "waiting_approval");
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  run_started: "#3b82f6",
  run_completed: "#22c55e",
  run_failed: "#ef4444",
  run_cancelled: "#6b7280",
  task_started: "#3b82f6",
  task_completed: "#22c55e",
  task_failed: "#ef4444",
  task_skipped: "#6b7280",
  executor_started: "#8b5cf6",
  executor_output: "#6b7280",
  executor_completed: "#22c55e",
  executor_failed: "#ef4444",
  validation_passed: "#22c55e",
  validation_failed: "#ef4444",
  validation_skipped: "#6b7280",
  approval_requested: "#f59e0b",
  approval_approved: "#22c55e",
  approval_rejected: "#ef4444",
  error_occurred: "#ef4444",
  prompt_detected: "#a855f7",
  prompt_input_provided: "#8b5cf6",
};

function getEventIcon(event: FlowTaskEvent): string {
  const t = event.type;
  if (t.includes("failed") || t.includes("error")) return "\u2716";
  if (t.includes("completed") || t.includes("passed") || t.includes("approved")) return "\u2714";
  if (t.includes("started") || t.includes("requested")) return "\u25B6";
  if (t.includes("skipped")) return "\u27F3";
  if (t.includes("cancelled")) return "\u23F9";
  if (t.includes("output")) return "\u2192";
  if (t.includes("prompt") || t.includes("input")) return "\u2709";
  return "\u25CF";
}

function getEventColor(event: FlowTaskEvent): string {
  for (const [prefix, color] of Object.entries(EVENT_TYPE_COLORS)) {
    if (event.type === prefix || event.type.startsWith(prefix)) return color;
  }
  return "#6b7280";
}

export function RunMonitor({
  runs: initialRuns,
  onListRuns,
  onLoadRun,
  onLoadLogs,
  onCancelRun,
  onProvideInput,
  onListArtifacts,
  pollIntervalMs = 3000,
  sseUrl,
}: RunMonitorProps) {
  const formId = useId();
  const logContainerRef = useRef<HTMLDivElement>(null);
  const eventContainerRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  const [runs, setRuns] = useState<RunIndexEntry[]>(initialRuns ?? []);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);

  const [logContent, setLogContent] = useState<string>("");
  const [logLines, setLogLines] = useState<LogEntry[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const [loading, setLoading] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [liveEvents, setLiveEvents] = useState<FlowTaskEvent[]>([]);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [eventAutoScroll, setEventAutoScroll] = useState(true);
  const [detailView, setDetailView] = useState<DetailView>("tasks");
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);

  const prevRunDetailRef = useRef<RunDetail | null>(null);

  // ── SSE Connection ──

  const connectSse = useCallback(
    (runId: string) => {
      if (!sseUrl) return;

      sseRef.current?.close();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      setConnectionStatus("connecting");
      const url = `${sseUrl.replace(/\/+$/, "")}/runs/${runId}/events`;
      const source = new EventSource(url);
      sseRef.current = source;

      source.onopen = () => {
        setConnectionStatus("connected");
        reconnectAttemptRef.current = 0;
      };

      source.onmessage = (msg) => {
        try {
          const event: FlowTaskEvent = JSON.parse(msg.data);
          setLiveEvents((prev) => {
            const next = [...prev, event];
            return next.length > 500 ? next.slice(-500) : next;
          });
          if (
            event.type === "run_completed" ||
            event.type === "run_failed" ||
            event.type === "run_cancelled"
          ) {
            setRunDetail((prev) => {
              if (!prev) return prev;
              const status =
                event.type === "run_completed"
                  ? "succeeded"
                  : event.type === "run_failed"
                    ? "failed"
                    : "cancelled";
              return { ...prev, run: { ...prev.run, status } };
            });
          }
        } catch {
          // skip malformed events
        }
      };

      source.onerror = () => {
        setConnectionStatus("error");
        source.close();
        sseRef.current = null;
        const attempt = reconnectAttemptRef.current;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        reconnectAttemptRef.current = attempt + 1;
        reconnectTimeoutRef.current = setTimeout(() => {
          connectSse(runId);
        }, delay);
      };
    },
    [sseUrl],
  );

  const disconnectSse = useCallback(() => {
    sseRef.current?.close();
    sseRef.current = null;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    setConnectionStatus("disconnected");
  }, []);

  useEffect(() => {
    if (!selectedRunId || !sseUrl) {
      disconnectSse();
      return;
    }
    connectSse(selectedRunId);
    return () => {
      disconnectSse();
      setLiveEvents([]);
    };
  }, [selectedRunId, sseUrl, connectSse, disconnectSse]);

  // ── Run list polling ──

  useEffect(() => {
    if (!onListRuns) return;
    let cancelled = false;

    const fetch = () => {
      onListRuns()
        .then((list) => {
          if (!cancelled) setRuns(list);
        })
        .catch(() => {});
    };

    fetch();
    const interval = setInterval(fetch, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onListRuns, pollIntervalMs]);

  // ── Load run detail when selected ──

  useEffect(() => {
    if (!selectedRunId || !onLoadRun) {
      setRunDetail(null);
      setActiveTaskId(null);
      setActiveStepId(null);
      setLogContent("");
      setLogLines([]);
      return;
    }

    let cancelled = false;

    const fetch = () => {
      onLoadRun(selectedRunId)
        .then((detail) => {
          if (cancelled) return;
          setRunDetail(detail);

          const prev = prevRunDetailRef.current;
          const wasActive = prev ? isActiveStatus(prev.run.status) : false;
          const isActive = isActiveStatus(detail.run.status);

          if (!wasActive && isActive) {
            setAutoScroll(true);
          }
          prevRunDetailRef.current = detail;

          if (activeTaskId) {
            const taskExists = detail.tasks.some((t) => t.id === activeTaskId);
            if (!taskExists) {
              setActiveTaskId(null);
              setActiveStepId(null);
            }
          }
        })
        .catch(() => {});
    };

    fetch();
    const interval = setInterval(fetch, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedRunId, onLoadRun, pollIntervalMs, activeTaskId]);

  // ── Load artifacts when selected run changes and artifact view is active ──

  useEffect(() => {
    if (!selectedRunId || !onListArtifacts) {
      setArtifacts([]);
      return;
    }
    let cancelled = false;
    const fetch = () => {
      onListArtifacts(selectedRunId)
        .then((list) => {
          if (!cancelled) setArtifacts(list);
        })
        .catch(() => {});
    };
    fetch();
    const interval = setInterval(fetch, pollIntervalMs * 2);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedRunId, onListArtifacts, pollIntervalMs]);

  // ── Load logs when task selected ──

  useEffect(() => {
    if (!selectedRunId || !activeTaskId || !onLoadLogs) {
      setLogContent("");
      setLogLines([]);
      return;
    }

    let cancelled = false;

    const fetch = () => {
      onLoadLogs(selectedRunId, activeTaskId)
        .then((content) => {
          if (cancelled) return;
          setLogContent(content);
          setLogLines(toLines(content));
        })
        .catch(() => {});
    };

    fetch();
    const interval = setInterval(fetch, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedRunId, activeTaskId, onLoadLogs, pollIntervalMs]);

  // ── Auto-scroll for logs ──

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines, autoScroll]);

  // ── Auto-scroll for events ──

  useEffect(() => {
    if (eventAutoScroll && eventContainerRef.current) {
      eventContainerRef.current.scrollTop = eventContainerRef.current.scrollHeight;
    }
  }, [liveEvents, eventAutoScroll]);

  // ── Run detail data ──

  const run = runDetail?.run;
  const tasks = runDetail?.tasks ?? [];
  const allSteps = runDetail?.steps ?? {};
  const activeTaskSteps = activeTaskId ? (allSteps[activeTaskId] ?? []) : [];
  const activeStep = activeStepId
    ? (activeTaskSteps.find((s) => s.id === activeStepId) ?? null)
    : null;

  const progressTotal = tasks.length;
  const progressDone = tasks.filter((t) =>
    ["done", "succeeded", "completed", "failed", "skipped", "cancelled"].includes(t.status),
  ).length;

  // ── Waiting input ──

  const waitingInputInfo = (() => {
    for (const task of tasks) {
      if (task.status === "waiting_input" || task.status === "waiting_approval") {
        const steps = allSteps[task.id] ?? [];
        const ws = getWaitingStep(task, steps);
        if (ws) return { task, step: ws };
      }
    }
    return null;
  })();

  // ── Errors ──

  const runErrors: RunError[] = (run?.errors ?? []) as RunError[];
  const taskErrors: { taskId: string; title: string; errors: StepError[] }[] = [];
  for (const task of tasks) {
    const steps = allSteps[task.id] ?? [];
    for (const step of steps) {
      if (step.errors && step.errors.length > 0) {
        taskErrors.push({ taskId: task.id, title: task.title, errors: step.errors as StepError[] });
      }
    }
  }
  const hasErrors = runErrors.length > 0 || taskErrors.length > 0;

  // ── Event type suggestions from live events ──

  const eventTypes = [...new Set(liveEvents.map((e) => e.type))].sort();

  // ── Filtered events ──

  const filteredEvents = eventTypeFilter
    ? liveEvents.filter((e) => e.type === eventTypeFilter)
    : liveEvents;

  // ── Handlers ──

  const selectRun = useCallback((runId: string) => {
    setSelectedRunId((prev) => (prev === runId ? null : runId));
    setActiveTaskId(null);
    setActiveStepId(null);
    setLogContent("");
    setLogLines([]);
    setError(null);
    setLiveEvents([]);
  }, []);

  const selectTask = useCallback((taskId: string) => {
    setActiveTaskId((prev) => (prev === taskId ? null : taskId));
    setActiveStepId(null);
    setError(null);
  }, []);

  const selectStep = useCallback((stepId: string) => {
    setActiveStepId((prev) => (prev === stepId ? null : stepId));
    setError(null);
  }, []);

  const cancelRun = useCallback(async () => {
    if (!selectedRunId || !onCancelRun) return;
    setLoadingRun(true);
    setError(null);
    try {
      await onCancelRun(selectedRunId);
      setSuccessMsg("Run cancelled");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel run");
    } finally {
      setLoadingRun(false);
    }
  }, [selectedRunId, onCancelRun]);

  const filteredRuns = searchQuery.trim()
    ? runs.filter(
        (r) =>
          r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.runId.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.status.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : runs;

  const connectionBadgeLabel: Record<ConnectionStatus, string> = {
    disconnected: "Offline",
    connecting: "Connecting...",
    connected: "Live",
    error: "Reconnecting...",
  };

  const connectionBadgeColor: Record<ConnectionStatus, string> = {
    disconnected: "#6b7280",
    connecting: "#f59e0b",
    connected: "#22c55e",
    error: "#ef4444",
  };

  // ── Render run list ──

  const renderRunList = () => (
    <div
      style={{
        width: "300px",
        minWidth: "300px",
        borderRight: "1px solid #dee2e6",
        paddingRight: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div>
        <label htmlFor={`${formId}-search`} style={{ fontSize: "12px", fontWeight: 600 }}>
          Filter runs
        </label>
        <input
          id={`${formId}-search`}
          type="text"
          value={searchQuery}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          placeholder="Search by title, ID, or status..."
          style={{
            width: "100%",
            padding: "4px 8px",
            fontSize: "13px",
            border: "1px solid #ced4da",
            borderRadius: "4px",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div
        role="list"
        aria-label="Runs list"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          overflowY: "auto",
          maxHeight: "calc(100vh - 200px)",
        }}
      >
        {filteredRuns.length === 0 && (
          <div
            style={{ color: "#6c757d", fontSize: "13px", padding: "16px 0", textAlign: "center" }}
          >
            {searchQuery ? "No matching runs" : "No runs found"}
          </div>
        )}
        {filteredRuns.map((entry) => (
          <button
            key={entry.runId}
            role="listitem"
            onClick={() => selectRun(entry.runId)}
            aria-label={`Run: ${entry.title} (${entry.status})`}
            aria-pressed={selectedRunId === entry.runId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px",
              border: selectedRunId === entry.runId ? "2px solid #80bdff" : "1px solid #dee2e6",
              borderRadius: "6px",
              backgroundColor: selectedRunId === entry.runId ? "#f0f8ff" : "#fff",
              cursor: "pointer",
              textAlign: "left",
              fontSize: "13px",
              fontFamily: "inherit",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <span style={getStatusStyle(entry.status)}>{statusLabel(entry.status)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.title}
              </div>
              <div style={{ fontSize: "11px", color: "#6c757d" }}>
                {entry.runId.slice(0, 8)}&hellip;
                {entry.startedAt && ` · ${formatTime(entry.startedAt)}`}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Render event timeline ──

  const renderTimeline = () => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
      {sseUrl && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "4px 0",
            borderBottom: "1px solid #e5e7eb",
            paddingBottom: "8px",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: connectionBadgeColor[connectionStatus],
              display: "inline-block",
              flexShrink: 0,
            }}
            aria-label={`SSE: ${connectionStatus}`}
          />
          <span style={{ fontSize: "11px", color: "#6b7280", fontWeight: 500 }}>
            {connectionBadgeLabel[connectionStatus]}
          </span>
          <span style={{ fontSize: "11px", color: "#9ca3af" }}>
            {liveEvents.length} event{liveEvents.length !== 1 ? "s" : ""}
          </span>
          {eventTypes.length > 0 && (
            <select
              value={eventTypeFilter}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setEventTypeFilter(e.target.value)}
              aria-label="Filter events by type"
              style={{
                marginLeft: "auto",
                padding: "2px 6px",
                fontSize: "11px",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
              }}
            >
              <option value="">All events</option>
              {eventTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <label
            style={{
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={eventAutoScroll}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEventAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
        </div>
      )}

      <div
        ref={eventContainerRef}
        role="log"
        aria-label="Live events"
        aria-live="polite"
        style={{
          flex: 1,
          overflowY: "auto",
          backgroundColor: "#fafafa",
          border: "1px solid #e5e7eb",
          borderRadius: "4px",
          fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
          fontSize: "11px",
          lineHeight: 1.6,
          padding: "4px 0",
        }}
      >
        {filteredEvents.length === 0 && (
          <div style={{ color: "#9ca3af", padding: "16px", textAlign: "center", fontSize: "12px" }}>
            {connectionStatus === "connected"
              ? "Waiting for events..."
              : "Not connected to event stream"}
          </div>
        )}
        {filteredEvents.map((event, idx) => (
          <div
            key={`${event.time}-${idx}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "6px",
              padding: "2px 8px",
              backgroundColor:
                event.type.includes("failed") || event.type.includes("error")
                  ? "rgba(239,68,68,0.04)"
                  : "transparent",
            }}
          >
            <span
              style={{
                color: getEventColor(event),
                flexShrink: 0,
                width: "14px",
                textAlign: "center",
              }}
            >
              {getEventIcon(event)}
            </span>
            <span style={{ color: "#9ca3af", flexShrink: 0, width: "80px" }}>
              {formatTime(event.time)}
            </span>
            <span
              style={{
                color: getEventColor(event),
                flexShrink: 0,
                fontWeight:
                  event.type.includes("failed") || event.type.includes("error") ? 600 : 400,
              }}
            >
              {event.type}
            </span>
            {event.message && (
              <span
                style={{
                  color: "#374151",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {event.message}
              </span>
            )}
            {event.taskId && (
              <span style={{ color: "#9ca3af", flexShrink: 0, marginLeft: "auto" }}>
                {event.taskId.slice(0, 8)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // ── Render artifacts ──

  const renderArtifacts = () => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
      <div
        style={{ fontSize: "12px", fontWeight: 600, color: "#6c757d", textTransform: "uppercase" }}
      >
        Artifacts ({artifacts.length})
      </div>
      {loadingArtifacts && (
        <div style={{ color: "#6c757d", fontSize: "13px" }}>Loading artifacts...</div>
      )}
      {!loadingArtifacts && artifacts.length === 0 && (
        <div style={{ color: "#6c757d", fontSize: "13px" }}>No artifacts for this run</div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          overflowY: "auto",
          flex: 1,
        }}
      >
        {artifacts.map((artifact) => (
          <div
            key={artifact.artifactId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px",
              border: "1px solid #e5e7eb",
              borderRadius: "4px",
              backgroundColor: "#fff",
            }}
          >
            <span style={{ fontSize: "16px" }}>
              {artifact.type === "image"
                ? "\uD83D\uDDBC"
                : artifact.type === "text"
                  ? "\uD83D\uDCC4"
                  : "\uD83D\uDCC1"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {artifact.title}
              </div>
              <div style={{ fontSize: "11px", color: "#6c757d" }}>
                {artifact.type} &middot; {formatDateTime(artifact.createdAt)}
                {artifact.taskId && ` \u00B7 ${artifact.taskId.slice(0, 8)}`}
              </div>
            </div>
            <span style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace" }}>
              {artifact.path.split("/").pop()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  // ── Render run detail ──

  const renderRunDetail = () => {
    if (!selectedRunId) {
      return (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6c757d",
          }}
        >
          Select a run to view details
        </div>
      );
    }

    if (!run) {
      return (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6c757d",
          }}
        >
          Loading run details...
        </div>
      );
    }

    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
        {/* ── Run header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            paddingBottom: "8px",
            borderBottom: "1px solid #dee2e6",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600, flex: 1, minWidth: 0 }}>
            {run.title}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {sseUrl && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontWeight: 500,
                  color: connectionBadgeColor[connectionStatus],
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: `${connectionBadgeColor[connectionStatus]}15`,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: connectionBadgeColor[connectionStatus],
                    display: "inline-block",
                  }}
                />
                {connectionBadgeLabel[connectionStatus]}
              </span>
            )}
            <span style={getStatusStyle(run.status)}>{statusLabel(run.status)}</span>
            <span style={{ fontSize: "12px", color: "#6c757d" }}>
              {progressDone}/{progressTotal} tasks
            </span>
            <span style={{ fontSize: "12px", color: "#6c757d" }}>
              {formatShortDuration(run.durationMs)}
            </span>
          </div>

          {onCancelRun && isActiveStatus(run.status) && (
            <button
              onClick={cancelRun}
              disabled={loadingRun}
              style={{
                padding: "4px 12px",
                fontSize: "12px",
                border: "1px solid #dc3545",
                borderRadius: "4px",
                backgroundColor: "#fff",
                color: "#dc3545",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {loadingRun ? "Cancelling..." : "Cancel Run"}
            </button>
          )}
        </div>

        {/* ── Errors ── */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              padding: "8px 12px",
              backgroundColor: "#f8d7da",
              color: "#721c24",
              borderRadius: "4px",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "16px",
                color: "#721c24",
              }}
            >
              &times;
            </button>
          </div>
        )}
        {successMsg && (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: "8px 12px",
              backgroundColor: "#d4edda",
              color: "#155724",
              borderRadius: "4px",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{successMsg}</span>
            <button
              onClick={() => setSuccessMsg(null)}
              aria-label="Dismiss success"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "16px",
                color: "#155724",
              }}
            >
              &times;
            </button>
          </div>
        )}

        {/* ── Waiting input / approval ── */}
        {waitingInputInfo && onProvideInput && (
          <ApprovalInputHandler
            runId={selectedRunId!}
            task={waitingInputInfo.task}
            step={waitingInputInfo.step}
            onProvideInput={onProvideInput}
          />
        )}

        {/* ── View tabs ── */}
        <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid #dee2e6" }}>
          {(["tasks", "timeline", "artifacts"] as const).map((view) => (
            <button
              key={view}
              onClick={() => setDetailView(view)}
              aria-pressed={detailView === view}
              style={{
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                border: "none",
                borderBottom: detailView === view ? "2px solid #3b82f6" : "2px solid transparent",
                backgroundColor: "transparent",
                color: detailView === view ? "#3b82f6" : "#6b7280",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {view}
              {view === "timeline" && liveEvents.length > 0 && (
                <span style={{ marginLeft: "4px", fontSize: "10px", color: "#9ca3af" }}>
                  ({liveEvents.length})
                </span>
              )}
              {view === "artifacts" && artifacts.length > 0 && (
                <span style={{ marginLeft: "4px", fontSize: "10px", color: "#9ca3af" }}>
                  ({artifacts.length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── View content ── */}
        {detailView === "tasks" && (
          <div style={{ display: "flex", gap: "12px", flex: 1, minHeight: 0 }}>
            {/* Task list */}
            <div
              style={{
                width: "240px",
                minWidth: "240px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                overflowY: "auto",
                borderRight: "1px solid #dee2e6",
                paddingRight: "8px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#6c757d",
                  textTransform: "uppercase",
                  marginBottom: "4px",
                }}
              >
                Tasks
              </div>
              {tasks.length === 0 && (
                <div style={{ fontSize: "13px", color: "#6c757d" }}>No tasks</div>
              )}
              {tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => selectTask(task.id)}
                  aria-label={`Task: ${task.title} (${task.status})`}
                  aria-pressed={activeTaskId === task.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 8px",
                    border: activeTaskId === task.id ? "2px solid #80bdff" : "1px solid #dee2e6",
                    borderRadius: "4px",
                    backgroundColor: activeTaskId === task.id ? "#f0f8ff" : "#fff",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "12px",
                    fontFamily: "inherit",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  <span style={getStatusStyle(task.status)}>{statusLabel(task.status)}</span>
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {task.title}
                  </span>
                </button>
              ))}
            </div>

            {/* Step list + Logs */}
            <div
              style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}
            >
              {/* Step list */}
              {activeTaskId && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    maxHeight: "120px",
                    overflowY: "auto",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#6c757d",
                      textTransform: "uppercase",
                    }}
                  >
                    Steps
                  </div>
                  {activeTaskSteps.length === 0 && (
                    <div style={{ fontSize: "12px", color: "#6c757d" }}>No steps</div>
                  )}
                  {activeTaskSteps.map((step) => (
                    <button
                      key={step.id}
                      onClick={() => selectStep(step.id)}
                      aria-label={`Step: ${step.title} (${step.status})`}
                      aria-pressed={activeStepId === step.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 8px",
                        border:
                          activeStepId === step.id ? "2px solid #80bdff" : "1px solid #dee2e6",
                        borderRadius: "4px",
                        backgroundColor: activeStepId === step.id ? "#f0f8ff" : "#fff",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: "12px",
                        fontFamily: "inherit",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    >
                      <span style={getStatusStyle(step.status)}>{statusLabel(step.status)}</span>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {step.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Step detail */}
              {activeStep && (
                <div
                  style={{
                    fontSize: "12px",
                    backgroundColor: "#f8f9fa",
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #dee2e6",
                  }}
                >
                  {activeStep.command && (
                    <div>
                      <strong>Command:</strong>{" "}
                      <code style={{ fontSize: "12px" }}>{activeStep.command}</code>
                    </div>
                  )}
                  {activeStep.exitCode !== undefined && (
                    <div>
                      <strong>Exit code:</strong> {activeStep.exitCode}
                    </div>
                  )}
                  {activeStep.startedAt && (
                    <div>
                      <strong>Started:</strong> {formatTime(activeStep.startedAt)}
                    </div>
                  )}
                  {activeStep.finishedAt && (
                    <div>
                      <strong>Finished:</strong> {formatTime(activeStep.finishedAt)}
                    </div>
                  )}
                </div>
              )}

              {/* Log viewer */}
              {(activeTaskId || activeStepId) && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "4px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#6c757d",
                        textTransform: "uppercase",
                      }}
                    >
                      Logs
                    </div>
                    <label
                      style={{
                        fontSize: "12px",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={autoScroll}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setAutoScroll(e.target.checked)
                        }
                      />
                      Auto-scroll
                    </label>
                  </div>
                  <div
                    ref={logContainerRef}
                    style={{
                      flex: 1,
                      backgroundColor: "#1e1e1e",
                      color: "#d4d4d4",
                      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
                      fontSize: "12px",
                      padding: "8px",
                      borderRadius: "4px",
                      overflowY: "auto",
                      maxHeight: "300px",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                    role="log"
                    aria-label="Run logs"
                    aria-live="polite"
                  >
                    {logLines.length === 0 && (
                      <div style={{ color: "#6c757d" }}>No log output yet</div>
                    )}
                    {logLines.map((entry, idx) => (
                      <div
                        key={idx}
                        style={{
                          color: entry.isError ? "#f48771" : "#d4d4d4",
                          backgroundColor: entry.isError
                            ? "rgba(244, 135, 113, 0.1)"
                            : "transparent",
                        }}
                      >
                        {entry.line || "\u00A0"}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Errors section */}
              {hasErrors && (
                <div style={{ borderTop: "1px solid #dee2e6", paddingTop: "8px" }}>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#721c24",
                      marginBottom: "4px",
                    }}
                  >
                    Errors ({runErrors.length + taskErrors.length})
                  </div>
                  {runErrors.map((err, idx) => (
                    <div
                      key={`run-err-${idx}`}
                      style={{
                        padding: "6px 8px",
                        backgroundColor: "#fff5f5",
                        border: "1px solid #f8d7da",
                        borderRadius: "4px",
                        marginBottom: "4px",
                        fontSize: "12px",
                      }}
                    >
                      <div>
                        <strong>Run Error:</strong> {err.message}
                      </div>
                      {err.timestamp && (
                        <div style={{ color: "#6c757d" }}>{formatTime(err.timestamp)}</div>
                      )}
                    </div>
                  ))}
                  {taskErrors.map((te) =>
                    te.errors.map((err, idx) => (
                      <div
                        key={`task-err-${te.taskId}-${idx}`}
                        style={{
                          padding: "6px 8px",
                          backgroundColor: "#fff5f5",
                          border: "1px solid #f8d7da",
                          borderRadius: "4px",
                          marginBottom: "4px",
                          fontSize: "12px",
                        }}
                      >
                        <div>
                          <strong>{te.title}:</strong> {err.message}
                        </div>
                        {err.timestamp && (
                          <div style={{ color: "#6c757d" }}>{formatTime(err.timestamp)}</div>
                        )}
                      </div>
                    )),
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {detailView === "timeline" && renderTimeline()}
        {detailView === "artifacts" && renderArtifacts()}
      </div>
    );
  };

  // ── Loading state ──

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{ padding: "24px", textAlign: "center", color: "#6c757d" }}
      >
        Loading run monitor...
      </div>
    );
  }

  // ── Main render ──

  return (
    <div
      role="region"
      aria-label="Run monitor"
      style={{ display: "flex", gap: "16px", height: "100%", minHeight: "400px" }}
    >
      {renderRunList()}
      {renderRunDetail()}
    </div>
  );
}
