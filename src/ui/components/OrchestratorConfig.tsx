import { useState, useCallback, useEffect, useId } from "react";
import type { ChangeEvent } from "react";
import {
  PlannerConfigSchema,
  type PlannerConfig,
  type PlannerRetryPolicy,
  type PlannerTimeout,
} from "../../schemas/planner.schema.js";
import {
  ValidationConfigSchema,
  LimitsConfigSchema,
  type ExecutorEntry,
} from "../../schemas/config.schema.js";
import { z } from "zod";

type ValidationConfig = z.infer<typeof ValidationConfigSchema>;
type FormErrors = Partial<Record<string, string>>;

const EXECUTOR_TYPES = ["shell", "command", "manual"] as const;
const INPUT_MODES = ["argument", "stdin", "file"] as const;
const VALIDATION_PROFILES = ["quick", "safe", "full", "custom"] as const;
const PLANNER_MODES = ["simple", "ai", "auto"] as const;
const RETRY_BACKOFFS = ["linear", "exponential", "fixed"] as const;
const TIMEOUT_ACTIONS = ["fail", "retry", "cancel", "skip"] as const;
const AI_VALIDATION_MODES = ["off", "fallback", "always", "high_risk_only"] as const;

export interface OrchestratorConfigProps {
  defaultConfig?: PlannerConfig;
  defaultValidation?: ValidationConfig;
  defaultLimits?: {
    maxRunMinutes?: number;
    maxTaskMinutes?: number;
    maxRetries?: number;
  };
  executors?: Record<string, ExecutorEntry>;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onLoad?: () => Promise<{
    planner?: PlannerConfig;
    validation?: ValidationConfig;
    limits?: { maxRunMinutes?: number; maxTaskMinutes?: number; maxRetries?: number };
    executors?: Record<string, ExecutorEntry>;
  }>;
}

type StepDependency = Record<string, string[]>;

