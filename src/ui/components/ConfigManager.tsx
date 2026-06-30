import { useState, useCallback, useEffect, useId, type ChangeEvent } from "react";
import {
  FlowTaskConfigSchema,
  type FlowTaskConfig,
  ProjectModeSchema,
  ValidationConfigSchema,
  LimitsConfigSchema,
  ApprovalConfigSchema,
  QualityConfigSchema,
  LoggingConfigSchema,
  ProcessConfigSchema,
  RiskConfigSchema,
  HooksConfigSchema,
  ExecutorConfigSchema,
  type ExecutorEntry,
} from "../../schemas/config.schema.js";
import { PlannerConfigSchema, type PlannerConfig } from "../../schemas/planner.schema.js";
import { AiConfigSchema } from "../../ai/ai.schema.js";
import { z } from "zod";

type FormErrors = Partial<Record<string, string>>;

const PLANNER_MODES = ["simple", "ai", "auto"] as const;
const VALIDATION_PROFILES = ["quick", "safe", "full", "custom"] as const;
const AI_VALIDATION_MODES = ["off", "fallback", "always", "high_risk_only"] as const;
const RETRY_BACKOFFS = ["linear", "exponential", "fixed"] as const;
const TIMEOUT_ACTIONS = ["fail", "retry", "cancel", "skip"] as const;
const APP_GATE_ACTIONS = [
  "delete_file",
  "install_dependency",
  "git_push",
  "git_commit",
  "deploy",
  "database_migration",
  "read_sensitive_file",
  "env_config_change",
  "external_api_call",
  "network_operation",
  "high_cost_ai_usage",
  "continue_after_repeated_failure",
  "skip_failed_validation",
  "override_validation_failure",
  "plan_execution",
] as const;
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
const HOOK_TYPES = [
  "beforeRun",
  "afterRun",
  "beforeTask",
  "afterTask",
  "beforeRetry",
  "afterRetry",
  "onFailure",
  "beforePlan",
  "afterPlan",
  "beforeStep",
  "afterStep",
  "onStepFail",
  "onStepRetry",
  "beforeValidate",
  "afterValidate",
  "onArtifactCreated",
  "onApprovalRequired",
  "onFileChanged",
  "onRunComplete",
  "onRunFail",
  "onRunCancel",
] as const;

type SectionKey =
  | "general"
  | "planner"
  | "validation"
  | "limits"
  | "approval"
  | "quality"
  | "logging"
  | "process"
  | "risk"
  | "hooks"
  | "executors"
  | "ai";

interface SectionState {
  expanded: boolean;
  dirty: boolean;
}

export interface ConfigManagerProps {
  defaultConfig?: Partial<FlowTaskConfig>;
  onSave: (config: Partial<FlowTaskConfig>) => Promise<void>;
  onLoad?: () => Promise<Partial<FlowTaskConfig>>;
}

function initSectionMap(): Record<SectionKey, SectionState> {
  return {
    general: { expanded: true, dirty: false },
    planner: { expanded: false, dirty: false },
    validation: { expanded: false, dirty: false },
    limits: { expanded: false, dirty: false },
    approval: { expanded: false, dirty: false },
    quality: { expanded: false, dirty: false },
    logging: { expanded: false, dirty: false },
    process: { expanded: false, dirty: false },
    risk: { expanded: false, dirty: false },
    hooks: { expanded: false, dirty: false },
    executors: { expanded: false, dirty: false },
    ai: { expanded: false, dirty: false },
  };
}

