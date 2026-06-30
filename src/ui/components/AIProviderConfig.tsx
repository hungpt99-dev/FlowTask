import { useState, useCallback, useEffect, useId, type ChangeEvent } from "react";
import { AiProviderConfigSchema } from "../../ai/ai.schema.js";
import type { AiProviderConfig } from "../../ai/ai.schema.js";

type FormErrors = Partial<Record<string, string>>;

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

const DEFAULT_TIMEOUT_MS = 60000;

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
    timeoutMs: DEFAULT_TIMEOUT_MS,
    healthCheck: { enabled: true, timeoutMs: 10000 },
  };
}

export interface AIProviderConfigProps {
  defaultProviders?: Record<string, AiProviderConfig>;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onLoad?: () => Promise<{
    providers: Record<string, AiProviderConfig>;
  }>;
}

export function AIProviderConfig({ defaultProviders, onSave, onLoad }: AIProviderConfigProps) {
  const formId = useId();

  const [providers, setProviders] = useState<Record<string, AiProviderConfig>>(
    defaultProviders ?? {},
  );
  const [providersDirty, setProvidersDirty] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState<{ name: string } & AiProviderConfig>(
    defaultProviderForm(),
  );
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (defaultProviders) {
      setProviders(defaultProviders);
      setProvidersDirty(false);
    }
  }, [defaultProviders]);

  useEffect(() => {
    if (!onLoad) return;
    setLoading(true);
    setError(null);
    onLoad()
      .then((data) => {
        if (data.providers) {
          setProviders(data.providers);
          setProvidersDirty(false);
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load AI provider config"),
      )
      .finally(() => setLoading(false));
  }, [onLoad]);

  const clearSuccess = useCallback(() => {
    setSuccessMsg(null);
  }, []);

  const resetForm = useCallback(() => {
    setEditingKey(null);
    setProviderForm(defaultProviderForm());
    setFormErrors({});
    setDeleteConfirmKey(null);
  }, []);

  const startAdd = useCallback(() => {
    resetForm();
    setEditingKey("__new__");
    setProviderForm(defaultProviderForm());
  }, [resetForm]);

  const startEdit = useCallback((name: string, config: AiProviderConfig) => {
    setEditingKey(name);
    setProviderForm({ name, ...config });
    setFormErrors({});
    setDeleteConfirmKey(null);
  }, []);

  const cancelEdit = useCallback(() => {
    resetForm();
  }, [resetForm]);

  const updateField = useCallback((field: string, value: unknown) => {
    setProviderForm((prev) => ({ ...prev, [field]: value }));
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const updateHeader = useCallback((key: string, value: string) => {
    setProviderForm((prev) => ({
      ...prev,
      headers: { ...(prev.headers ?? {}), [key]: value },
    }));
  }, []);

  const removeHeader = useCallback((key: string) => {
    setProviderForm((prev) => {
      const next = { ...(prev.headers ?? {}) };
      delete next[key];
      return { ...prev, headers: next };
    });
  }, []);

  const addHeader = useCallback(() => {
    setProviderForm((prev) => ({
      ...prev,
      headers: { ...(prev.headers ?? {}), "": "" },
    }));
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

    const parseResult = AiProviderConfigSchema.safeParse(config);
    if (!parseResult.success) {
      const errs: FormErrors = {};
      for (const issue of parseResult.error.issues) {
        errs[issue.path.join(".")] = issue.message;
      }
      setFormErrors(errs);
      return;
    }

    if (editingKey === "__new__" && providers[name.trim()]) {
      setFormErrors((prev) => ({ ...prev, providerName: "Provider name already exists" }));
      return;
    }

    setFormErrors({});
    setProviders((prev) => {
      const next = { ...prev };
      if (editingKey && editingKey !== "__new__" && editingKey !== name.trim()) {
        delete next[editingKey];
      }
      next[name.trim()] = parseResult.data;
      return next;
    });
    setProvidersDirty(true);
    resetForm();
  }, [providerForm, editingKey, providers, resetForm]);

  const confirmDelete = useCallback((key: string) => {
    setDeleteConfirmKey(key);
    setEditingKey(null);
  }, []);

  const executeDelete = useCallback((key: string) => {
    setProviders((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setProvidersDirty(true);
    setDeleteConfirmKey(null);
  }, []);

  const saveAll = useCallback(async () => {
    if (!providersDirty) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await onSave({ ai: { providers } });
      setProvidersDirty(false);
      setSuccessMsg("AI provider configuration saved successfully");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save AI provider configuration");
    } finally {
      setSaving(false);
    }
  }, [providers, providersDirty, onSave]);

  const providerNames = Object.keys(providers);

  if (loading) {
    return (
      <div role="status" aria-live="polite">
        Loading AI provider configuration...
      </div>
    );
  }

  return (
    <div role="region" aria-label="AI provider configuration">
      {error && (
        <div role="alert" aria-live="assertive">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      )}

      {successMsg && (
        <div role="status" aria-live="polite">
          {successMsg}
          <button onClick={clearSuccess} aria-label="Dismiss success message">
            Dismiss
          </button>
        </div>
      )}

      <fieldset>
        <legend>AI Providers</legend>

        {providerNames.length === 0 && !editingKey && (
          <div>No AI providers configured. Add one to get started.</div>
        )}

        {providerNames.map((name) => (
          <div key={name} role="listitem" aria-label={`Provider: ${name}`}>
            {editingKey === name ? (
              <ProviderFormFields
                isNew={false}
                formData={providerForm}
                formErrors={formErrors}
                formId={formId}
                updateField={updateField}
                updateHeader={updateHeader}
                removeHeader={removeHeader}
                addHeader={addHeader}
                saveProvider={saveProvider}
                cancelEdit={cancelEdit}
              />
            ) : (
              <div>
                <div>
                  <strong>{name}</strong>
                  <span>Type: {providers[name]!.type}</span>
                </div>
                {providers[name]!.baseUrl && <div>Base URL: {providers[name]!.baseUrl}</div>}
                {providers[name]!.apiKeyEnv && <div>API Key Env: {providers[name]!.apiKeyEnv}</div>}
                {providers[name]!.apiVersion && (
                  <div>API Version: {providers[name]!.apiVersion}</div>
                )}
                {providers[name]!.timeoutMs && <div>Timeout: {providers[name]!.timeoutMs}ms</div>}
                <div>
                  <button
                    onClick={() => startEdit(name, providers[name]!)}
                    aria-label={`Edit provider ${name}`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => confirmDelete(name)}
                    aria-label={`Delete provider ${name}`}
                  >
                    Delete
                  </button>
                </div>
                {deleteConfirmKey === name && (
                  <div role="alertdialog" aria-label="Confirm delete">
                    <p>Delete provider "{name}"?</p>
                    <button onClick={() => executeDelete(name)}>Confirm Delete</button>
                    <button onClick={() => setDeleteConfirmKey(null)}>Cancel</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {editingKey === "__new__" && (
          <ProviderFormFields
            isNew={true}
            formData={providerForm}
            formErrors={formErrors}
            formId={formId}
            updateField={updateField}
            updateHeader={updateHeader}
            removeHeader={removeHeader}
            addHeader={addHeader}
            saveProvider={saveProvider}
            cancelEdit={cancelEdit}
          />
        )}

        {editingKey === null && <button onClick={startAdd}>Add Provider</button>}
      </fieldset>

      <div>
        <button onClick={saveAll} disabled={saving || !providersDirty || editingKey !== null}>
          {saving ? "Saving..." : "Save Configuration"}
        </button>
        <button
          onClick={() => {
            if (defaultProviders) {
              setProviders(defaultProviders);
            }
            setProvidersDirty(false);
            setError(null);
            resetForm();
          }}
          disabled={saving}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

interface ProviderFormFieldsProps {
  isNew: boolean;
  formData: { name: string } & AiProviderConfig;
  formErrors: FormErrors;
  formId: string;
  updateField: (field: string, value: unknown) => void;
  updateHeader: (key: string, value: string) => void;
  removeHeader: (key: string) => void;
  addHeader: () => void;
  saveProvider: () => void;
  cancelEdit: () => void;
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
  saveProvider,
  cancelEdit,
}: ProviderFormFieldsProps) {
  const fieldId = (name: string) => `${formId}-${name}`;
  const errorId = (name: string) => `${fieldId(name)}-error`;

  return (
    <div role="form" aria-label="AI provider editor">
      <div>
        <label htmlFor={fieldId("name")}>Provider name</label>
        <input
          id={fieldId("name")}
          type="text"
          value={formData.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateField("name", e.target.value)}
          aria-invalid={!!formErrors.providerName}
          aria-describedby={formErrors.providerName ? errorId("providerName") : undefined}
        />
        {formErrors.providerName && (
          <span id={errorId("providerName")} role="alert">
            {formErrors.providerName}
          </span>
        )}
      </div>

      <div>
        <label htmlFor={fieldId("type")}>Provider type</label>
        <select
          id={fieldId("type")}
          value={formData.type}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField("type", e.target.value)}
          aria-invalid={!!formErrors.type}
          aria-describedby={formErrors.type ? errorId("type") : undefined}
        >
          {KNOWN_PROVIDER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {formErrors.type && (
          <span id={errorId("type")} role="alert">
            {formErrors.type}
          </span>
        )}
      </div>

      <div>
        <label htmlFor={fieldId("baseUrl")}>Base URL</label>
        <input
          id={fieldId("baseUrl")}
          type="text"
          value={formData.baseUrl ?? ""}
          placeholder="https://api.openai.com/v1"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("baseUrl", e.target.value || undefined)
          }
        />
      </div>

      <div>
        <label htmlFor={fieldId("apiKeyEnv")}>API Key Environment Variable</label>
        <input
          id={fieldId("apiKeyEnv")}
          type="text"
          value={formData.apiKeyEnv ?? ""}
          placeholder="OPENAI_API_KEY"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("apiKeyEnv", e.target.value || undefined)
          }
        />
      </div>

      <div>
        <label htmlFor={fieldId("apiKeyRef")}>API Key Config Reference</label>
        <input
          id={fieldId("apiKeyRef")}
          type="password"
          value={formData.apiKeyRef ?? ""}
          placeholder="path.to.key.in.config"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("apiKeyRef", e.target.value || undefined)
          }
        />
      </div>

      <div>
        <label htmlFor={fieldId("endpointEnv")}>Endpoint Environment Variable</label>
        <input
          id={fieldId("endpointEnv")}
          type="text"
          value={formData.endpointEnv ?? ""}
          placeholder="AZURE_OPENAI_ENDPOINT"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("endpointEnv", e.target.value || undefined)
          }
        />
      </div>

      <div>
        <label htmlFor={fieldId("apiVersion")}>API Version</label>
        <input
          id={fieldId("apiVersion")}
          type="text"
          value={formData.apiVersion ?? ""}
          placeholder="2024-02-01"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("apiVersion", e.target.value || undefined)
          }
        />
      </div>

      <div>
        <label htmlFor={fieldId("timeoutMs")}>Timeout (ms)</label>
        <input
          id={fieldId("timeoutMs")}
          type="number"
          min={1000}
          step={1000}
          value={formData.timeoutMs ?? DEFAULT_TIMEOUT_MS}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("timeoutMs", parseInt(e.target.value, 10))
          }
        />
      </div>

      <div>
        <label htmlFor={fieldId("supportsJsonObject")}>Supports JSON mode</label>
        <input
          id={fieldId("supportsJsonObject")}
          type="checkbox"
          checked={formData.supportsJsonObject ?? true}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("supportsJsonObject", e.target.checked)
          }
        />
      </div>

      <div>
        <label htmlFor={fieldId("supportsStreaming")}>Supports streaming</label>
        <input
          id={fieldId("supportsStreaming")}
          type="checkbox"
          checked={formData.supportsStreaming ?? true}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("supportsStreaming", e.target.checked)
          }
        />
      </div>

      <div>
        <label htmlFor={fieldId("allowNoApiKey")}>Allow no API key</label>
        <input
          id={fieldId("allowNoApiKey")}
          type="checkbox"
          checked={formData.allowNoApiKey ?? false}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            updateField("allowNoApiKey", e.target.checked)
          }
        />
      </div>

      {/* Custom headers */}
      <div>
        <span>Custom headers</span>
        {formData.headers && Object.keys(formData.headers).length > 0 ? (
          Object.entries(formData.headers).map(([key, value], idx) => (
            <div key={idx}>
              <input
                type="text"
                value={key}
                placeholder="Header name"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const newVal = e.target.value;
                  const oldHeaders = { ...formData.headers };
                  delete oldHeaders[key];
                  oldHeaders[newVal] = value;
                  updateField("headers", oldHeaders);
                }}
                aria-label={`Custom header ${idx + 1} name`}
              />
              <input
                type="text"
                value={value}
                placeholder="Header value"
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateHeader(key, e.target.value)}
                aria-label={`Custom header ${idx + 1} value`}
              />
              <button
                type="button"
                onClick={() => removeHeader(key)}
                aria-label={`Remove header ${idx + 1}`}
              >
                Remove
              </button>
            </div>
          ))
        ) : (
          <div>No custom headers configured.</div>
        )}
        <button type="button" onClick={addHeader}>
          Add header
        </button>
      </div>

      {/* Health check */}
      <fieldset>
        <legend>Health check</legend>
        <div>
          <label htmlFor={fieldId("healthCheckEnabled")}>Enable health check</label>
          <input
            id={fieldId("healthCheckEnabled")}
            type="checkbox"
            checked={formData.healthCheck?.enabled ?? true}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateField("healthCheck", {
                ...(formData.healthCheck ?? {}),
                enabled: e.target.checked,
              })
            }
          />
        </div>
        <div>
          <label htmlFor={fieldId("healthCheckTimeoutMs")}>Health check timeout (ms)</label>
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
          />
        </div>
      </fieldset>

      <div>
        <button onClick={saveProvider}>{isNew ? "Add Provider" : "Update Provider"}</button>
        <button onClick={cancelEdit}>Cancel</button>
      </div>
    </div>
  );
}