export function OrchestratorConfig({
  defaultConfig,
  defaultValidation,
  defaultLimits,
  executors: initialExecutors,
  onSave,
  onLoad,
}: OrchestratorConfigProps) {
  const formId = useId();

  // Planner state
  const [planner, setPlanner] = useState<PlannerConfig>(
    defaultConfig ?? PlannerConfigSchema.parse({}),
  );
  const [plannerDirty, setPlannerDirty] = useState(false);

  // Validation state
  const [validation, setValidation] = useState<ValidationConfig>(
    defaultValidation ?? ValidationConfigSchema.parse({}),
  );
  const [validationDirty, setValidationDirty] = useState(false);

  // Limits / retry state
  const [limits, setLimits] = useState({
    maxRunMinutes: defaultLimits?.maxRunMinutes ?? 120,
    maxTaskMinutes: defaultLimits?.maxTaskMinutes ?? 30,
    maxRetries: defaultLimits?.maxRetries ?? 2,
  });
  const [limitsDirty, setLimitsDirty] = useState(false);

  // Retry policy
  const [retryPolicy, setRetryPolicy] = useState<PlannerRetryPolicy>({
    maxRetries: 2,
    retryDelayMs: 1000,
    retryBackoff: "linear",
  });

  // Timeout
  const [timeout, setTimeout_] = useState<PlannerTimeout>({
    durationMs: 300000,
    action: "fail",
  });

  // Executors
  const [executors, setExecutors] = useState<Record<string, ExecutorEntry>>(initialExecutors ?? {});
  const [editingExecutor, setEditingExecutor] = useState<string | null>(null);
  const [executorForm, setExecutorForm] = useState<{ name: string } & ExecutorEntry>({
    name: "",
    type: "shell",
    args: [],
    inputMode: "argument",
    timeoutMs: 1800000,
  });
  const [executorsDirty, setExecutorsDirty] = useState(false);

  // Step dependencies
  const [stepDeps, setStepDeps] = useState<StepDependency>({});
  const [stepDepsDirty, setStepDepsDirty] = useState(false);

  // Shared
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (defaultConfig) {
      setPlanner(defaultConfig);
      setPlannerDirty(false);
    }
    if (defaultValidation) {
      setValidation(defaultValidation);
      setValidationDirty(false);
    }
    if (defaultLimits) {
      setLimits({
        maxRunMinutes: defaultLimits.maxRunMinutes ?? 120,
        maxTaskMinutes: defaultLimits.maxTaskMinutes ?? 30,
        maxRetries: defaultLimits.maxRetries ?? 2,
      });
      setLimitsDirty(false);
    }
    if (initialExecutors) {
      setExecutors(initialExecutors);
      setExecutorsDirty(false);
    }
  }, [defaultConfig, defaultValidation, defaultLimits, initialExecutors]);

  useEffect(() => {
    if (!onLoad) return;
    setLoading(true);
    setError(null);
    onLoad()
      .then((data) => {
        if (data.planner) {
          setPlanner(data.planner);
          setPlannerDirty(false);
        }
        if (data.validation) {
          setValidation(data.validation);
          setValidationDirty(false);
        }
        if (data.limits) {
          setLimits({
            maxRunMinutes: data.limits.maxRunMinutes ?? 120,
            maxTaskMinutes: data.limits.maxTaskMinutes ?? 30,
            maxRetries: data.limits.maxRetries ?? 2,
          });
          setLimitsDirty(false);
        }
        if (data.executors) {
          setExecutors(data.executors);
          setExecutorsDirty(false);
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load config"),
      )
      .finally(() => setLoading(false));
  }, [onLoad]);

  const clearSuccess = useCallback(() => {
    setSuccessMsg(null);
  }, []);

  // ── Planner handlers ──

  const updatePlanner = useCallback((field: keyof PlannerConfig, value: unknown) => {
    setPlanner((prev) => ({ ...prev, [field]: value }));
    setPlannerDirty(true);
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[`planner.${field}`];
      return next;
    });
  }, []);

  // ── Validation handlers ──

  const updateValidation = useCallback((field: keyof ValidationConfig, value: unknown) => {
    setValidation((prev) => ({ ...prev, [field]: value }));
    setValidationDirty(true);
    const fieldStr = String(field);
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[`validation.${fieldStr}`];
      return next;
    });
  }, []);

  // ── Limits handlers ──

  const updateLimits = useCallback((field: string, value: number) => {
    setLimits((prev) => ({ ...prev, [field]: value }));
    setLimitsDirty(true);
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[`limits.${field}`];
      return next;
    });
  }, []);

  // ── Retry policy ──

  const updateRetryPolicy = useCallback((field: keyof PlannerRetryPolicy, value: unknown) => {
    setRetryPolicy((prev) => ({ ...prev, [field]: value }));
  }, []);

  // ── Timeout ──

  const updateTimeout = useCallback((field: keyof PlannerTimeout, value: unknown) => {
    setTimeout_((prev) => ({ ...prev, [field]: value }));
  }, []);

  // ── Executor handlers ──

  const startAddExecutor = useCallback(() => {
    setEditingExecutor("__new__");
    setExecutorForm({
      name: "",
      type: "shell",
      args: [],
      inputMode: "argument",
      timeoutMs: 1800000,
    });
  }, []);

  const startEditExecutor = useCallback((name: string, entry: ExecutorEntry) => {
    setEditingExecutor(name);
    setExecutorForm({ name, ...entry, args: entry.args ?? [] });
  }, []);

  const cancelExecutorEdit = useCallback(() => {
    setEditingExecutor(null);
  }, []);

  const updateExecutorField = useCallback((field: string, value: unknown) => {
    setExecutorForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const saveExecutor = useCallback(() => {
    const { name, ...entry } = executorForm;
    if (!name.trim()) {
      setFormErrors((prev) => ({ ...prev, executorName: "Executor name is required" }));
      return;
    }
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next.executorName;
      return next;
    });
    setExecutors((prev) => ({ ...prev, [name.trim()]: entry }));
    setExecutorsDirty(true);
    setEditingExecutor(null);
  }, [executorForm]);

  const deleteExecutor = useCallback((name: string) => {
    setExecutors((prev: Record<string, ExecutorEntry>) => {
      const next = { ...prev } as Record<string, ExecutorEntry>;
      delete next[name];
      return next;
    });
    setExecutorsDirty(true);
  }, []);

  // ── Step dependency handlers ──

  const allStepIds = Object.keys(executors);

  const addStepDep = useCallback((from: string, to: string) => {
    if (from === to) return;
    setStepDeps((prev) => {
      const current = prev[from] ?? [];
      if (current.includes(to)) return prev;
      return { ...prev, [from]: [...current, to] };
    });
    setStepDepsDirty(true);
  }, []);

  const removeStepDep = useCallback((from: string, to: string) => {
    setStepDeps((prev) => {
      const current = prev[from];
      if (!current) return prev;
      const filtered = current.filter((d) => d !== to);
      if (filtered.length === 0) {
        const next = { ...prev };
        delete next[from];
        return next;
      }
      return { ...prev, [from]: filtered };
    });
    setStepDepsDirty(true);
  }, []);

  // ── Save ──

  const saveAll = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const payload: Record<string, unknown> = {};

      if (plannerDirty) {
        const parsed = PlannerConfigSchema.safeParse(planner);
        if (!parsed.success) {
          const errs: FormErrors = {};
          for (const issue of parsed.error.issues) {
            errs[`planner.${issue.path.join(".")}`] = issue.message;
          }
          setFormErrors(errs);
          setSaving(false);
          return;
        }
        payload.planner = parsed.data;
      }

      if (validationDirty) {
        const parsed = ValidationConfigSchema.safeParse(validation);
        if (!parsed.success) {
          const errs: FormErrors = {};
          for (const issue of parsed.error.issues) {
            errs[`validation.${issue.path.join(".")}`] = issue.message;
          }
          setFormErrors(errs);
          setSaving(false);
          return;
        }
        payload.validation = parsed.data;
      }

      if (limitsDirty) {
        const parsed = LimitsConfigSchema.safeParse(limits);
        if (!parsed.success) {
          const errs: FormErrors = {};
          for (const issue of parsed.error.issues) {
            errs[`limits.${issue.path.join(".")}`] = issue.message;
          }
          setFormErrors(errs);
          setSaving(false);
          return;
        }
        payload.limits = parsed.data;
      }

      if (executorsDirty) {
        payload.executors = executors;
      }

      if (stepDepsDirty) {
        payload.stepDependencies = stepDeps;
      }

      await onSave(payload);
      setPlannerDirty(false);
      setValidationDirty(false);
      setLimitsDirty(false);
      setExecutorsDirty(false);
      setStepDepsDirty(false);
      setSuccessMsg("Configuration saved successfully");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }, [
    planner,
    plannerDirty,
    validation,
    validationDirty,
    limits,
    limitsDirty,
    executors,
    executorsDirty,
    stepDeps,
    stepDepsDirty,
    onSave,
  ]);

  const hasChanges =
    plannerDirty || validationDirty || limitsDirty || executorsDirty || stepDepsDirty;

  if (loading) {
    return (
      <div role="status" aria-live="polite">
        Loading orchestrator configuration...
      </div>
    );
  }

  return (
    <div role="region" aria-label="Orchestrator configuration">
      {/* ── Error ── */}
      {error && (
        <div role="alert" aria-live="assertive">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      )}

      {/* ── Success ── */}
      {successMsg && (
        <div role="status" aria-live="polite">
          {successMsg}
          <button onClick={clearSuccess} aria-label="Dismiss success message">
            Dismiss
          </button>
        </div>
      )}

      {/* ══════════════════════════════════
         SECTION: Planner
         ══════════════════════════════════ */}
      <fieldset>
        <legend>Planner Configuration</legend>

        {/* Mode */}
        <div>
          <label htmlFor={`${formId}-planner-mode`}>Planner mode</label>
          <select
            id={`${formId}-planner-mode`}
            value={planner.default}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updatePlanner("default", e.target.value)
            }
          >
            {PLANNER_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Provider */}
        <div>
          <label htmlFor={`${formId}-planner-provider`}>Provider</label>
          <input
            id={`${formId}-planner-provider`}
            type="text"
            value={planner.provider}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updatePlanner("provider", e.target.value)
            }
          />
        </div>

        {/* Model */}
        <div>
          <label htmlFor={`${formId}-planner-model`}>Model</label>
          <input
            id={`${formId}-planner-model`}
            type="text"
            value={planner.model}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updatePlanner("model", e.target.value)}
          />
        </div>

        {/* Base URL */}
        <div>
          <label htmlFor={`${formId}-planner-baseUrl`}>Base URL (optional)</label>
          <input
            id={`${formId}-planner-baseUrl`}
            type="text"
            value={planner.baseUrl ?? ""}
            placeholder="https://api.openai.com/v1"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updatePlanner("baseUrl", e.target.value || undefined)
            }
          />
        </div>

        {/* Temperature */}
        <div>
          <label htmlFor={`${formId}-planner-temp`}>Temperature</label>
          <input
            id={`${formId}-planner-temp`}
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={planner.temperature ?? 0.7}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updatePlanner("temperature", parseFloat(e.target.value))
            }
          />
        </div>

        {/* Max tokens */}
        <div>
          <label htmlFor={`${formId}-planner-maxTokens`}>Max tokens</label>
          <input
            id={`${formId}-planner-maxTokens`}
            type="number"
            min={1}
            value={planner.maxTokens ?? 4096}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updatePlanner("maxTokens", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* Max retries (planner) */}
        <div>
          <label htmlFor={`${formId}-planner-maxRetries`}>Planner max retries</label>
          <input
            id={`${formId}-planner-maxRetries`}
            type="number"
            min={0}
            value={planner.maxRetries}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updatePlanner("maxRetries", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* Fallback */}
        <div>
          <label htmlFor={`${formId}-planner-fallback`}>Fallback to simple mode</label>
          <input
            id={`${formId}-planner-fallback`}
            type="checkbox"
            checked={planner.fallbackToSimple}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updatePlanner("fallbackToSimple", e.target.checked)
            }
          />
        </div>

        {/* Stream */}
        <div>
          <label htmlFor={`${formId}-planner-stream`}>Stream output</label>
          <input
            id={`${formId}-planner-stream`}
            type="checkbox"
            checked={planner.stream ?? false}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updatePlanner("stream", e.target.checked || undefined)
            }
          />
        </div>
      </fieldset>

      {/* ══════════════════════════════════
         SECTION: Validation
         ══════════════════════════════════ */}
      <fieldset>
        <legend>Validation Configuration</legend>

        {/* Profile */}
        <div>
          <label htmlFor={`${formId}-validation-profile`}>Validation profile</label>
          <select
            id={`${formId}-validation-profile`}
            value={validation.profile}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateValidation("profile", e.target.value)
            }
          >
            {VALIDATION_PROFILES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* Concurrency */}
        <div>
          <label htmlFor={`${formId}-validation-concurrency`}>Concurrency</label>
          <input
            id={`${formId}-validation-concurrency`}
            type="number"
            min={1}
            value={validation.concurrency}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateValidation("concurrency", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* Timeout */}
        <div>
          <label htmlFor={`${formId}-validation-timeout`}>Timeout (ms)</label>
          <input
            id={`${formId}-validation-timeout`}
            type="number"
            min={0}
            step={1000}
            value={validation.timeoutMs}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateValidation("timeoutMs", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* AI validation */}
        <div>
          <label htmlFor={`${formId}-validation-ai`}>AI validation</label>
          <select
            id={`${formId}-validation-ai`}
            value={validation.aiValidation ?? "fallback"}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateValidation("aiValidation", e.target.value)
            }
          >
            {AI_VALIDATION_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Validation commands */}
        <div>
          <label>Validation commands</label>
          {(validation.commands ?? []).length === 0 && (
            <div>No validation commands configured.</div>
          )}
          {(validation.commands ?? []).map((cmd: string, idx: number) => (
            <div key={idx}>
              <input
                type="text"
                value={cmd}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const updated = [...(validation.commands ?? [])];
                  updated[idx] = e.target.value;
                  updateValidation("commands", updated);
                }}
                aria-label={`Validation command ${idx + 1}`}
              />
              <button
                type="button"
                onClick={() => {
                  const updated = (validation.commands ?? []).filter(
                    (_: string, i: number) => i !== idx,
                  );
                  updateValidation("commands", updated);
                }}
                aria-label={`Remove command ${idx + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              updateValidation("commands", [...(validation.commands ?? []), ""]);
            }}
          >
            Add command
          </button>
        </div>

        {/* Dedupe */}
        <div>
          <label htmlFor={`${formId}-validation-dedupe`}>Deduplicate commands</label>
          <input
            id={`${formId}-validation-dedupe`}
            type="checkbox"
            checked={validation.dedupeCommands}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateValidation("dedupeCommands", e.target.checked)
            }
          />
        </div>

        {/* Resource guard */}
        <div>
          <label htmlFor={`${formId}-validation-resourceGuard`}>Resource guard</label>
          <input
            id={`${formId}-validation-resourceGuard`}
            type="checkbox"
            checked={validation.resourceGuard}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateValidation("resourceGuard", e.target.checked)
            }
          />
        </div>
      </fieldset>

      {/* ══════════════════════════════════
         SECTION: Limits / Retry Policy
         ══════════════════════════════════ */}
      <fieldset>
        <legend>Limits & Retry Policy</legend>

        {/* Max run minutes */}
        <div>
          <label htmlFor={`${formId}-limits-runMinutes`}>Max run duration (minutes)</label>
          <input
            id={`${formId}-limits-runMinutes`}
            type="number"
            min={1}
            value={limits.maxRunMinutes}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateLimits("maxRunMinutes", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* Max task minutes */}
        <div>
          <label htmlFor={`${formId}-limits-taskMinutes`}>Max task duration (minutes)</label>
          <input
            id={`${formId}-limits-taskMinutes`}
            type="number"
            min={1}
            value={limits.maxTaskMinutes}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateLimits("maxTaskMinutes", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* Global max retries */}
        <div>
          <label htmlFor={`${formId}-limits-maxRetries`}>Global max retries</label>
          <input
            id={`${formId}-limits-maxRetries`}
            type="number"
            min={0}
            value={limits.maxRetries}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateLimits("maxRetries", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* Task retry policy — retries */}
        <div>
          <label htmlFor={`${formId}-retry-maxRetries`}>Task retry count</label>
          <input
            id={`${formId}-retry-maxRetries`}
            type="number"
            min={0}
            value={retryPolicy.maxRetries}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateRetryPolicy("maxRetries", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* Retry delay */}
        <div>
          <label htmlFor={`${formId}-retry-delay`}>Retry delay (ms)</label>
          <input
            id={`${formId}-retry-delay`}
            type="number"
            min={0}
            step={100}
            value={retryPolicy.retryDelayMs}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateRetryPolicy("retryDelayMs", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* Retry backoff */}
        <div>
          <label htmlFor={`${formId}-retry-backoff`}>Retry backoff strategy</label>
          <select
            id={`${formId}-retry-backoff`}
            value={retryPolicy.retryBackoff}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateRetryPolicy("retryBackoff", e.target.value)
            }
          >
            {RETRY_BACKOFFS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        {/* Task timeout — duration */}
        <div>
          <label htmlFor={`${formId}-timeout-duration`}>Task timeout (ms)</label>
          <input
            id={`${formId}-timeout-duration`}
            type="number"
            min={0}
            step={1000}
            value={timeout.durationMs}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateTimeout("durationMs", parseInt(e.target.value, 10))
            }
          />
        </div>

        {/* Task timeout — action */}
        <div>
          <label htmlFor={`${formId}-timeout-action`}>Timeout action</label>
          <select
            id={`${formId}-timeout-action`}
            value={timeout.action}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateTimeout("action", e.target.value)
            }
          >
            {TIMEOUT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {/* ══════════════════════════════════
         SECTION: Executors
         ══════════════════════════════════ */}
      <fieldset>
        <legend>CLI Executors</legend>

        {Object.keys(executors).length === 0 && editingExecutor === null && (
          <div>No custom executors configured.</div>
        )}

        {Object.entries(executors).map(([name, entry]) => (
          <div key={name}>
            {editingExecutor === name ? (
              <ExecutorFormFields
                formId={formId}
                executorForm={executorForm}
                formErrors={formErrors}
                updateField={updateExecutorField}
                onSave={saveExecutor}
                onCancel={cancelExecutorEdit}
              />
            ) : (
              <div>
                <strong>{name}</strong>
                <span>Type: {entry.type}</span>
                {entry.command && <span>Command: {entry.command}</span>}
                <div>
                  <button
                    onClick={() => startEditExecutor(name, entry)}
                    aria-label={`Edit executor ${name}`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteExecutor(name)}
                    aria-label={`Delete executor ${name}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {editingExecutor === "__new__" && (
          <ExecutorFormFields
            formId={formId}
            executorForm={executorForm}
            formErrors={formErrors}
            updateField={updateExecutorField}
            onSave={saveExecutor}
            onCancel={cancelExecutorEdit}
          />
        )}

        {editingExecutor === null && <button onClick={startAddExecutor}>Add Executor</button>}
      </fieldset>

      {/* ══════════════════════════════════
         SECTION: Step Dependencies
         ══════════════════════════════════ */}
      <fieldset>
        <legend>Step Dependencies</legend>

        {allStepIds.length === 0 && <div>Add executors to configure step dependencies.</div>}

        {allStepIds.length > 0 && (
          <div role="table" aria-label="Step dependency matrix">
            <div role="rowgroup">
              <div role="row">
                <div role="columnheader">Step</div>
                <div role="columnheader">Depends on</div>
              </div>
              {allStepIds.map((stepId) => (
                <div key={stepId} role="row">
                  <div role="cell">
                    <strong>{stepId}</strong>
                  </div>
                  <div role="cell">
                    {(stepDeps[stepId] ?? []).length === 0 && <div>No dependencies</div>}
                    {(stepDeps[stepId] ?? []).map((depId) => (
                      <span key={depId}>
                        {depId}
                        <button
                          type="button"
                          onClick={() => removeStepDep(stepId, depId)}
                          aria-label={`Remove dependency: ${stepId} → ${depId}`}
                        >
                          Remove
                        </button>
                      </span>
                    ))}
                    <select
                      value=""
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                        if (e.target.value) addStepDep(stepId, e.target.value);
                      }}
                      aria-label={`Add dependency for ${stepId}`}
                    >
                      <option value="">-- Add dependency --</option>
                      {allStepIds
                        .filter((id) => id !== stepId && !(stepDeps[stepId] ?? []).includes(id))
                        .map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      {/* ══════════════════════════════════
         Save / Reset
         ══════════════════════════════════ */}
      <div>
        <button onClick={saveAll} disabled={saving || !hasChanges}>
          {saving ? "Saving..." : "Save Configuration"}
        </button>
        <button
          onClick={() => {
            setError(null);
            setSuccessMsg(null);
            setFormErrors({});
            if (defaultConfig) {
              setPlanner(defaultConfig);
              setPlannerDirty(false);
            }
            if (defaultValidation) {
              setValidation(defaultValidation);
              setValidationDirty(false);
            }
            if (defaultLimits) {
              setLimits({
                maxRunMinutes: defaultLimits.maxRunMinutes ?? 120,
                maxTaskMinutes: defaultLimits.maxTaskMinutes ?? 30,
                maxRetries: defaultLimits.maxRetries ?? 2,
              });
              setLimitsDirty(false);
            }
            if (initialExecutors) {
              setExecutors(initialExecutors);
              setExecutorsDirty(false);
            }
          }}
          disabled={saving}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/* ── Executor form fields ── */

interface ExecutorFormFieldsProps {
  formId: string;
  executorForm: { name: string } & ExecutorEntry;
  formErrors: FormErrors;
  updateField: (field: string, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
}

function ExecutorFormFields({
  formId,
  executorForm,
  formErrors,
  updateField,
  onSave,
  onCancel,
}: ExecutorFormFieldsProps) {
  const fieldId = (name: string) => `${formId}-executor-${name}`;
  const errorId = (name: string) => `${fieldId(name)}-error`;

  return (
    <div role="form" aria-label="Executor editor">
      {/* Name */}
      <div>
        <label htmlFor={fieldId("name")}>Executor name</label>
        <input
          id={fieldId("name")}
          type="text"
          value={executorForm.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("name", e.target.value)}
          aria-invalid={!!formErrors.executorName}
          aria-describedby={formErrors.executorName ? errorId("name") : undefined}
        />
        {formErrors.executorName && (
          <span id={errorId("name")} role="alert">
            {formErrors.executorName}
          </span>
        )}
      </div>

      {/* Type */}
      <div>
        <label htmlFor={fieldId("type")}>Type</label>
        <select
          id={fieldId("type")}
          value={executorForm.type}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField("type", e.target.value)}
        >
          {EXECUTOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Command */}
      <div>
        <label htmlFor={fieldId("command")}>Command</label>
        <input
          id={fieldId("command")}
          type="text"
          value={executorForm.command ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("command", e.target.value || undefined)
          }
          placeholder="e.g. npx tsx src/cli/main.ts"
        />
      </div>

      {/* Args */}
      <div>
        <label>Arguments</label>
        {(executorForm.args ?? []).length === 0 && <div>No arguments configured.</div>}
        {(executorForm.args ?? []).map((arg, idx) => (
          <div key={idx}>
            <input
              type="text"
              value={arg}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const updated = [...(executorForm.args ?? [])];
                updated[idx] = e.target.value;
                updateField("args", updated);
              }}
              aria-label={`Argument ${idx + 1}`}
            />
            <button
              type="button"
              onClick={() => {
                const updated = (executorForm.args ?? []).filter((_, i) => i !== idx);
                updateField("args", updated);
              }}
              aria-label={`Remove argument ${idx + 1}`}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => updateField("args", [...(executorForm.args ?? []), ""])}
        >
          Add argument
        </button>
      </div>

      {/* Input mode */}
      <div>
        <label htmlFor={fieldId("inputMode")}>Input mode</label>
        <select
          id={fieldId("inputMode")}
          value={executorForm.inputMode}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField("inputMode", e.target.value)}
        >
          {INPUT_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Timeout */}
      <div>
        <label htmlFor={fieldId("timeout")}>Timeout (ms)</label>
        <input
          id={fieldId("timeout")}
          type="number"
          min={0}
          step={1000}
          value={executorForm.timeoutMs ?? 1800000}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("timeoutMs", parseInt(e.target.value, 10))
          }
        />
      </div>

      {/* Actions */}
      <div>
        <button onClick={onSave}>Save Executor</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
