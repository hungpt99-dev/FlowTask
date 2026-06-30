import { useState, useCallback, useEffect, useId, type ChangeEvent } from "react";
import { ExecutorConfigSchema, type ExecutorEntry } from "../../schemas/config.schema.js";
import { AiProviderConfigSchema, type AiProviderConfig } from "../../ai/ai.schema.js";

type FormErrors = Partial<Record<string, string>>;

type TabKey = "providers" | "executors" | "validators";

const EXECUTOR_TYPES = ["shell", "command", "manual"] as const;
const INPUT_MODES = ["argument", "stdin", "file"] as const;
const VALIDATION_PROFILES = ["quick", "safe", "full", "custom"] as const;
const AI_VALIDATION_MODES = ["off", "fallback", "always", "high_risk_only"] as const;
const KNOWN_PROVIDER_TYPES = [
  "openai",
  "openai-compatible",
  "anthropic",
  "gemini",
  "mistral",
  "azure-openai",
  "ollama",
  "custom",
] as const;

const TAB_LABELS: Record<TabKey, string> = {
  providers: "AI Providers",
  executors: "CLI Executors",
  validators: "Validators",
};

interface TestResult {
  providerName: string;
  status: "idle" | "testing" | "success" | "error";
  message?: string;
}

/* ── Default Provider Form ── */

function defaultProviderForm(): { name: string } & AiProviderConfig {
  return {
    name: "",
    type: "openai",
    baseUrl: "",
    apiKeyEnv: "",
    apiKeyRef: "",
    endpointEnv: "",
    apiVersion: "",
    supportsJsonObject: true,
    supportsStreaming: true,
    allowNoApiKey: false,
    headers: {},
    timeoutMs: 60000,
    healthCheck: { enabled: true, timeoutMs: 10000 },
  };
}

/* ── Props ── */

export interface ProviderManagerProps {
  defaultProviders?: Record<string, AiProviderConfig>;
  defaultExecutors?: Record<string, ExecutorEntry>;
  onSaveProviders?: (providers: Record<string, AiProviderConfig>) => Promise<void>;
  onSaveExecutors?: (executors: Record<string, ExecutorEntry>) => Promise<void>;
  onLoadProviders?: () => Promise<Record<string, AiProviderConfig>>;
  onLoadExecutors?: () => Promise<Record<string, ExecutorEntry>>;
  onTestProvider?: (name: string) => Promise<{ ok: boolean; error?: string }>;
}

/* ── Component ── */

