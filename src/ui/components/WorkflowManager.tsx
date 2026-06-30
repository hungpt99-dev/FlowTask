import { useState, useCallback, useEffect, useId, useMemo, type ChangeEvent } from "react";
import type { RunIndexEntry } from "../../schemas/run.schema.js";
import type { WorkflowFile, WorkflowTask } from "../../schemas/workflow.schema.js";

type FormErrors = Partial<Record<string, string>>;

type ViewMode = "list" | "create" | "detail";

const DEFAULT_MODES = ["auto", "manual", "simple"] as const;

const STATUS_LABELS: Record<string, string> = {
  created: "Created",
  running: "Running",
  paused: "Paused",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  stuck: "Stuck",
  needs_user_review: "Needs Review",
  waiting_input: "Waiting Input",
  waiting_approval: "Waiting Approval",
  planning: "Planning",
  validating: "Validating",
};

const STATUS_COLORS: Record<string, string> = {
  created: "#6b7280",
  running: "#3b82f6",
  paused: "#f59e0b",
  succeeded: "#22c55e",
  failed: "#ef4444",
  cancelled: "#6b7280",
  stuck: "#ef4444",
  needs_user_review: "#a855f7",
  waiting_input: "#a855f7",
  waiting_approval: "#f59e0b",
  planning: "#3b82f6",
  validating: "#3b82f6",
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export interface WorkflowManagerProps {
  workflows?: RunIndexEntry[];
  currentWorkflow?: WorkflowFile | null;
  onListWorkflows?: () => Promise<RunIndexEntry[]>;
  onCreateWorkflow?: (title: string, mode?: string, userGoal?: string) => Promise<RunIndexEntry>;
  onLoadWorkflow?: (runId: string) => Promise<WorkflowFile>;
  onSaveWorkflow?: (runId: string, workflow: WorkflowFile) => Promise<void>;
  onDeleteWorkflow?: (runId: string) => Promise<void>;
  onRunWorkflow?: (runId: string) => Promise<void>;
  onDuplicateWorkflow?: (runId: string, newTitle?: string) => Promise<RunIndexEntry>;
}

export function WorkflowManager({
  workflows: propWorkflows,
  currentWorkflow: propCurrentWorkflow,
  onListWorkflows,
  onCreateWorkflow,
  onLoadWorkflow,
  onSaveWorkflow,
  onDeleteWorkflow,
  onRunWorkflow,
  onDuplicateWorkflow,
}: WorkflowManagerProps) {
  const formId = useId();

  const [view, setView] = useState<ViewMode>("list");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<RunIndexEntry[]>(propWorkflows ?? []);
  const [currentWorkflow, setCurrentWorkflow] = useState<WorkflowFile | null>(
    propCurrentWorkflow ?? null,
  );
  const [internalTasks, setInternalTasks] = useState<WorkflowTask[]>([]);
  const [internalRunTitle, setInternalRunTitle] = useState("");
  const [selectedRun, setSelectedRun] = useState<RunIndexEntry | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [createTitle, setCreateTitle] = useState("");
  const [createMode, setCreateMode] = useState("auto");
  const [createGoal, setCreateGoal] = useState("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (propWorkflows) {
      setWorkflows(propWorkflows);
    }
  }, [propWorkflows]);

  useEffect(() => {
    if (propCurrentWorkflow) {
      setCurrentWorkflow(propCurrentWorkflow);
    }
  }, [propCurrentWorkflow]);

  useEffect(() => {
    if (view === "list" && onListWorkflows) {
      setLoading(true);
      setError(null);
      onListWorkflows()
        .then((list) => setWorkflows(list))
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : "Failed to load workflows"),
        )
        .finally(() => setLoading(false));
    }
  }, [view, onListWorkflows]);

  const filteredWorkflows = useMemo(() => {
    let result = workflows;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((w) => w.title.toLowerCase().includes(q));
    }
    if (statusFilter) {
      result = result.filter((w) => w.status === statusFilter);
    }
    return result;
  }, [workflows, searchQuery, statusFilter]);

  const statusOptions = useMemo(() => {
    const unique = new Set(workflows.map((w) => w.status));
    return [...unique].sort();
  }, [workflows]);

  const goToList = useCallback(() => {
    setView("list");
    setSelectedRunId(null);
    setSelectedRun(null);
    setCurrentWorkflow(null);
    setInternalTasks([]);
    setInternalRunTitle("");
    setError(null);
    setDeleteConfirmId(null);
  }, []);

  const goToCreate = useCallback(() => {
    setView("create");
    setCreateTitle("");
    setCreateMode("auto");
    setCreateGoal("");
    setFormErrors({});
    setError(null);
  }, []);

  const openWorkflow = useCallback(
    async (entry: RunIndexEntry) => {
      setView("detail");
      setSelectedRunId(entry.runId);
      setSelectedRun(entry);
      setError(null);
      setDeleteConfirmId(null);

      if (onLoadWorkflow) {
        setLoading(true);
        try {
          const wf = await onLoadWorkflow(entry.runId);
          setCurrentWorkflow(wf);
          setInternalTasks(wf.tasks ?? []);
          setInternalRunTitle(wf.runTitle ?? entry.title);
        } catch (err: unknown) {
          setCurrentWorkflow(null);
          setInternalTasks([]);
          setInternalRunTitle(entry.title);
          setError(err instanceof Error ? err.message : "Failed to load workflow tasks");
        } finally {
          setLoading(false);
        }
      } else {
        setCurrentWorkflow(null);
        setInternalTasks([]);
        setInternalRunTitle(entry.title);
      }
    },
    [onLoadWorkflow],
  );

  const handleCreate = useCallback(async () => {
    const errors: FormErrors = {};
    if (!createTitle.trim()) {
      errors.title = "Workflow title is required";
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const entry = await onCreateWorkflow?.(
        createTitle.trim(),
        createMode,
        createGoal.trim() || undefined,
      );
      if (entry) {
        setWorkflows((prev) => [entry, ...prev]);
        setView("detail");
        setSelectedRunId(entry.runId);
        setSelectedRun(entry);
        setInternalRunTitle(entry.title);
        setInternalTasks([]);
        setCurrentWorkflow(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create workflow");
    } finally {
      setSaving(false);
    }
  }, [createTitle, createMode, createGoal, onCreateWorkflow]);

  const handleSave = useCallback(async () => {
    if (!selectedRunId) return;

    if (internalTasks.length === 0) {
      setError("Workflow must have at least one task");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const wf: WorkflowFile = {
        runTitle: internalRunTitle.trim() || undefined,
        tasks: internalTasks,
      };
      if (onSaveWorkflow) {
        await onSaveWorkflow(selectedRunId, wf);
      }
      setCurrentWorkflow(wf);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  }, [selectedRunId, internalTasks, internalRunTitle, onSaveWorkflow]);

  const handleRun = useCallback(async () => {
    if (!selectedRunId) return;
    setError(null);
    try {
      await onRunWorkflow?.(selectedRunId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to run workflow");
    }
  }, [selectedRunId, onRunWorkflow]);

  const confirmDelete = useCallback((runId: string) => {
    setDeleteConfirmId(runId);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirmId) return;
    setSaving(true);
    setError(null);
    try {
      await onDeleteWorkflow?.(deleteConfirmId);
      setWorkflows((prev) => prev.filter((w) => w.runId !== deleteConfirmId));
      setDeleteConfirmId(null);
      if (selectedRunId === deleteConfirmId) {
        goToList();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete workflow");
    } finally {
      setSaving(false);
    }
  }, [deleteConfirmId, onDeleteWorkflow, selectedRunId, goToList]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedRunId) return;
    setSaving(true);
    setError(null);
    try {
      const entry = await onDuplicateWorkflow?.(selectedRunId);
      if (entry) {
        setWorkflows((prev) => [entry, ...prev]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to duplicate workflow");
    } finally {
      setSaving(false);
    }
  }, [selectedRunId, onDuplicateWorkflow]);

  const addTask = useCallback(() => {
    setInternalTasks((prev) => [
      ...prev,
      {
        id: `task_${Date.now()}`,
        title: "New task",
        description: "",
        executor: "shell",
        dependsOn: [],
        acceptanceCriteria: [],
        maxRetries: 2,
      },
    ]);
  }, []);

  const updateTask = useCallback((taskId: string, updates: Partial<WorkflowTask>) => {
    setInternalTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)));
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setInternalTasks((prev) =>
      prev
        .filter((t) => t.id !== taskId)
        .map((t) => ({
          ...t,
          dependsOn: t.dependsOn?.filter((d) => d !== taskId),
        })),
    );
  }, []);

  const moveTask = useCallback((taskId: string, direction: "up" | "down") => {
    setInternalTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === taskId);
      if (idx < 0) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(newIdx, 0, moved!);
      return next;
    });
  }, []);

  if (view === "create") {
    return (
      <div role="region" aria-label="Create workflow">
        <div>
          <button onClick={goToList} aria-label="Back to workflow list">
            &larr; Back
          </button>
        </div>

        <h2
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#111827",
            margin: "12px 0 20px",
          }}
        >
          Create Workflow
        </h2>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              padding: "10px 14px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "6px",
              color: "#b91c1c",
              fontSize: "13px",
              marginBottom: "16px",
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
                color: "#b91c1c",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "13px",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        <div
          style={{
            padding: "20px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <label
              htmlFor={`${formId}-title`}
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "4px",
              }}
            >
              Title *
            </label>
            <input
              id={`${formId}-title`}
              type="text"
              value={createTitle}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateTitle(e.target.value)}
              placeholder="My workflow"
              aria-invalid={!!formErrors.title}
              aria-describedby={formErrors.title ? `${formId}-title-error` : undefined}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: `1px solid ${formErrors.title ? "#ef4444" : "#d1d5db"}`,
                borderRadius: "6px",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
            {formErrors.title && (
              <span
                id={`${formId}-title-error`}
                role="alert"
                style={{ color: "#ef4444", fontSize: "12px", marginTop: "4px" }}
              >
                {formErrors.title}
              </span>
            )}
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label
              htmlFor={`${formId}-mode`}
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "4px",
              }}
            >
              Mode
            </label>
            <select
              id={`${formId}-mode`}
              value={createMode}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setCreateMode(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            >
              {DEFAULT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label
              htmlFor={`${formId}-goal`}
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "4px",
              }}
            >
              Goal (optional)
            </label>
            <textarea
              id={`${formId}-goal`}
              value={createGoal}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCreateGoal(e.target.value)}
              placeholder="Describe the goal of this workflow"
              rows={3}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                boxSizing: "border-box",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleCreate}
              disabled={saving}
              style={{
                padding: "8px 20px",
                backgroundColor: "#3b82f6",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Creating..." : "Create Workflow"}
            </button>
            <button
              onClick={goToList}
              disabled={saving}
              style={{
                padding: "8px 20px",
                backgroundColor: "#fff",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "detail") {
    const running = selectedRun?.status === "running";
    const terminal = selectedRun
      ? ["succeeded", "failed", "cancelled"].includes(selectedRun.status)
      : false;

    return (
      <div role="region" aria-label="Workflow detail">
        <div style={{ marginBottom: "16px" }}>
          <button
            onClick={goToList}
            aria-label="Back to workflow list"
            style={{
              background: "none",
              border: "none",
              color: "#3b82f6",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              padding: 0,
            }}
          >
            &larr; Back to workflows
          </button>
        </div>

        {selectedRun && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: "16px",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "#111827",
                  margin: "0 0 4px",
                }}
              >
                {selectedRun.title}
              </h2>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  fontSize: "12px",
                  color: "#6b7280",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: STATUS_COLORS[selectedRun.status] ?? "#6b7280",
                      display: "inline-block",
                    }}
                  />
                  {STATUS_LABELS[selectedRun.status] ?? selectedRun.status}
                </span>
                <span>Mode: {selectedRun.mode ?? "auto"}</span>
                <span>
                  Tasks: {selectedRun.completedTaskCount}/{selectedRun.taskCount}
                </span>
                <span>Created: {formatDate(selectedRun.createdAt)}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleRun}
                disabled={running || saving}
                aria-label="Run this workflow"
                title={running ? "Workflow is already running" : "Run workflow"}
                style={{
                  padding: "6px 14px",
                  backgroundColor: running ? "#d1d5db" : "#22c55e",
                  color: running ? "#6b7280" : "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: running || saving ? "not-allowed" : "pointer",
                  opacity: running || saving ? 0.6 : 1,
                }}
              >
                {running ? "Running..." : "Run"}
              </button>
              <button
                onClick={handleDuplicate}
                disabled={saving}
                aria-label="Duplicate this workflow"
                style={{
                  padding: "6px 14px",
                  backgroundColor: "#fff",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                Duplicate
              </button>
              {!running && terminal && (
                <button
                  onClick={() => setDeleteConfirmId(selectedRun.runId)}
                  disabled={saving}
                  aria-label="Delete this workflow"
                  style={{
                    padding: "6px 14px",
                    backgroundColor: "#fff",
                    color: "#ef4444",
                    border: "1px solid #fecaca",
                    borderRadius: "6px",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              padding: "10px 14px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "6px",
              color: "#b91c1c",
              fontSize: "13px",
              marginBottom: "16px",
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
                color: "#b91c1c",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "13px",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {deleteConfirmId && (
          <div
            role="alertdialog"
            aria-label="Confirm delete workflow"
            style={{
              padding: "16px",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              backgroundColor: "#fef2f2",
              marginBottom: "16px",
            }}
          >
            <p
              style={{
                margin: "0 0 12px",
                fontSize: "14px",
                color: "#b91c1c",
                fontWeight: 500,
              }}
            >
              Delete workflow "{selectedRun?.title}"? This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleDelete}
                disabled={saving}
                style={{
                  padding: "6px 16px",
                  backgroundColor: "#ef4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Deleting..." : "Delete"}
              </button>
              <button
                onClick={() => setDeleteConfirmId(null)}
                disabled={saving}
                style={{
                  padding: "6px 16px",
                  backgroundColor: "#fff",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading && !currentWorkflow && (
          <div role="status" aria-live="polite" style={{ color: "#6b7280", fontSize: "14px" }}>
            Loading workflow tasks...
          </div>
        )}

        {!loading && (
          <div
            style={{
              padding: "20px",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <h3
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#374151",
                  margin: 0,
                }}
              >
                Tasks ({internalTasks.length})
              </h3>
              <button
                onClick={addTask}
                aria-label="Add task to workflow"
                style={{
                  padding: "4px 12px",
                  backgroundColor: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                + Add Task
              </button>
            </div>

            {internalTasks.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 16px",
                  color: "#9ca3af",
                  fontSize: "13px",
                }}
              >
                No tasks yet. Add a task to define the workflow steps.
              </div>
            )}

            <div role="list" aria-label="Workflow tasks">
              {internalTasks.map((task, index) => (
                <div
                  key={task.id}
                  role="listitem"
                  aria-label={`Task: ${task.title}`}
                  style={{
                    padding: "12px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "6px",
                    marginBottom: "8px",
                    backgroundColor: "#fafafa",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "8px",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <input
                        type="text"
                        value={task.title}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          updateTask(task.id, { title: e.target.value })
                        }
                        aria-label={`Title for task ${index + 1}`}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          fontSize: "13px",
                          fontWeight: 600,
                          boxSizing: "border-box",
                          marginBottom: "4px",
                        }}
                      />
                      <input
                        type="text"
                        value={task.description ?? ""}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          updateTask(task.id, { description: e.target.value })
                        }
                        aria-label={`Description for task ${index + 1}`}
                        placeholder="Description (optional)"
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          fontSize: "12px",
                          boxSizing: "border-box",
                          color: "#6b7280",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "4px",
                        marginLeft: "8px",
                        flexShrink: 0,
                      }}
                    >
                      <button
                        onClick={() => moveTask(task.id, "up")}
                        disabled={index === 0}
                        aria-label={`Move task ${index + 1} up`}
                        style={{
                          padding: "2px 6px",
                          fontSize: "11px",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          background: index === 0 ? "#f3f4f6" : "#fff",
                          color: index === 0 ? "#d1d5db" : "#374151",
                          cursor: index === 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        &uarr;
                      </button>
                      <button
                        onClick={() => moveTask(task.id, "down")}
                        disabled={index === internalTasks.length - 1}
                        aria-label={`Move task ${index + 1} down`}
                        style={{
                          padding: "2px 6px",
                          fontSize: "11px",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          background: index === internalTasks.length - 1 ? "#f3f4f6" : "#fff",
                          color: index === internalTasks.length - 1 ? "#d1d5db" : "#374151",
                          cursor: index === internalTasks.length - 1 ? "not-allowed" : "pointer",
                        }}
                      >
                        &darr;
                      </button>
                      <button
                        onClick={() => removeTask(task.id)}
                        aria-label={`Remove task ${task.title}`}
                        style={{
                          padding: "2px 6px",
                          fontSize: "11px",
                          border: "1px solid #fecaca",
                          borderRadius: "4px",
                          background: "#fff",
                          color: "#ef4444",
                          cursor: "pointer",
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      fontSize: "12px",
                      color: "#6b7280",
                    }}
                  >
                    <select
                      value={task.executor ?? "shell"}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        updateTask(task.id, { executor: e.target.value })
                      }
                      aria-label={`Executor for task ${index + 1}`}
                      style={{
                        padding: "3px 6px",
                        border: "1px solid #d1d5db",
                        borderRadius: "4px",
                        fontSize: "12px",
                      }}
                    >
                      <option value="shell">shell</option>
                      <option value="opencode">opencode</option>
                      <option value="claude">claude</option>
                      <option value="codex">codex</option>
                      <option value="gemini">gemini</option>
                      <option value="aider">aider</option>
                      <option value="manual">manual</option>
                    </select>
                    <label>
                      Retries:
                      <input
                        type="number"
                        min={0}
                        value={task.maxRetries ?? 2}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          updateTask(task.id, {
                            maxRetries: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        style={{
                          width: "50px",
                          marginLeft: "4px",
                          padding: "3px 6px",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          fontSize: "12px",
                        }}
                      />
                    </label>
                  </div>

                  <div
                    style={{
                      marginTop: "8px",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "4px",
                      fontSize: "12px",
                    }}
                  >
                    {(task.acceptanceCriteria ?? []).map((crit, ci) => (
                      <span
                        key={ci}
                        style={{
                          padding: "2px 6px",
                          backgroundColor: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          borderRadius: "4px",
                          color: "#15803d",
                          fontSize: "11px",
                        }}
                      >
                        {crit}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                gap: "8px",
                marginTop: "16px",
                paddingTop: "16px",
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "8px 20px",
                  backgroundColor: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving..." : "Save Workflow"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div role="region" aria-label="Workflow list">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h2
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#111827",
            margin: 0,
          }}
        >
          Workflows
        </h2>
        <button
          onClick={goToCreate}
          aria-label="Create new workflow"
          style={{
            padding: "8px 16px",
            backgroundColor: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + New Workflow
        </button>
      </div>

      {/* Search and filter */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "16px",
        }}
      >
        <input
          type="text"
          value={searchQuery}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          placeholder="Search workflows..."
          aria-label="Search workflows"
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            fontSize: "13px",
          }}
        />
        <select
          value={statusFilter}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          style={{
            padding: "8px 12px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            fontSize: "13px",
            minWidth: "130px",
          }}
        >
          <option value="">All statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: "10px 14px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            color: "#b91c1c",
            fontSize: "13px",
            marginBottom: "16px",
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
              color: "#b91c1c",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && (
        <div
          role="status"
          aria-live="polite"
          style={{ textAlign: "center", padding: "32px", color: "#6b7280", fontSize: "14px" }}
        >
          Loading workflows...
        </div>
      )}

      {!loading && filteredWorkflows.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "48px 24px",
            color: "#9ca3af",
            fontSize: "14px",
          }}
        >
          {searchQuery || statusFilter
            ? "No workflows match your search criteria."
            : "No workflows yet. Create one to get started."}
        </div>
      )}

      {!loading && (
        <div role="list" aria-label="Workflow list">
          {filteredWorkflows.map((wf) => (
            <div
              key={wf.runId}
              role="listitem"
              style={{
                padding: "14px 16px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                marginBottom: "8px",
                cursor: "pointer",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#3b82f6";
                e.currentTarget.style.boxShadow = "0 1px 3px rgba(59,130,246,0.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.boxShadow = "none";
              }}
              onClick={() => openWorkflow(wf)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openWorkflow(wf);
                }
              }}
              tabIndex={0}
              aria-label={`Workflow: ${wf.title} (${STATUS_LABELS[wf.status] ?? wf.status})`}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#111827",
                      marginBottom: "2px",
                    }}
                  >
                    {wf.title}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      fontSize: "12px",
                      color: "#6b7280",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          backgroundColor: STATUS_COLORS[wf.status] ?? "#6b7280",
                          display: "inline-block",
                        }}
                      />
                      {STATUS_LABELS[wf.status] ?? wf.status}
                    </span>
                    <span>
                      {wf.completedTaskCount}/{wf.taskCount} tasks
                    </span>
                    {wf.mode && <span>Mode: {wf.mode}</span>}
                    <span>{formatDate(wf.createdAt)}</span>
                  </div>
                </div>

                <div
                  style={{ display: "flex", gap: "4px", marginLeft: "12px" }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => openWorkflow(wf)}
                    aria-label={`Open workflow ${wf.title}`}
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "4px",
                      backgroundColor: "#fff",
                      color: "#374151",
                      cursor: "pointer",
                    }}
                  >
                    Open
                  </button>
                  {deleteConfirmId === wf.runId ? (
                    <div
                      style={{
                        display: "flex",
                        gap: "4px",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontSize: "11px", color: "#ef4444" }}>Confirm?</span>
                      <button
                        onClick={handleDelete}
                        disabled={saving}
                        aria-label={`Confirm delete ${wf.title}`}
                        style={{
                          padding: "2px 8px",
                          fontSize: "11px",
                          backgroundColor: "#ef4444",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          cursor: saving ? "not-allowed" : "pointer",
                          opacity: saving ? 0.6 : 1,
                        }}
                      >
                        {saving ? "Deleting..." : "Delete"}
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        disabled={saving}
                        aria-label="Cancel delete"
                        style={{
                          padding: "2px 8px",
                          fontSize: "11px",
                          backgroundColor: "#fff",
                          color: "#374151",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          cursor: saving ? "not-allowed" : "pointer",
                          opacity: saving ? 0.6 : 1,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => confirmDelete(wf.runId)}
                      aria-label={`Delete workflow ${wf.title}`}
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        border: "1px solid #fecaca",
                        borderRadius: "4px",
                        backgroundColor: "#fff",
                        color: "#ef4444",
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