export function ConfigManager({ defaultConfig, onSave, onLoad }: ConfigManagerProps) {
  const formId = useId();

  const [sections, setSections] = useState<Record<SectionKey, SectionState>>(initSectionMap());
  const [config, setConfig] = useState<Partial<FlowTaskConfig>>(defaultConfig ?? {});
  const [executors, setExecutors] = useState<Record<string, ExecutorEntry>>({});
  const [editingExecutor, setEditingExecutor] = useState<string | null>(null);
  const [executorForm, setExecutorForm] = useState<{ name: string } & ExecutorEntry>({
    name: "",
    type: "shell",
    args: [],
    inputMode: "argument",
    timeoutMs: 1800000,
  });

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (defaultConfig) {
      setConfig(defaultConfig);
      if (defaultConfig.executors) {
        setExecutors(defaultConfig.executors);
      }
    }
  }, [defaultConfig]);

  useEffect(() => {
    if (!onLoad) return;
    setLoading(true);
    setError(null);
    onLoad()
      .then((data) => {
        setConfig(data);
        if (data.executors) setExecutors(data.executors);
        setSections(initSectionMap());
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load configuration"),
      )
      .finally(() => setLoading(false));
  }, [onLoad]);

  const toggleSection = useCallback((key: SectionKey) => {
    setSections((prev) => ({
      ...prev,
      [key]: { ...prev[key], expanded: !prev[key].expanded },
    }));
  }, []);

  const markDirty = useCallback((key: SectionKey) => {
    setSections((prev) => ({ ...prev, [key]: { ...prev[key], dirty: true } }));
  }, []);

  const updateConfigField = useCallback(
    (section: SectionKey, field: string, value: unknown) => {
      setConfig((prev) => {
        const sectionData = (prev as Record<string, unknown>)[section];
        return {
          ...prev,
          [section]:
            typeof sectionData === "object" && sectionData !== null
              ? { ...sectionData, [field]: value }
              : { [field]: value },
        } as Partial<FlowTaskConfig>;
      });
      markDirty(section);
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[`${section}.${field}`];
        return next;
      });
    },
    [markDirty],
  );

  const updateTopField = useCallback(
    (field: string, value: unknown) => {
      setConfig((prev) => ({ ...prev, [field]: value }));
      markDirty("general");
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    [markDirty],
  );

  const updateNestedField = useCallback(
    (section: SectionKey, subsection: string, field: string, value: unknown) => {
      setConfig((prev) => {
        const sectionData = (prev as Record<string, unknown>)[section];
        const sub =
          typeof sectionData === "object" && sectionData !== null
            ? (sectionData as Record<string, unknown>)[subsection]
            : undefined;
        return {
          ...prev,
          [section]: {
            ...(typeof sectionData === "object" && sectionData !== null ? sectionData : {}),
            [subsection]: {
              ...(typeof sub === "object" && sub !== null ? sub : {}),
              [field]: value,
            },
          },
        } as Partial<FlowTaskConfig>;
      });
      markDirty(section);
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[`${section}.${subsection}.${field}`];
        return next;
      });
    },
    [markDirty],
  );

  const addToArrayField = useCallback(
    (section: SectionKey, field: string, value: unknown) => {
      setConfig((prev) => {
        const sectionData = (prev as Record<string, unknown>)[section];
        const arr = Array.isArray(sectionData)
          ? sectionData
          : typeof sectionData === "object" && sectionData !== null
            ? ((sectionData as Record<string, unknown>)[field] ?? [])
            : [];
        return {
          ...prev,
          [section]: Array.isArray(sectionData)
            ? [...sectionData, value]
            : {
                ...(typeof sectionData === "object" && sectionData !== null ? sectionData : {}),
                [field]: [...(arr as unknown[]), value],
              },
        } as Partial<FlowTaskConfig>;
      });
      markDirty(section);
    },
    [markDirty],
  );

  const removeFromArrayField = useCallback(
    (section: SectionKey, field: string, index: number) => {
      setConfig((prev) => {
        const sectionData = (prev as Record<string, unknown>)[section];
        const arr = Array.isArray(sectionData)
          ? sectionData
          : typeof sectionData === "object" && sectionData !== null
            ? ((sectionData as Record<string, unknown>)[field] ?? [])
            : [];
        const filtered = (arr as unknown[]).filter((_, i) => i !== index);
        return {
          ...prev,
          [section]: Array.isArray(sectionData)
            ? filtered
            : {
                ...(typeof sectionData === "object" && sectionData !== null ? sectionData : {}),
                [field]: filtered,
              },
        } as Partial<FlowTaskConfig>;
      });
      markDirty(section);
    },
    [markDirty],
  );

  const updateArrayItem = useCallback(
    (section: SectionKey, field: string, index: number, value: unknown) => {
      setConfig((prev) => {
        const sectionData = (prev as Record<string, unknown>)[section];
        const arr = Array.isArray(sectionData)
          ? sectionData
          : typeof sectionData === "object" && sectionData !== null
            ? ((sectionData as Record<string, unknown>)[field] ?? [])
            : [];
        const updated = [...(arr as unknown[])];
        updated[index] = value;
        return {
          ...prev,
          [section]: Array.isArray(sectionData)
            ? updated
            : {
                ...(typeof sectionData === "object" && sectionData !== null ? sectionData : {}),
                [field]: updated,
              },
        } as Partial<FlowTaskConfig>;
      });
      markDirty(section);
    },
    [markDirty],
  );

  // Executor handlers
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

  const cancelExecutorEdit = useCallback(() => setEditingExecutor(null), []);

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
      const n = { ...prev };
      delete n.executorName;
      return n;
    });
    setExecutors((prev) => ({ ...prev, [name.trim()]: entry }));
    markDirty("executors");
    setEditingExecutor(null);
  }, [executorForm, markDirty]);

  const deleteExecutor = useCallback(
    (name: string) => {
      setExecutors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      markDirty("executors");
    },
    [markDirty],
  );

  const hasChanges = Object.values(sections).some((s) => s.dirty);

  const validateAndSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, section] of Object.entries(sections) as [SectionKey, SectionState][]) {
        if (!section.dirty) continue;
        const val = (config as Record<string, unknown>)[key];
        if (val !== undefined) payload[key] = val;
      }
      if (sections.executors.dirty) {
        payload.executors = Object.keys(executors).length > 0 ? executors : undefined;
      }
      const parsed = FlowTaskConfigSchema.partial().safeParse(payload);
      if (!parsed.success) {
        const errs: FormErrors = {};
        for (const issue of parsed.error.issues) {
          errs[issue.path.join(".")] = issue.message;
        }
        setFormErrors(errs);
        setSaving(false);
        return;
      }
      await onSave(parsed.data as Partial<FlowTaskConfig>);
      setSections(initSectionMap());
      setSuccessMsg("Configuration saved successfully");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }, [config, sections, executors, onSave]);

  const clearSuccess = useCallback(() => setSuccessMsg(null), []);

  // ── Render helpers ──

  const SECTION_LABELS: Record<SectionKey, string> = {
    general: "General",
    planner: "Planner",
    validation: "Validation",
    limits: "Limits & Retry",
    approval: "Approval",
    quality: "Quality",
    logging: "Logging",
    process: "Process",
    risk: "Risk",
    hooks: "Hooks",
    executors: "Executors",
    ai: "AI",
  };

  function renderSectionHeader(key: SectionKey) {
    const s = sections[key];
    return (
      <button
        type="button"
        onClick={() => toggleSection(key)}
        aria-expanded={s.expanded}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          backgroundColor: s.dirty ? "#fefce8" : "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: "6px",
          fontSize: "13px",
          fontWeight: 600,
          color: "#374151",
          cursor: "pointer",
          marginBottom: s.expanded ? "8px" : 0,
        }}
      >
        <span>
          {SECTION_LABELS[key]}
          {s.dirty ? " *" : ""}
        </span>
        <span style={{ fontSize: "10px" }}>{s.expanded ? "\u25BC" : "\u25B6"}</span>
      </button>
    );
  }

  function renderField(
    sectionKey: SectionKey | null,
    id: string,
    label: string,
    type: string,
    value: unknown,
    onChange: (v: unknown) => void,
    opts?: { min?: number; max?: number; step?: number; placeholder?: string; errorKey?: string },
  ) {
    const fieldId = `${formId}-${id}`;
    const errorId = `${fieldId}-error`;
    const errorMsg = opts?.errorKey ? formErrors[opts.errorKey] : undefined;
    const inputStyle: React.CSSProperties = {
      width: "100%",
      padding: "6px 10px",
      border: `1px solid ${errorMsg ? "#ef4444" : "#d1d5db"}`,
      borderRadius: "4px",
      fontSize: "13px",
      boxSizing: "border-box",
    };

    return (
      <div style={{ marginBottom: "10px" }}>
        <label
          htmlFor={fieldId}
          style={{
            display: "block",
            fontSize: "12px",
            fontWeight: 600,
            color: "#374151",
            marginBottom: "3px",
          }}
        >
          {label}
        </label>
        {type === "select" ? (
          <select
            id={fieldId}
            value={value as string}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
            style={inputStyle}
            aria-invalid={!!errorMsg}
            aria-describedby={errorMsg ? errorId : undefined}
          >
            {(opts?.min !== undefined ? (value as string[]) : []).length > 0
              ? (value as string[]).map((o: string) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))
              : null}
          </select>
        ) : type === "checkbox" ? (
          <input
            id={fieldId}
            type="checkbox"
            checked={!!value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
            style={{ margin: "4px 0" }}
          />
        ) : (
          <input
            id={fieldId}
            type={type}
            value={value as string}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              if (type === "number") onChange(parseInt(e.target.value, 10) || 0);
              else onChange(e.target.value);
            }}
            placeholder={opts?.placeholder}
            min={opts?.min}
            max={opts?.max}
            step={opts?.step}
            style={inputStyle}
            aria-invalid={!!errorMsg}
            aria-describedby={errorMsg ? errorId : undefined}
          />
        )}
        {errorMsg && (
          <span id={errorId} role="alert" style={{ color: "#ef4444", fontSize: "11px" }}>
            {errorMsg}
          </span>
        )}
      </div>
    );
  }

  function renderSection<S extends Record<string, unknown>>(
    key: SectionKey,
    fields: {
      id: string;
      label: string;
      type: string;
      accessor: (s: S) => unknown;
      onChange: (v: unknown) => void;
      opts?: Record<string, unknown>;
    }[],
  ) {
    if (!sections[key].expanded) {
      return <div style={{ marginBottom: "6px" }}>{renderSectionHeader(key)}</div>;
    }
    const sectionData = ((config as Record<string, unknown>)[key] ?? {}) as S;
    return (
      <div style={{ marginBottom: "6px" }}>
        {renderSectionHeader(key)}
        <div
          style={{
            padding: "12px",
            border: "1px solid #e5e7eb",
            borderTop: "none",
            borderRadius: "0 0 6px 6px",
          }}
        >
          {fields.map((f) =>
            renderField(
              key,
              `${key}.${f.id}`,
              f.label,
              f.type,
              f.accessor(sectionData),
              f.onChange,
              f.opts as
                | {
                    min?: number;
                    max?: number;
                    step?: number;
                    placeholder?: string;
                    errorKey?: string;
                  }
                | undefined,
            ),
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite">
        Loading configuration...
      </div>
    );
  }

  return (
    <div role="region" aria-label="Orchestrator configuration">
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: "8px 12px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            color: "#b91c1c",
            fontSize: "13px",
            marginBottom: "12px",
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
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {successMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "8px 12px",
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
            color: "#15803d",
            fontSize: "13px",
            marginBottom: "12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{successMsg}</span>
          <button
            onClick={clearSuccess}
            aria-label="Dismiss"
            style={{
              background: "none",
              border: "none",
              color: "#15803d",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── General ── */}
      {sections.general.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("general")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            {renderField(
              null,
              "projectMode",
              "Project mode",
              "select",
              config.projectMode ?? "development",
              (v) => updateTopField("projectMode", v),
            )}
            {renderField(
              null,
              "defaultExecutor",
              "Default executor",
              "text",
              config.defaultExecutor ?? "opencode",
              (v) => updateTopField("defaultExecutor", v),
              { placeholder: "opencode" },
            )}
            {renderField(null, "logLevel", "Log level", "select", config.logLevel ?? "info", (v) =>
              updateTopField("logLevel", v),
            )}
            {renderField(
              null,
              "autoResume",
              "Auto resume",
              "checkbox",
              config.autoResume ?? true,
              (v) => updateTopField("autoResume", v),
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("general")}</div>
      )}

      {/* ── Planner ── */}
      {sections.planner.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("planner")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            {renderField(
              null,
              "planner.default",
              "Planner mode",
              "select",
              (config.planner as PlannerConfig)?.default ?? "auto",
              (v) => updateNestedField("planner" as SectionKey, "", "default", v),
            )}
            {renderField(
              null,
              "planner.type",
              "Planner type",
              "text",
              (config.planner as PlannerConfig)?.type ?? "internal-ai",
              (v) => updateNestedField("planner" as SectionKey, "", "type", v),
            )}
            {renderField(
              null,
              "planner.provider",
              "Provider",
              "text",
              (config.planner as PlannerConfig)?.provider ?? "openai",
              (v) => updateNestedField("planner" as SectionKey, "", "provider", v),
              { placeholder: "openai" },
            )}
            {renderField(
              null,
              "planner.model",
              "Model",
              "text",
              (config.planner as PlannerConfig)?.model ?? "gpt-4.1-mini",
              (v) => updateNestedField("planner" as SectionKey, "", "model", v),
              { placeholder: "gpt-4.1-mini" },
            )}
            {renderField(
              null,
              "planner.baseUrl",
              "Base URL (optional)",
              "text",
              (config.planner as PlannerConfig)?.baseUrl ?? "",
              (v) => updateNestedField("planner" as SectionKey, "", "baseUrl", v || undefined),
              { placeholder: "https://api.openai.com/v1" },
            )}
            {renderField(
              null,
              "planner.temperature",
              "Temperature",
              "number",
              (config.planner as PlannerConfig)?.temperature ?? 0.7,
              (v) => updateNestedField("planner" as SectionKey, "", "temperature", v),
            )}
            {renderField(
              null,
              "planner.maxTokens",
              "Max tokens",
              "number",
              (config.planner as PlannerConfig)?.maxTokens ?? 4096,
              (v) => updateNestedField("planner" as SectionKey, "", "maxTokens", v),
            )}
            {renderField(
              null,
              "planner.maxRetries",
              "Planner max retries",
              "number",
              (config.planner as PlannerConfig)?.maxRetries ?? 1,
              (v) => updateNestedField("planner" as SectionKey, "", "maxRetries", v),
            )}
            {renderField(
              null,
              "planner.stream",
              "Stream output",
              "checkbox",
              (config.planner as PlannerConfig)?.stream ?? false,
              (v) => updateNestedField("planner" as SectionKey, "", "stream", v || undefined),
            )}
            {renderField(
              null,
              "planner.fallbackToSimple",
              "Fallback to simple",
              "checkbox",
              (config.planner as PlannerConfig)?.fallbackToSimple ?? true,
              (v) => updateNestedField("planner" as SectionKey, "", "fallbackToSimple", v),
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("planner")}</div>
      )}

      {/* ── Validation ── */}
      {sections.validation.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("validation")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            {renderField(
              null,
              "validation.profile",
              "Profile",
              "select",
              (config.validation as Record<string, unknown>)?.profile ?? "safe",
              (v) => updateConfigField("validation" as SectionKey, "profile", v),
            )}
            {renderField(
              null,
              "validation.concurrency",
              "Concurrency",
              "number",
              (config.validation as Record<string, unknown>)?.concurrency ?? 1,
              (v) => updateConfigField("validation" as SectionKey, "concurrency", v),
            )}
            {renderField(
              null,
              "validation.timeoutMs",
              "Timeout (ms)",
              "number",
              (config.validation as Record<string, unknown>)?.timeoutMs ?? 300000,
              (v) => updateConfigField("validation" as SectionKey, "timeoutMs", v),
            )}
            {renderField(
              null,
              "validation.aiValidation",
              "AI validation mode",
              "select",
              (config.validation as Record<string, unknown>)?.aiValidation ?? "fallback",
              (v) => updateConfigField("validation" as SectionKey, "aiValidation", v),
            )}
            {renderField(
              null,
              "validation.dedupeCommands",
              "Deduplicate commands",
              "checkbox",
              (config.validation as Record<string, unknown>)?.dedupeCommands ?? true,
              (v) => updateConfigField("validation" as SectionKey, "dedupeCommands", v),
            )}
            {renderField(
              null,
              "validation.resourceGuard",
              "Resource guard",
              "checkbox",
              (config.validation as Record<string, unknown>)?.resourceGuard ?? true,
              (v) => updateConfigField("validation" as SectionKey, "resourceGuard", v),
            )}
            <div style={{ marginBottom: "8px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: "3px",
                }}
              >
                Validation commands
              </label>
              {(((config.validation as Record<string, unknown>)?.commands as string[]) ?? [])
                .length === 0 && (
                <div style={{ fontSize: "12px", color: "#9ca3af" }}>No commands configured.</div>
              )}
              {(((config.validation as Record<string, unknown>)?.commands as string[]) ?? []).map(
                (cmd: string, idx: number) => (
                  <div key={idx} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                    <input
                      type="text"
                      value={cmd}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateArrayItem("validation", "commands", idx, e.target.value)
                      }
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        border: "1px solid #d1d5db",
                        borderRadius: "4px",
                        fontSize: "12px",
                      }}
                      aria-label={`Command ${idx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeFromArrayField("validation", "commands", idx)}
                      style={{
                        padding: "2px 8px",
                        border: "1px solid #fecaca",
                        borderRadius: "4px",
                        background: "#fff",
                        color: "#ef4444",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                      aria-label={`Remove command ${idx + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ),
              )}
              <button
                type="button"
                onClick={() => addToArrayField("validation", "commands", "")}
                style={{
                  padding: "4px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  background: "#fff",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                Add command
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("validation")}</div>
      )}

      {/* ── Limits ── */}
      {sections.limits.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("limits")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            {renderField(
              null,
              "limits.maxRunMinutes",
              "Max run duration (min)",
              "number",
              (config.limits as Record<string, unknown>)?.maxRunMinutes ?? 120,
              (v) => updateConfigField("limits" as SectionKey, "maxRunMinutes", v),
            )}
            {renderField(
              null,
              "limits.maxTaskMinutes",
              "Max task duration (min)",
              "number",
              (config.limits as Record<string, unknown>)?.maxTaskMinutes ?? 30,
              (v) => updateConfigField("limits" as SectionKey, "maxTaskMinutes", v),
            )}
            {renderField(
              null,
              "limits.maxRetries",
              "Global max retries",
              "number",
              (config.limits as Record<string, unknown>)?.maxRetries ?? 2,
              (v) => updateConfigField("limits" as SectionKey, "maxRetries", v),
            )}
            {renderField(
              null,
              "limits.maxLogSizeMb",
              "Max log size (MB)",
              "number",
              (config.limits as Record<string, unknown>)?.maxLogSizeMb ?? 20,
              (v) => updateConfigField("limits" as SectionKey, "maxLogSizeMb", v),
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("limits")}</div>
      )}

      {/* ── Approval ── */}
      {sections.approval.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("approval")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            {renderField(
              null,
              "approval.enabled",
              "Approval enabled",
              "checkbox",
              (config.approval as Record<string, unknown>)?.enabled ?? true,
              (v) => updateConfigField("approval" as SectionKey, "enabled", v),
            )}
            {renderField(
              null,
              "approval.autoApprove",
              "Auto approve",
              "checkbox",
              (config.approval as Record<string, unknown>)?.autoApprove ?? false,
              (v) => updateConfigField("approval" as SectionKey, "autoApprove", v),
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("approval")}</div>
      )}

      {/* ── Quality ── */}
      {sections.quality.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("quality")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            {renderField(
              null,
              "quality.enabledByDefault",
              "Enabled by default",
              "checkbox",
              (config.quality as Record<string, unknown>)?.enabledByDefault ?? false,
              (v) => updateConfigField("quality" as SectionKey, "enabledByDefault", v),
            )}
            <div style={{ marginBottom: "8px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: "3px",
                }}
              >
                Commands
              </label>
              {(((config.quality as Record<string, unknown>)?.commands as string[]) ?? [])
                .length === 0 && (
                <div style={{ fontSize: "12px", color: "#9ca3af" }}>No commands configured.</div>
              )}
              {(((config.quality as Record<string, unknown>)?.commands as string[]) ?? []).map(
                (cmd: string, idx: number) => (
                  <div key={idx} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                    <input
                      type="text"
                      value={cmd}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateArrayItem("quality", "commands", idx, e.target.value)
                      }
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        border: "1px solid #d1d5db",
                        borderRadius: "4px",
                        fontSize: "12px",
                      }}
                      aria-label={`Quality command ${idx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeFromArrayField("quality", "commands", idx)}
                      style={{
                        padding: "2px 8px",
                        border: "1px solid #fecaca",
                        borderRadius: "4px",
                        background: "#fff",
                        color: "#ef4444",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                      aria-label={`Remove command ${idx + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ),
              )}
              <button
                type="button"
                onClick={() => addToArrayField("quality", "commands", "")}
                style={{
                  padding: "4px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  background: "#fff",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                Add command
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("quality")}</div>
      )}

      {/* ── Logging ── */}
      {sections.logging.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("logging")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            {renderField(
              null,
              "logging.maxInMemoryLines",
              "Max in-memory lines",
              "number",
              (config.logging as Record<string, unknown>)?.maxInMemoryLines ?? 500,
              (v) => updateConfigField("logging" as SectionKey, "maxInMemoryLines", v),
            )}
            {renderField(
              null,
              "logging.maxLineLength",
              "Max line length",
              "number",
              (config.logging as Record<string, unknown>)?.maxLineLength ?? 4000,
              (v) => updateConfigField("logging" as SectionKey, "maxLineLength", v),
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("logging")}</div>
      )}

      {/* ── Process ── */}
      {sections.process.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("process")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            {renderField(
              null,
              "process.gracefulStopTimeoutMs",
              "Graceful stop timeout (ms)",
              "number",
              (config.process as Record<string, unknown>)?.gracefulStopTimeoutMs ?? 5000,
              (v) => updateConfigField("process" as SectionKey, "gracefulStopTimeoutMs", v),
            )}
            {renderField(
              null,
              "process.forceKillTimeoutMs",
              "Force kill timeout (ms)",
              "number",
              (config.process as Record<string, unknown>)?.forceKillTimeoutMs ?? 10000,
              (v) => updateConfigField("process" as SectionKey, "forceKillTimeoutMs", v),
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("process")}</div>
      )}

      {/* ── Risk ── */}
      {sections.risk.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("risk")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            {renderField(
              null,
              "risk.enabled",
              "Risk enabled",
              "checkbox",
              (config.risk as Record<string, unknown>)?.enabled ?? true,
              (v) => updateConfigField("risk" as SectionKey, "enabled", v),
            )}
            {renderField(
              null,
              "risk.riskThreshold",
              "Risk threshold",
              "select",
              (config.risk as Record<string, unknown>)?.riskThreshold ?? "medium",
              (v) => updateConfigField("risk" as SectionKey, "riskThreshold", v),
            )}
            {renderField(
              null,
              "risk.safeMode",
              "Safe mode",
              "checkbox",
              (config.risk as Record<string, unknown>)?.safeMode ?? false,
              (v) => updateConfigField("risk" as SectionKey, "safeMode", v),
            )}
            {renderField(
              null,
              "risk.readOnlyMode",
              "Read-only mode",
              "checkbox",
              (config.risk as Record<string, unknown>)?.readOnlyMode ?? false,
              (v) => updateConfigField("risk" as SectionKey, "readOnlyMode", v),
            )}
            {renderField(
              null,
              "risk.blockEnvFileAccess",
              "Block .env access",
              "checkbox",
              (config.risk as Record<string, unknown>)?.blockEnvFileAccess ?? true,
              (v) => updateConfigField("risk" as SectionKey, "blockEnvFileAccess", v),
            )}
            {renderField(
              null,
              "risk.blockFileDeletion",
              "Block file deletion",
              "checkbox",
              (config.risk as Record<string, unknown>)?.blockFileDeletion ?? false,
              (v) => updateConfigField("risk" as SectionKey, "blockFileDeletion", v),
            )}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("risk")}</div>
      )}

      {/* ── Executors ── */}
      <div style={{ marginBottom: "6px" }}>
        {sections.executors.expanded ? (
          <>
            {renderSectionHeader("executors")}
            <div
              style={{
                padding: "12px",
                border: "1px solid #e5e7eb",
                borderTop: "none",
                borderRadius: "0 0 6px 6px",
              }}
            >
              {Object.keys(executors).length === 0 && editingExecutor === null && (
                <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "8px" }}>
                  No custom executors configured.
                </div>
              )}
              {Object.entries(executors).map(([name, entry]) => (
                <div
                  key={name}
                  style={{
                    padding: "8px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "4px",
                    marginBottom: "6px",
                    fontSize: "13px",
                  }}
                >
                  {editingExecutor === name ? (
                    <ExecutorFormFieldsCompact
                      formId={formId}
                      executorForm={executorForm}
                      formErrors={formErrors}
                      updateField={updateExecutorField}
                      onSave={saveExecutor}
                      onCancel={cancelExecutorEdit}
                    />
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <strong>{name}</strong>
                        <span style={{ color: "#6b7280", marginLeft: "8px" }}>
                          Type: {entry.type}
                        </span>
                        {entry.command && (
                          <span style={{ color: "#6b7280", marginLeft: "8px" }}>
                            Cmd: {entry.command}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button
                          type="button"
                          onClick={() => startEditExecutor(name, entry)}
                          style={{
                            padding: "2px 8px",
                            border: "1px solid #d1d5db",
                            borderRadius: "4px",
                            background: "#fff",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteExecutor(name)}
                          style={{
                            padding: "2px 8px",
                            border: "1px solid #fecaca",
                            borderRadius: "4px",
                            background: "#fff",
                            color: "#ef4444",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {editingExecutor === "__new__" && (
                <div
                  style={{
                    padding: "8px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "4px",
                    marginBottom: "6px",
                  }}
                >
                  <ExecutorFormFieldsCompact
                    formId={formId}
                    executorForm={executorForm}
                    formErrors={formErrors}
                    updateField={updateExecutorField}
                    onSave={saveExecutor}
                    onCancel={cancelExecutorEdit}
                  />
                </div>
              )}
              {editingExecutor === null && (
                <button
                  type="button"
                  onClick={startAddExecutor}
                  style={{
                    padding: "4px 12px",
                    background: "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Add Executor
                </button>
              )}
            </div>
          </>
        ) : (
          renderSectionHeader("executors")
        )}
      </div>

      {/* ── Hooks ── */}
      {sections.hooks.expanded ? (
        <div style={{ marginBottom: "6px" }}>
          {renderSectionHeader("hooks")}
          <div
            style={{
              padding: "12px",
              border: "1px solid #e5e7eb",
              borderTop: "none",
              borderRadius: "0 0 6px 6px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "8px" }}>
              Configure lifecycle hooks. Each hook supports shell commands, script paths, or webhook
              URLs.
            </div>
            {HOOK_TYPES.map((hookName) => {
              const hooks = ((config.hooks as Record<string, unknown>) ?? {})[hookName] as
                | string[]
                | undefined;
              return (
                <div
                  key={hookName}
                  style={{
                    marginBottom: "10px",
                    padding: "8px",
                    border: "1px solid #f3f4f6",
                    borderRadius: "4px",
                  }}
                >
                  <label
                    style={{
                      display: "block",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#374151",
                      marginBottom: "4px",
                    }}
                  >
                    {hookName}
                  </label>
                  {(hooks ?? []).length === 0 && (
                    <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "4px" }}>
                      No hooks configured.
                    </div>
                  )}
                  {(hooks ?? []).map((cmd: string, idx: number) => (
                    <div key={idx} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                      <input
                        type="text"
                        value={cmd}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                          const updated = [...(hooks ?? [])];
                          updated[idx] = e.target.value;
                          setConfig((prev) => ({
                            ...prev,
                            hooks: {
                              ...((prev.hooks as Record<string, unknown>) ?? {}),
                              [hookName]: updated,
                            },
                          }));
                          markDirty("hooks");
                        }}
                        style={{
                          flex: 1,
                          padding: "4px 8px",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontFamily: "monospace",
                        }}
                        aria-label={`${hookName} command ${idx + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = (hooks ?? []).filter((_: string, i: number) => i !== idx);
                          setConfig((prev) => ({
                            ...prev,
                            hooks: {
                              ...((prev.hooks as Record<string, unknown>) ?? {}),
                              [hookName]: updated,
                            },
                          }));
                          markDirty("hooks");
                        }}
                        style={{
                          padding: "2px 8px",
                          border: "1px solid #fecaca",
                          borderRadius: "4px",
                          background: "#fff",
                          color: "#ef4444",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setConfig((prev) => ({
                        ...prev,
                        hooks: {
                          ...((prev.hooks as Record<string, unknown>) ?? {}),
                          [hookName]: [...(hooks ?? []), ""],
                        },
                      }));
                      markDirty("hooks");
                    }}
                    style={{
                      padding: "3px 10px",
                      border: "1px solid #d1d5db",
                      borderRadius: "4px",
                      background: "#fff",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    Add hook command
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: "6px" }}>{renderSectionHeader("hooks")}</div>
      )}

      {/* ── Save / Reset ── */}
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
          onClick={validateAndSave}
          disabled={saving || !hasChanges}
          style={{
            padding: "8px 20px",
            backgroundColor: hasChanges ? "#3b82f6" : "#d1d5db",
            color: hasChanges ? "#fff" : "#6b7280",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: saving || !hasChanges ? "not-allowed" : "pointer",
            opacity: saving || !hasChanges ? 0.6 : 1,
          }}
        >
          {saving ? "Saving..." : "Save Configuration"}
        </button>
        <button
          onClick={() => {
            setSections(initSectionMap());
            setError(null);
            setSuccessMsg(null);
            setFormErrors({});
            if (defaultConfig) setConfig(defaultConfig);
          }}
          disabled={saving}
          style={{
            padding: "8px 20px",
            backgroundColor: "#fff",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 500,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/* ── Executor Form Fields Compact ── */

interface ExecutorFormFieldsCompactProps {
  formId: string;
  executorForm: { name: string } & ExecutorEntry;
  formErrors: FormErrors;
  updateField: (field: string, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
}

const EXECUTOR_TYPES = ["shell", "command", "manual"] as const;
const INPUT_MODES = ["argument", "stdin", "file"] as const;

function ExecutorFormFieldsCompact({
  formId,
  executorForm,
  formErrors,
  updateField,
  onSave,
  onCancel,
}: ExecutorFormFieldsCompactProps) {
  const fieldId = (name: string) => `${formId}-executor-${name}`;
  return (
    <div role="form" aria-label="Executor editor" style={{ fontSize: "13px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <div>
          <label
            htmlFor={fieldId("name")}
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "2px",
            }}
          >
            Name
          </label>
          <input
            id={fieldId("name")}
            type="text"
            value={executorForm.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("name", e.target.value)}
            style={{
              width: "100%",
              padding: "4px 8px",
              border: `1px solid ${formErrors.executorName ? "#ef4444" : "#d1d5db"}`,
              borderRadius: "4px",
              fontSize: "12px",
              boxSizing: "border-box",
            }}
            aria-invalid={!!formErrors.executorName}
          />
          {formErrors.executorName && (
            <span style={{ color: "#ef4444", fontSize: "11px" }}>{formErrors.executorName}</span>
          )}
        </div>
        <div>
          <label
            htmlFor={fieldId("type")}
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "2px",
            }}
          >
            Type
          </label>
          <select
            id={fieldId("type")}
            value={executorForm.type}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField("type", e.target.value)}
            style={{
              width: "100%",
              padding: "4px 8px",
              border: "1px solid #d1d5db",
              borderRadius: "4px",
              fontSize: "12px",
            }}
          >
            {EXECUTOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: "6px" }}>
        <label
          htmlFor={fieldId("command")}
          style={{
            display: "block",
            fontSize: "11px",
            fontWeight: 600,
            color: "#374151",
            marginBottom: "2px",
          }}
        >
          Command
        </label>
        <input
          id={fieldId("command")}
          type="text"
          value={executorForm.command ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("command", e.target.value || undefined)
          }
          placeholder="npx tsx src/cli/main.ts"
          style={{
            width: "100%",
            padding: "4px 8px",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            fontSize: "12px",
            boxSizing: "border-box",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: "8px", marginTop: "6px", alignItems: "center" }}>
        <div>
          <label
            htmlFor={fieldId("inputMode")}
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "2px",
            }}
          >
            Input mode
          </label>
          <select
            id={fieldId("inputMode")}
            value={executorForm.inputMode}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateField("inputMode", e.target.value)
            }
            style={{
              padding: "4px 8px",
              border: "1px solid #d1d5db",
              borderRadius: "4px",
              fontSize: "12px",
            }}
          >
            {INPUT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={fieldId("timeout")}
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "2px",
            }}
          >
            Timeout (ms)
          </label>
          <input
            id={fieldId("timeout")}
            type="number"
            min={0}
            step={1000}
            value={executorForm.timeoutMs ?? 1800000}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateField("timeoutMs", parseInt(e.target.value, 10))
            }
            style={{
              width: "100px",
              padding: "4px 8px",
              border: "1px solid #d1d5db",
              borderRadius: "4px",
              fontSize: "12px",
            }}
          />
        </div>
      </div>
      <div style={{ marginTop: "10px", display: "flex", gap: "6px" }}>
        <button
          type="button"
          onClick={onSave}
          style={{
            padding: "4px 12px",
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Save Executor
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "4px 12px",
            background: "#fff",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