export function ProviderManager({
  defaultProviders,
  defaultExecutors,
  onSaveProviders,
  onSaveExecutors,
  onLoadProviders,
  onLoadExecutors,
  onTestProvider,
}: ProviderManagerProps) {
  const formId = useId();
  const [activeTab, setActiveTab] = useState<TabKey>("providers");

  // Providers state
  const [providers, setProviders] = useState<Record<string, AiProviderConfig>>(
    defaultProviders ?? {},
  );
  const [providersDirty, setProvidersDirty] = useState(false);
  const [editingProviderKey, setEditingProviderKey] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState<{ name: string } & AiProviderConfig>(
    defaultProviderForm(),
  );
  const [deleteProviderConfirm, setDeleteProviderConfirm] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  // Executors state
  const [executors, setExecutors] = useState<Record<string, ExecutorEntry>>(defaultExecutors ?? {});
  const [executorsDirty, setExecutorsDirty] = useState(false);
  const [editingExecutorKey, setEditingExecutorKey] = useState<string | null>(null);
  const [executorForm, setExecutorForm] = useState<{ name: string } & ExecutorEntry>({
    name: "",
    type: "shell",
    args: [],
    inputMode: "argument",
    timeoutMs: 1800000,
  });
  const [deleteExecutorConfirm, setDeleteExecutorConfirm] = useState<string | null>(null);

  // Shared state
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  // ── Load initial data ──
  useEffect(() => {
    if (defaultProviders) {
      setProviders(defaultProviders);
      setProvidersDirty(false);
    }
  }, [defaultProviders]);

  useEffect(() => {
    if (defaultExecutors) {
      setExecutors(defaultExecutors);
      setExecutorsDirty(false);
    }
  }, [defaultExecutors]);

  useEffect(() => {
    if (!onLoadProviders) return;
    setLoading(true);
    onLoadProviders()
      .then((data) => {
        setProviders(data);
        setProvidersDirty(false);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load providers"),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLoadProviders]);

  useEffect(() => {
    if (!onLoadExecutors) return;
    setLoading(true);
    onLoadExecutors()
      .then((data) => {
        setExecutors(data);
        setExecutorsDirty(false);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load executors"),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLoadExecutors]);

  // ── Utility ──
  const clearSuccess = useCallback(() => setSuccessMsg(null), []);
  const clearError = useCallback(() => setError(null), []);

  const resetProviderForm = useCallback(() => {
    setEditingProviderKey(null);
    setProviderForm(defaultProviderForm());
    setFormErrors({});
    setDeleteProviderConfirm(null);
  }, []);

  // ── Provider handlers ──
  const startAddProvider = useCallback(() => {
    resetProviderForm();
    setEditingProviderKey("__new__");
    setProviderForm(defaultProviderForm());
  }, [resetProviderForm]);

  const startEditProvider = useCallback((name: string, config: AiProviderConfig) => {
    setEditingProviderKey(name);
    setProviderForm({ name, ...config });
    setFormErrors({});
    setDeleteProviderConfirm(null);
  }, []);

  const cancelProviderEdit = useCallback(() => resetProviderForm(), [resetProviderForm]);

  const updateProviderField = useCallback((field: string, value: unknown) => {
    setProviderForm((prev) => ({ ...prev, [field]: value }));
    setFormErrors((prev) => {
      const n = { ...prev };
      delete n[field];
      return n;
    });
  }, []);

  const updateProviderHeader = useCallback((key: string, value: string) => {
    setProviderForm((prev) => ({ ...prev, headers: { ...(prev.headers ?? {}), [key]: value } }));
  }, []);

  const removeProviderHeader = useCallback((key: string) => {
    setProviderForm((prev) => {
      const h = { ...(prev.headers ?? {}) };
      delete h[key];
      return { ...prev, headers: h };
    });
  }, []);

  const addProviderHeader = useCallback(() => {
    setProviderForm((prev) => ({ ...prev, headers: { ...(prev.headers ?? {}), "": "" } }));
  }, []);

  const confirmDeleteProvider = useCallback((key: string) => {
    setDeleteProviderConfirm(key);
    setEditingProviderKey(null);
  }, []);

  const executeDeleteProvider = useCallback((key: string) => {
    setProviders((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
    setProvidersDirty(true);
    setDeleteProviderConfirm(null);
  }, []);

  const saveProvider = useCallback(() => {
    const { name, ...config } = providerForm;
    if (!name.trim()) {
      setFormErrors((prev) => ({ ...prev, providerName: "Provider name is required" }));
      return;
    }
    if (!config.type) {
      setFormErrors((prev) => ({ ...prev, type: "Provider type is required" }));
      return;
    }
    const parsed = AiProviderConfigSchema.safeParse(config);
    if (!parsed.success) {
      const errs: FormErrors = {};
      for (const issue of parsed.error.issues) {
        errs[issue.path.join(".")] = issue.message;
      }
      setFormErrors(errs);
      return;
    }
    if (editingProviderKey === "__new__" && providers[name.trim()]) {
      setFormErrors((prev) => ({ ...prev, providerName: "Provider name already exists" }));
      return;
    }
    setFormErrors({});
    setProviders((prev) => {
      const n = { ...prev };
      if (
        editingProviderKey &&
        editingProviderKey !== "__new__" &&
        editingProviderKey !== name.trim()
      ) {
        delete n[editingProviderKey];
      }
      n[name.trim()] = parsed.data;
      return n;
    });
    setProvidersDirty(true);
    resetProviderForm();
  }, [providerForm, editingProviderKey, providers, resetProviderForm]);

  const testProvider = useCallback(
    async (name: string) => {
      if (!onTestProvider) return;
      setTestResults((prev) => ({ ...prev, [name]: { providerName: name, status: "testing" } }));
      try {
        const result = await onTestProvider(name);
        setTestResults((prev) => ({
          ...prev,
          [name]: {
            providerName: name,
            status: result.ok ? "success" : "error",
            message: result.error,
          },
        }));
      } catch (err: unknown) {
        setTestResults((prev) => ({
          ...prev,
          [name]: {
            providerName: name,
            status: "error",
            message: err instanceof Error ? err.message : "Test failed",
          },
        }));
      }
    },
    [onTestProvider],
  );

  const saveProviders = useCallback(async () => {
    if (!providersDirty || !onSaveProviders) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await onSaveProviders(providers);
      setProvidersDirty(false);
      setSuccessMsg("Providers saved successfully");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save providers");
    } finally {
      setSaving(false);
    }
  }, [providers, providersDirty, onSaveProviders]);

  // ── Executor handlers ──
  const startAddExecutor = useCallback(() => {
    setEditingExecutorKey("__new__");
    setExecutorForm({
      name: "",
      type: "shell",
      args: [],
      inputMode: "argument",
      timeoutMs: 1800000,
    });
  }, []);

  const startEditExecutor = useCallback((name: string, entry: ExecutorEntry) => {
    setEditingExecutorKey(name);
    setExecutorForm({ name, ...entry, args: entry.args ?? [] });
  }, []);

  const cancelExecutorEdit = useCallback(() => setEditingExecutorKey(null), []);

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
    setExecutorsDirty(true);
    setEditingExecutorKey(null);
  }, [executorForm]);

  const confirmDeleteExecutor = useCallback((key: string) => {
    setDeleteExecutorConfirm(key);
    setEditingExecutorKey(null);
  }, []);

  const executeDeleteExecutor = useCallback((key: string) => {
    setExecutors((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
    setExecutorsDirty(true);
    setDeleteExecutorConfirm(null);
  }, []);

  const saveExecutors = useCallback(async () => {
    if (!executorsDirty || !onSaveExecutors) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await onSaveExecutors(executors);
      setExecutorsDirty(false);
      setSuccessMsg("Executors saved successfully");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save executors");
    } finally {
      setSaving(false);
    }
  }, [executors, executorsDirty, onSaveExecutors]);

  // ── Render ──
  if (loading) {
    return (
      <div role="status" aria-live="polite">
        Loading...
      </div>
    );
  }

  return (
    <div role="region" aria-label="Provider, executor, and validator management">
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
            onClick={clearError}
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

      {/* ── Tabs ── */}
      <div
        role="tablist"
        aria-label="Configuration sections"
        style={{
          display: "flex",
          gap: "4px",
          marginBottom: "16px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => {
          const isActive = activeTab === tab;
          const isDirty =
            (tab === "providers" && providersDirty) || (tab === "executors" && executorsDirty);
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "8px 16px",
                border: "none",
                borderBottom: isActive ? "2px solid #3b82f6" : "2px solid transparent",
                backgroundColor: "transparent",
                color: isActive ? "#111827" : "#6b7280",
                fontWeight: isActive ? 600 : 500,
                fontSize: "13px",
                cursor: "pointer",
                marginBottom: "-1px",
              }}
            >
              {TAB_LABELS[tab]}
              {isDirty ? " *" : ""}
            </button>
          );
        })}
      </div>

      {/* ════════════════════════
          TAB: AI Providers
          ════════════════════════ */}
      {activeTab === "providers" && (
        <div role="tabpanel" aria-label="AI providers">
          {Object.keys(providers).length === 0 && !editingProviderKey && (
            <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "12px" }}>
              No AI providers configured.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {Object.entries(providers).map(([name, config]) => (
              <div
                key={name}
                style={{ border: "1px solid #e5e7eb", borderRadius: "6px", overflow: "hidden" }}
              >
                {editingProviderKey === name ? (
                  <ProviderFormFields
                    isNew={false}
                    formData={providerForm}
                    formErrors={formErrors}
                    formId={formId}
                    updateField={updateProviderField}
                    updateHeader={updateProviderHeader}
                    removeHeader={removeProviderHeader}
                    addHeader={addProviderHeader}
                    onSave={saveProvider}
                    onCancel={cancelProviderEdit}
                  />
                ) : (
                  <div>
                    <div
                      style={{
                        padding: "10px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        backgroundColor: "#fafafa",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: "14px" }}>{name}</strong>
                        <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "8px" }}>
                          {config.type}
                        </span>
                        {config.baseUrl && (
                          <span style={{ fontSize: "11px", color: "#9ca3af", marginLeft: "8px" }}>
                            {config.baseUrl}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() => testProvider(name)}
                          disabled={testResults[name]?.status === "testing"}
                          style={{
                            padding: "4px 10px",
                            border: "1px solid #d1d5db",
                            borderRadius: "4px",
                            background: "#fff",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          {testResults[name]?.status === "testing" ? "Testing..." : "Test"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditProvider(name, config)}
                          style={{
                            padding: "4px 10px",
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
                          onClick={() => confirmDeleteProvider(name)}
                          style={{
                            padding: "4px 10px",
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
                    {testResults[name] && testResults[name].status !== "idle" && (
                      <div
                        style={{
                          padding: "6px 12px",
                          fontSize: "12px",
                          borderTop: "1px solid #e5e7eb",
                          backgroundColor:
                            testResults[name].status === "success"
                              ? "#f0fdf4"
                              : testResults[name].status === "error"
                                ? "#fef2f2"
                                : "#fefce8",
                          color:
                            testResults[name].status === "success"
                              ? "#15803d"
                              : testResults[name].status === "error"
                                ? "#b91c1c"
                                : "#92400e",
                        }}
                      >
                        {testResults[name].status === "testing" ? "Testing connection..." : null}
                        {testResults[name].status === "success" ? "Connection successful" : null}
                        {testResults[name].status === "error"
                          ? (testResults[name].message ?? "Connection failed")
                          : null}
                      </div>
                    )}
                    {deleteProviderConfirm === name && (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderTop: "1px solid #fecaca",
                          backgroundColor: "#fef2f2",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: "12px", color: "#b91c1c" }}>
                          Delete provider "{name}"?
                        </span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() => executeDeleteProvider(name)}
                            style={{
                              padding: "3px 10px",
                              background: "#ef4444",
                              color: "#fff",
                              border: "none",
                              borderRadius: "4px",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteProviderConfirm(null)}
                            style={{
                              padding: "3px 10px",
                              background: "#fff",
                              border: "1px solid #d1d5db",
                              borderRadius: "4px",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {config.apiKeyEnv && (
                      <div
                        style={{
                          padding: "4px 12px",
                          fontSize: "11px",
                          color: "#6b7280",
                          borderTop: "1px solid #f3f4f6",
                        }}
                      >
                        API key: {config.apiKeyEnv}
                      </div>
                    )}
                    <div
                      style={{
                        padding: "4px 12px",
                        fontSize: "11px",
                        color: "#6b7280",
                        borderTop: "1px solid #f3f4f6",
                        display: "flex",
                        gap: "12px",
                      }}
                    >
                      <span>JSON: {config.supportsJsonObject ? "Yes" : "No"}</span>
                      <span>Stream: {config.supportsStreaming ? "Yes" : "No"}</span>
                      <span>Timeout: {config.timeoutMs}ms</span>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {editingProviderKey === "__new__" && (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", overflow: "hidden" }}>
                <ProviderFormFields
                  isNew={true}
                  formData={providerForm}
                  formErrors={formErrors}
                  formId={formId}
                  updateField={updateProviderField}
                  updateHeader={updateProviderHeader}
                  removeHeader={removeProviderHeader}
                  addHeader={addProviderHeader}
                  onSave={saveProvider}
                  onCancel={cancelProviderEdit}
                />
              </div>
            )}

            {editingProviderKey === null && (
              <button
                type="button"
                onClick={startAddProvider}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Add Provider
              </button>
            )}
          </div>

          <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #e5e7eb" }}>
            <button
              onClick={saveProviders}
              disabled={saving || !providersDirty || editingProviderKey !== null}
              style={{
                padding: "8px 20px",
                backgroundColor: providersDirty ? "#3b82f6" : "#d1d5db",
                color: providersDirty ? "#fff" : "#6b7280",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: 600,
                cursor:
                  saving || !providersDirty || editingProviderKey !== null
                    ? "not-allowed"
                    : "pointer",
                opacity: saving || !providersDirty ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : "Save Providers"}
            </button>
            <button
              onClick={() => {
                setProviders(defaultProviders ?? {});
                setProvidersDirty(false);
                setError(null);
              }}
              disabled={saving}
              style={{
                marginLeft: "8px",
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
      )}

      {/* ════════════════════════
          TAB: CLI Executors
          ════════════════════════ */}
      {activeTab === "executors" && (
        <div role="tabpanel" aria-label="CLI executors">
          {Object.keys(executors).length === 0 && !editingExecutorKey && (
            <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "12px" }}>
              No custom executors configured.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {Object.entries(executors).map(([name, entry]) => (
              <div
                key={name}
                style={{ border: "1px solid #e5e7eb", borderRadius: "6px", overflow: "hidden" }}
              >
                {editingExecutorKey === name ? (
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
                    <div
                      style={{
                        padding: "10px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        backgroundColor: "#fafafa",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: "14px" }}>{name}</strong>
                        <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "8px" }}>
                          Type: {entry.type}
                        </span>
                        {entry.command && (
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#6b7280",
                              marginLeft: "8px",
                              fontFamily: "monospace",
                            }}
                          >
                            {entry.command}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={() => startEditExecutor(name, entry)}
                          style={{
                            padding: "4px 10px",
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
                          onClick={() => confirmDeleteExecutor(name)}
                          style={{
                            padding: "4px 10px",
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
                    {deleteExecutorConfirm === name && (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderTop: "1px solid #fecaca",
                          backgroundColor: "#fef2f2",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: "12px", color: "#b91c1c" }}>
                          Delete executor "{name}"?
                        </span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() => executeDeleteExecutor(name)}
                            style={{
                              padding: "3px 10px",
                              background: "#ef4444",
                              color: "#fff",
                              border: "none",
                              borderRadius: "4px",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteExecutorConfirm(null)}
                            style={{
                              padding: "3px 10px",
                              background: "#fff",
                              border: "1px solid #d1d5db",
                              borderRadius: "4px",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    <div
                      style={{
                        padding: "4px 12px",
                        fontSize: "11px",
                        color: "#6b7280",
                        borderTop: "1px solid #f3f4f6",
                        display: "flex",
                        gap: "12px",
                      }}
                    >
                      <span>Input: {entry.inputMode}</span>
                      <span>Timeout: {entry.timeoutMs}ms</span>
                      {entry.args && entry.args.length > 0 && (
                        <span>Args: {entry.args.join(", ")}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {editingExecutorKey === "__new__" && (
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  overflow: "hidden",
                  padding: "12px",
                }}
              >
                <ExecutorFormFields
                  formId={formId}
                  executorForm={executorForm}
                  formErrors={formErrors}
                  updateField={updateExecutorField}
                  onSave={saveExecutor}
                  onCancel={cancelExecutorEdit}
                />
              </div>
            )}

            {editingExecutorKey === null && (
              <button
                type="button"
                onClick={startAddExecutor}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Add Executor
              </button>
            )}
          </div>

          <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #e5e7eb" }}>
            <button
              onClick={saveExecutors}
              disabled={saving || !executorsDirty || editingExecutorKey !== null}
              style={{
                padding: "8px 20px",
                backgroundColor: executorsDirty ? "#3b82f6" : "#d1d5db",
                color: executorsDirty ? "#fff" : "#6b7280",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: 600,
                cursor:
                  saving || !executorsDirty || editingExecutorKey !== null
                    ? "not-allowed"
                    : "pointer",
                opacity: saving || !executorsDirty ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : "Save Executors"}
            </button>
            <button
              onClick={() => {
                setExecutors(defaultExecutors ?? {});
                setExecutorsDirty(false);
                setError(null);
              }}
              disabled={saving}
              style={{
                marginLeft: "8px",
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
      )}

      {/* ════════════════════════
          TAB: Validators
          ════════════════════════ */}
      {activeTab === "validators" && (
        <div role="tabpanel" aria-label="Validators">
          <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: "0 0 12px" }}>
              Validation settings are managed in the Orchestrator Configuration. Below is a summary
              of the current validation profile options.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "12px",
              }}
            >
              {VALIDATION_PROFILES.map((profile) => (
                <div
                  key={profile}
                  style={{
                    padding: "12px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "6px",
                    backgroundColor: "#fafafa",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#374151",
                      marginBottom: "4px",
                      textTransform: "capitalize",
                    }}
                  >
                    {profile}
                  </div>
                  <div style={{ fontSize: "11px", color: "#6b7280" }}>
                    {profile === "quick" && "Minimal checks, fast feedback."}
                    {profile === "safe" && "Standard safety and validity checks."}
                    {profile === "full" && "Comprehensive verification."}
                    {profile === "custom" && "User-defined validation rules."}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: "16px",
                padding: "12px",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
              }}
            >
              <div
                style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}
              >
                AI Validation Modes
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {AI_VALIDATION_MODES.map((mode) => (
                  <div
                    key={mode}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "8px",
                      fontSize: "12px",
                    }}
                  >
                    <span style={{ fontWeight: 600, color: "#374151", minWidth: "100px" }}>
                      {mode}
                    </span>
                    <span style={{ color: "#6b7280" }}>
                      {mode === "off" && "Disable AI validation"}
                      {mode === "fallback" && "Use AI validation when no commands defined"}
                      {mode === "always" && "Always run AI validation"}
                      {mode === "high_risk_only" && "Only validate high-risk tasks with AI"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>
              <p style={{ margin: 0 }}>
                Configure validation commands, profiles, and AI validation mode in the{" "}
                <strong>Orchestrator Configuration</strong> page.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Provider Form Fields ── */

interface ProviderFormFieldsProps {
  isNew: boolean;
  formData: { name: string } & AiProviderConfig;
  formErrors: FormErrors;
  formId: string;
  updateField: (field: string, value: unknown) => void;
  updateHeader: (key: string, value: string) => void;
  removeHeader: (key: string) => void;
  addHeader: () => void;
  onSave: () => void;
  onCancel: () => void;
}

function ProviderFormFields({
  isNew,
  formData,
  formErrors,
  formId,
  updateField,
  updateHeader,
  removeHeader,
  addHeader,
  onSave,
  onCancel,
}: ProviderFormFieldsProps) {
  const fieldId = (name: string) => `${formId}-provider-${name}`;
  const errorId = (name: string) => `${fieldId(name)}-error`;

  const inputStyle = (hasError?: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "6px 10px",
    border: `1px solid ${hasError ? "#ef4444" : "#d1d5db"}`,
    borderRadius: "4px",
    fontSize: "13px",
    boxSizing: "border-box",
  });

  return (
    <div role="form" aria-label="AI provider editor" style={{ padding: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div>
          <label htmlFor={fieldId("name")} style={labelStyle}>
            Provider name
          </label>
          <input
            id={fieldId("name")}
            type="text"
            value={formData.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("name", e.target.value)}
            style={inputStyle(!!formErrors.providerName)}
            aria-invalid={!!formErrors.providerName}
            aria-describedby={formErrors.providerName ? errorId("name") : undefined}
          />
          {formErrors.providerName && (
            <span id={errorId("name")} role="alert" style={{ color: "#ef4444", fontSize: "11px" }}>
              {formErrors.providerName}
            </span>
          )}
        </div>
        <div>
          <label htmlFor={fieldId("type")} style={labelStyle}>
            Provider type
          </label>
          <select
            id={fieldId("type")}
            value={formData.type}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField("type", e.target.value)}
            style={inputStyle(!!formErrors.type)}
            aria-invalid={!!formErrors.type}
          >
            {KNOWN_PROVIDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {formErrors.type && (
            <span id={errorId("type")} role="alert" style={{ color: "#ef4444", fontSize: "11px" }}>
              {formErrors.type}
            </span>
          )}
        </div>
      </div>

      <div style={{ marginTop: "10px" }}>
        <label htmlFor={fieldId("baseUrl")} style={labelStyle}>
          Base URL
        </label>
        <input
          id={fieldId("baseUrl")}
          type="text"
          value={formData.baseUrl ?? ""}
          placeholder="https://api.openai.com/v1"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("baseUrl", e.target.value || undefined)
          }
          style={inputStyle()}
        />
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}
      >
        <div>
          <label htmlFor={fieldId("apiKeyEnv")} style={labelStyle}>
            API Key Env Variable
          </label>
          <input
            id={fieldId("apiKeyEnv")}
            type="text"
            value={formData.apiKeyEnv ?? ""}
            placeholder="OPENAI_API_KEY"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateField("apiKeyEnv", e.target.value || undefined)
            }
            style={inputStyle()}
          />
        </div>
        <div>
          <label htmlFor={fieldId("apiKeyRef")} style={labelStyle}>
            API Key Config Ref
          </label>
          <input
            id={fieldId("apiKeyRef")}
            type="password"
            value={formData.apiKeyRef ?? ""}
            placeholder="path.to.key"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateField("apiKeyRef", e.target.value || undefined)
            }
            style={inputStyle()}
          />
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}
      >
        <div>
          <label htmlFor={fieldId("endpointEnv")} style={labelStyle}>
            Endpoint Env Variable
          </label>
          <input
            id={fieldId("endpointEnv")}
            type="text"
            value={formData.endpointEnv ?? ""}
            placeholder="AZURE_OPENAI_ENDPOINT"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateField("endpointEnv", e.target.value || undefined)
            }
            style={inputStyle()}
          />
        </div>
        <div>
          <label htmlFor={fieldId("apiVersion")} style={labelStyle}>
            API Version
          </label>
          <input
            id={fieldId("apiVersion")}
            type="text"
            value={formData.apiVersion ?? ""}
            placeholder="2024-02-01"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateField("apiVersion", e.target.value || undefined)
            }
            style={inputStyle()}
          />
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}
      >
        <div>
          <label htmlFor={fieldId("timeoutMs")} style={labelStyle}>
            Timeout (ms)
          </label>
          <input
            id={fieldId("timeoutMs")}
            type="number"
            min={1000}
            step={1000}
            value={formData.timeoutMs ?? 60000}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateField("timeoutMs", parseInt(e.target.value, 10))
            }
            style={inputStyle()}
          />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", paddingBottom: "4px" }}>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={formData.supportsJsonObject ?? true}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                updateField("supportsJsonObject", e.target.checked)
              }
              style={{ marginRight: "4px" }}
            />
            JSON mode
          </label>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={formData.supportsStreaming ?? true}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                updateField("supportsStreaming", e.target.checked)
              }
              style={{ marginRight: "4px" }}
            />
            Streaming
          </label>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={formData.allowNoApiKey ?? false}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                updateField("allowNoApiKey", e.target.checked)
              }
              style={{ marginRight: "4px" }}
            />
            No API key
          </label>
        </div>
      </div>

      {/* Custom headers */}
      <div style={{ marginTop: "12px" }}>
        <span style={labelStyle}>Custom headers</span>
        {formData.headers && Object.keys(formData.headers).length > 0 ? (
          Object.entries(formData.headers).map(([key, value], idx) => (
            <div key={idx} style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
              <input
                type="text"
                value={key}
                placeholder="Header name"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const h = { ...formData.headers };
                  delete h[key];
                  h[e.target.value] = value;
                  updateField("headers", h);
                }}
                style={inputStyle()}
                aria-label={`Header ${idx + 1} name`}
              />
              <input
                type="text"
                value={value}
                placeholder="Value"
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateHeader(key, e.target.value)}
                style={inputStyle()}
                aria-label={`Header ${idx + 1} value`}
              />
              <button
                type="button"
                onClick={() => removeHeader(key)}
                style={{
                  padding: "4px 8px",
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
          ))
        ) : (
          <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
            No custom headers.
          </div>
        )}
        <button
          type="button"
          onClick={addHeader}
          style={{
            marginTop: "4px",
            padding: "3px 10px",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            background: "#fff",
            fontSize: "11px",
            cursor: "pointer",
          }}
        >
          Add header
        </button>
      </div>

      {/* Health check */}
      <div
        style={{
          marginTop: "12px",
          padding: "10px",
          border: "1px solid #e5e7eb",
          borderRadius: "4px",
        }}
      >
        <span style={{ ...labelStyle, marginBottom: "6px", display: "block" }}>Health check</span>
        <label style={{ ...labelStyle, display: "inline-flex", alignItems: "center", gap: "4px" }}>
          <input
            type="checkbox"
            checked={formData.healthCheck?.enabled ?? true}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateField("healthCheck", {
                ...(formData.healthCheck ?? {}),
                enabled: e.target.checked,
              })
            }
          />
          Enabled
        </label>
        <div style={{ marginTop: "6px" }}>
          <label htmlFor={fieldId("healthCheckTimeoutMs")} style={labelStyle}>
            Timeout (ms)
          </label>
          <input
            id={fieldId("healthCheckTimeoutMs")}
            type="number"
            min={1000}
            step={1000}
            value={formData.healthCheck?.timeoutMs ?? 10000}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateField("healthCheck", {
                ...(formData.healthCheck ?? {}),
                timeoutMs: parseInt(e.target.value, 10),
              })
            }
            style={{ ...inputStyle(), width: "150px" }}
          />
        </div>
      </div>

      <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={onSave}
          style={{
            padding: "6px 16px",
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isNew ? "Add Provider" : "Update Provider"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "6px 16px",
            background: "#fff",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Executor Form Fields ── */

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
  const inputStyle = (hasError?: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "6px 10px",
    border: `1px solid ${hasError ? "#ef4444" : "#d1d5db"}`,
    borderRadius: "4px",
    fontSize: "13px",
    boxSizing: "border-box",
  });

  return (
    <div role="form" aria-label="Executor editor" style={{ padding: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div>
          <label htmlFor={fieldId("name")} style={labelStyle}>
            Executor name
          </label>
          <input
            id={fieldId("name")}
            type="text"
            value={executorForm.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("name", e.target.value)}
            style={inputStyle(!!formErrors.executorName)}
            aria-invalid={!!formErrors.executorName}
          />
          {formErrors.executorName && (
            <span role="alert" style={{ color: "#ef4444", fontSize: "11px" }}>
              {formErrors.executorName}
            </span>
          )}
        </div>
        <div>
          <label htmlFor={fieldId("type")} style={labelStyle}>
            Type
          </label>
          <select
            id={fieldId("type")}
            value={executorForm.type}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField("type", e.target.value)}
            style={inputStyle()}
          >
            {EXECUTOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: "10px" }}>
        <label htmlFor={fieldId("command")} style={labelStyle}>
          Command
        </label>
        <input
          id={fieldId("command")}
          type="text"
          value={executorForm.command ?? ""}
          placeholder="npx tsx src/cli/main.ts"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("command", e.target.value || undefined)
          }
          style={inputStyle()}
        />
      </div>

      <div style={{ marginTop: "10px" }}>
        <label style={labelStyle}>Arguments</label>
        {(executorForm.args ?? []).length === 0 && (
          <div style={{ fontSize: "11px", color: "#9ca3af" }}>No arguments.</div>
        )}
        {(executorForm.args ?? []).map((arg, idx) => (
          <div key={idx} style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
            <input
              type="text"
              value={arg}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const updated = [...(executorForm.args ?? [])];
                updated[idx] = e.target.value;
                updateField("args", updated);
              }}
              style={inputStyle()}
              aria-label={`Argument ${idx + 1}`}
            />
            <button
              type="button"
              onClick={() => {
                const updated = (executorForm.args ?? []).filter((_, i) => i !== idx);
                updateField("args", updated);
              }}
              style={{
                padding: "4px 8px",
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
          onClick={() => updateField("args", [...(executorForm.args ?? []), ""])}
          style={{
            marginTop: "4px",
            padding: "3px 10px",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            background: "#fff",
            fontSize: "11px",
            cursor: "pointer",
          }}
        >
          Add argument
        </button>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}
      >
        <div>
          <label htmlFor={fieldId("inputMode")} style={labelStyle}>
            Input mode
          </label>
          <select
            id={fieldId("inputMode")}
            value={executorForm.inputMode}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              updateField("inputMode", e.target.value)
            }
            style={inputStyle()}
          >
            {INPUT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fieldId("timeout")} style={labelStyle}>
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
            style={inputStyle()}
          />
        </div>
      </div>

      <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={onSave}
          style={{
            padding: "6px 16px",
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            fontSize: "13px",
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
            padding: "6px 16px",
            background: "#fff",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Shared label style ── */

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 600,
  color: "#374151",
  marginBottom: "3px",
};
