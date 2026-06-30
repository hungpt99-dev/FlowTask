import { useState, useCallback, useEffect, useId, type ChangeEvent } from "react";
import { WorkflowTaskSchema, WorkflowFileSchema } from "../../schemas/workflow.schema.js";
import type { WorkflowFile, WorkflowTask } from "../../schemas/workflow.schema.js";

type FormErrors = Partial<Record<string, string>>;

const DEFAULT_EXECUTORS = ["shell", "opencode", "claude", "codex", "gemini", "aider", "manual"];

export interface WorkflowEditorProps {
  workflow?: WorkflowFile;
  onSave: (workflow: WorkflowFile) => Promise<void>;
  onLoad?: () => Promise<WorkflowFile>;
}

export function WorkflowEditor({ workflow, onSave, onLoad }: WorkflowEditorProps) {
  const formId = useId();
  const [tasks, setTasks] = useState<WorkflowTask[]>(workflow?.tasks ?? []);
  const [runTitle, setRunTitle] = useState(workflow?.runTitle ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<WorkflowTask>>({});
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (workflow) {
      setTasks(workflow.tasks);
      setRunTitle(workflow.runTitle ?? "");
    } else if (onLoad) {
      setLoading(true);
      setError(null);
      onLoad()
        .then((wf) => {
          setTasks(wf.tasks);
          setRunTitle(wf.runTitle ?? "");
        })
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : "Failed to load workflow"),
        )
        .finally(() => setLoading(false));
    }
  }, [workflow, onLoad]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setFormData({});
    setFormErrors({});
    setDeleteConfirmId(null);
  }, []);

  const startAdd = useCallback(() => {
    resetForm();
    setEditingId("__new__");
    setFormData({
      id: `task_${Date.now()}`,
      title: "",
      description: "",
      executor: "shell",
      dependsOn: [],
      acceptanceCriteria: [],
      maxRetries: 2,
    });
  }, [resetForm]);

  const startEdit = useCallback((task: WorkflowTask) => {
    setEditingId(task.id);
    setFormData({ ...task });
    setFormErrors({});
    setDeleteConfirmId(null);
  }, []);

  const cancelEdit = useCallback(() => {
    resetForm();
  }, [resetForm]);

  const updateField = useCallback((field: keyof WorkflowTask, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const validateForm = useCallback((): WorkflowTask | null => {
    const errors: FormErrors = {};

    if (!formData.title || String(formData.title).trim().length === 0) {
      errors.title = "Title is required";
    } else if (String(formData.title).length > 200) {
      errors.title = "Title must be 200 characters or less";
    }

    if (!formData.id || String(formData.id).trim().length === 0) {
      errors.id = "Task ID is required";
    }

    if (editingId === "__new__" && tasks.some((t) => t.id === formData.id)) {
      errors.id = "Task ID already exists";
    }

    if (formData.dependsOn) {
      const allIds = tasks.map((t) => t.id);
      if (editingId !== "__new__") {
        allIds.push(editingId!);
      }
      for (const dep of formData.dependsOn) {
        if (!allIds.includes(dep) && dep !== formData.id) {
          errors.dependsOn = `Dependency "${dep}" does not exist in the workflow`;
          break;
        }
      }
    }

    if (formData.maxRetries !== undefined) {
      const retries =
        typeof formData.maxRetries === "string"
          ? parseInt(formData.maxRetries as string, 10)
          : (formData.maxRetries as number);
      if (isNaN(retries) || retries < 0) {
        errors.maxRetries = "Max retries must be a non-negative integer";
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return null;
    }

    const result = WorkflowTaskSchema.safeParse({
      ...formData,
      title: String(formData.title ?? "").trim(),
      description: formData.description || undefined,
    });

    if (!result.success) {
      const zodErrors: FormErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path.join(".");
        zodErrors[field] = issue.message;
      }
      setFormErrors(zodErrors);
      return null;
    }

    return result.data;
  }, [formData, editingId, tasks]);

  const saveTask = useCallback(() => {
    const validated = validateForm();
    if (!validated) return;

    if (editingId === "__new__") {
      setTasks((prev) => [...prev, validated]);
    } else {
      setTasks((prev) => prev.map((t) => (t.id === editingId ? validated : t)));
    }
    resetForm();
  }, [validateForm, editingId, resetForm]);

  const confirmDelete = useCallback((taskId: string) => {
    setDeleteConfirmId(taskId);
    setEditingId(null);
  }, []);

  const executeDelete = useCallback((taskId: string) => {
    setTasks((prev) => {
      const remaining = prev.filter((t) => t.id !== taskId);
      return remaining.map((t) => ({
        ...t,
        dependsOn: t.dependsOn?.filter((d) => d !== taskId),
      }));
    });
    setDeleteConfirmId(null);
  }, []);

  const saveWorkflow = useCallback(async () => {
    if (tasks.length === 0) {
      setError("Workflow must have at least one task");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const workflowFile: WorkflowFile = {
        runTitle: runTitle.trim() || undefined,
        tasks,
      };
      const result = WorkflowFileSchema.safeParse(workflowFile);
      if (!result.success) {
        setError(`Invalid workflow: ${result.error.issues.map((i) => i.message).join("; ")}`);
        return;
      }
      await onSave(result.data);
      resetForm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  }, [tasks, runTitle, onSave, resetForm]);

  const addDependency = useCallback(
    (taskId: string) => {
      const deps = formData.dependsOn ?? [];
      if (!deps.includes(taskId)) {
        updateField("dependsOn", [...deps, taskId]);
      }
    },
    [formData.dependsOn, updateField],
  );

  const removeDependency = useCallback(
    (taskId: string) => {
      const deps = formData.dependsOn ?? [];
      updateField(
        "dependsOn",
        deps.filter((d) => d !== taskId),
      );
    },
    [formData.dependsOn, updateField],
  );

  if (loading) {
    return (
      <div role="status" aria-live="polite">
        Loading workflow...
      </div>
    );
  }

  return (
    <div role="region" aria-label="Workflow editor">
      {/* ── Title ── */}
      <div>
        <label htmlFor={`${formId}-workflow-title`}>Workflow title</label>
        <input
          id={`${formId}-workflow-title`}
          type="text"
          value={runTitle}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setRunTitle(e.target.value)}
          placeholder="Optional workflow title"
        />
      </div>

      {/* ── Error ── */}
      {error && (
        <div role="alert" aria-live="assertive">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      )}

      {/* ── Task list ── */}
      <div role="list" aria-label="Task list">
        {tasks.length === 0 && !editingId && <div>No tasks yet. Add one to get started.</div>}
        {tasks.map((task) => (
          <div key={task.id} role="listitem" aria-label={`Task: ${task.title}`}>
            {editingId === task.id ? (
              <TaskFormFields
                isNew={false}
                formData={formData}
                formErrors={formErrors}
                formId={formId}
                tasks={tasks}
                updateField={updateField}
                saveTask={saveTask}
                cancelEdit={cancelEdit}
                addDependency={addDependency}
                removeDependency={removeDependency}
              />
            ) : (
              <div>
                <div>
                  <strong>{task.title}</strong>
                  {task.executor && task.executor !== "shell" && <span>Exec: {task.executor}</span>}
                </div>
                {task.description && <div>{task.description}</div>}
                {task.dependsOn && task.dependsOn.length > 0 && (
                  <div>Depends on: {task.dependsOn.join(", ")}</div>
                )}
                <div>
                  <button onClick={() => startEdit(task)} aria-label={`Edit ${task.title}`}>
                    Edit
                  </button>
                  <button
                    onClick={() => confirmDelete(task.id)}
                    aria-label={`Delete ${task.title}`}
                  >
                    Delete
                  </button>
                </div>
                {deleteConfirmId === task.id && (
                  <div role="alertdialog" aria-label="Confirm delete">
                    <p>Delete "{task.title}"? Dependencies will be updated.</p>
                    <button onClick={() => executeDelete(task.id)}>Confirm Delete</button>
                    <button onClick={() => setDeleteConfirmId(null)}>Cancel</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Add new button ── */}
      {editingId === "__new__" && (
        <TaskFormFields
          isNew={true}
          formData={formData}
          formErrors={formErrors}
          formId={formId}
          tasks={tasks}
          updateField={updateField}
          saveTask={saveTask}
          cancelEdit={cancelEdit}
          addDependency={addDependency}
          removeDependency={removeDependency}
        />
      )}
      {editingId === null && <button onClick={startAdd}>Add Task</button>}

      {/* ── Save ── */}
      <div>
        <button onClick={saveWorkflow} disabled={saving || editingId !== null}>
          {saving ? "Saving..." : "Save Workflow"}
        </button>
        <button
          onClick={() => {
            resetForm();
            setError(null);
          }}
          disabled={saving}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/* ── Inline task form fields ── */

interface TaskFormFieldsProps {
  isNew: boolean;
  formData: Partial<WorkflowTask>;
  formErrors: FormErrors;
  formId: string;
  tasks: WorkflowTask[];
  updateField: (field: keyof WorkflowTask, value: unknown) => void;
  saveTask: () => void;
  cancelEdit: () => void;
  addDependency: (taskId: string) => void;
  removeDependency: (taskId: string) => void;
}

function TaskFormFields({
  isNew,
  formData,
  formErrors,
  formId,
  tasks,
  updateField,
  saveTask,
  cancelEdit,
  addDependency,
  removeDependency,
}: TaskFormFieldsProps) {
  const fieldId = (name: string) => `${formId}-${name}`;
  const errorId = (name: string) => `${fieldId(name)}-error`;

  const availableDeps = tasks
    .filter((t) => t.id !== formData.id)
    .filter((t) => !(formData.dependsOn ?? []).includes(t.id));

  return (
    <div role="form" aria-label="Task editor">
      {/* ID */}
      <div>
        <label htmlFor={fieldId("id")}>Task ID</label>
        <input
          id={fieldId("id")}
          type="text"
          value={String(formData.id ?? "")}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("id", e.target.value)}
          disabled={!isNew}
          aria-invalid={!!formErrors.id}
          aria-describedby={formErrors.id ? errorId("id") : undefined}
        />
        {formErrors.id && (
          <span id={errorId("id")} role="alert">
            {formErrors.id}
          </span>
        )}
      </div>

      {/* Title */}
      <div>
        <label htmlFor={fieldId("title")}>Title *</label>
        <input
          id={fieldId("title")}
          type="text"
          value={String(formData.title ?? "")}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("title", e.target.value)}
          aria-invalid={!!formErrors.title}
          aria-describedby={formErrors.title ? errorId("title") : undefined}
        />
        {formErrors.title && (
          <span id={errorId("title")} role="alert">
            {formErrors.title}
          </span>
        )}
      </div>

      {/* Description */}
      <div>
        <label htmlFor={fieldId("description")}>Description</label>
        <textarea
          id={fieldId("description")}
          value={formData.description ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            updateField("description", e.target.value)
          }
          rows={3}
        />
      </div>

      {/* Executor */}
      <div>
        <label htmlFor={fieldId("executor")}>Executor</label>
        <select
          id={fieldId("executor")}
          value={formData.executor ?? "shell"}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField("executor", e.target.value)}
        >
          {DEFAULT_EXECUTORS.map((ex) => (
            <option key={ex} value={ex}>
              {ex}
            </option>
          ))}
        </select>
      </div>

      {/* Max retries */}
      <div>
        <label htmlFor={fieldId("maxRetries")}>Max retries</label>
        <input
          id={fieldId("maxRetries")}
          type="number"
          min={0}
          value={formData.maxRetries ?? 2}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("maxRetries", parseInt(e.target.value, 10))
          }
          aria-invalid={!!formErrors.maxRetries}
          aria-describedby={formErrors.maxRetries ? errorId("maxRetries") : undefined}
        />
        {formErrors.maxRetries && (
          <span id={errorId("maxRetries")} role="alert">
            {formErrors.maxRetries}
          </span>
        )}
      </div>

      {/* Dependencies */}
      <div>
        <span>Dependencies</span>
        {formData.dependsOn && formData.dependsOn.length > 0 && (
          <div>
            {formData.dependsOn.map((depId) => {
              const depTask = tasks.find((t) => t.id === depId);
              return (
                <div key={depId}>
                  <span>{depTask?.title ?? depId}</span>
                  <button
                    type="button"
                    onClick={() => removeDependency(depId)}
                    aria-label={`Remove dependency ${depTask?.title ?? depId}`}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {availableDeps.length > 0 && (
          <div>
            <label htmlFor={fieldId("addDep")}>Add dependency</label>
            <select
              id={fieldId("addDep")}
              value=""
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                if (e.target.value) addDependency(e.target.value);
              }}
            >
              <option value="">-- Select task --</option>
              {availableDeps.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.id})
                </option>
              ))}
            </select>
          </div>
        )}
        {formErrors.dependsOn && <span role="alert">{formErrors.dependsOn}</span>}
      </div>

      {/* Actions */}
      <div>
        <button onClick={saveTask}>{isNew ? "Add Task" : "Update Task"}</button>
        <button onClick={cancelEdit}>Cancel</button>
      </div>
    </div>
  );
}
