// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIProviderConfig } from "../../src/ui/components/AIProviderConfig.js";
import type { AiProviderConfig } from "../../src/ai/ai.schema.js";

function defaultProviders(): Record<string, AiProviderConfig> {
  return {
    openai: {
      type: "openai",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      supportsJsonObject: true,
      supportsStreaming: true,
      allowNoApiKey: false,
      timeoutMs: 60000,
      healthCheck: { enabled: true, timeoutMs: 10000 },
    },
  };
}

describe("AIProviderConfig", () => {
  let onSave: ReturnType<typeof vi.fn>;
  let onLoad: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSave = vi.fn().mockResolvedValue(undefined);
    onLoad = vi.fn();
  });

  it("renders the AI provider config region", () => {
    render(<AIProviderConfig onSave={onSave} />);
    expect(screen.getByRole("region", { name: "AI provider configuration" })).toBeDefined();
  });

  it("shows empty state when no providers are configured", () => {
    render(<AIProviderConfig onSave={onSave} />);
    expect(screen.getByText("No AI providers configured. Add one to get started.")).toBeDefined();
  });

  it("renders existing providers", () => {
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);
    expect(screen.getAllByText("openai").length).toBeGreaterThan(0);
    expect(screen.getByText(/Type: openai/)).toBeDefined();
    expect(screen.getByText(/API Key Env: OPENAI_API_KEY/)).toBeDefined();
    expect(screen.getByText(/Base URL: https:\/\/api.openai.com\/v1/)).toBeDefined();
  });

  it("renders multiple providers", () => {
    const providers: Record<string, AiProviderConfig> = {
      ...defaultProviders(),
      anthropic: {
        type: "anthropic",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        supportsJsonObject: false,
        supportsStreaming: true,
        allowNoApiKey: false,
        timeoutMs: 120000,
        healthCheck: { enabled: true, timeoutMs: 10000 },
      },
    };
    render(<AIProviderConfig defaultProviders={providers} onSave={onSave} />);
    expect(screen.getAllByText(/Type:/).length).toBe(2);
    expect(screen.getByText(/Type: anthropic/)).toBeDefined();
  });

  it("adds a new provider", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    const nameInput = screen.getByLabelText("Provider name");
    await user.type(nameInput, "anthropic");

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    expect(screen.getAllByText("anthropic").length).toBeGreaterThan(0);
    expect(screen.getByText(/Type: openai/)).toBeDefined();
  });

  it("edits an existing provider", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit provider openai/ }));

    const baseUrlInput = screen.getByLabelText("Base URL");
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "https://custom.api.com/v1");

    await user.click(screen.getByRole("button", { name: "Update Provider" }));

    expect(screen.getByText(/Base URL: https:\/\/custom.api.com\/v1/)).toBeDefined();
  });

  it("deletes a provider", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Delete provider openai/ }));
    await user.click(screen.getByRole("button", { name: "Confirm Delete" }));

    expect(screen.queryByText("openai")).toBeNull();
    expect(screen.getByText("No AI providers configured. Add one to get started.")).toBeDefined();
  });

  it("shows validation error for empty provider name", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));
    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    expect(screen.getByText("Provider name is required")).toBeDefined();
  });

  it("shows validation error for duplicate provider name", async () => {
    const user = userEvent.setup();
    const providers: Record<string, AiProviderConfig> = {
      existing: {
        type: "openai",
        apiKeyEnv: "OPENAI_API_KEY",
        supportsJsonObject: true,
        supportsStreaming: true,
        allowNoApiKey: false,
        timeoutMs: 60000,
        healthCheck: { enabled: true, timeoutMs: 10000 },
      },
    };
    render(<AIProviderConfig defaultProviders={providers} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    const nameInput = screen.getByLabelText("Provider name");
    await user.type(nameInput, "existing");

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    expect(screen.getByText("Provider name already exists")).toBeDefined();
  });

  it("calls onSave with provider changes", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit provider openai/ }));

    const baseUrlInput = screen.getByLabelText("Base URL");
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "https://alt.api.com");

    await user.click(screen.getByRole("button", { name: "Update Provider" }));
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const saved = onSave.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved.ai).toBeDefined();
    const ai = saved.ai as Record<string, unknown>;
    const providers = ai.providers as Record<string, AiProviderConfig>;
    expect(providers.openai?.baseUrl).toBe("https://alt.api.com");
  });

  it("disables save button when no changes exist", () => {
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);

    const saveBtn = screen.getByRole("button", { name: "Save Configuration" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("enables save button after making changes", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit provider openai/ }));
    const baseUrlInput = screen.getByLabelText("Base URL");
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "https://new.url.com");
    await user.click(screen.getByRole("button", { name: "Update Provider" }));

    const saveBtn = screen.getByRole("button", { name: "Save Configuration" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("disables save button while saving", async () => {
    const user = userEvent.setup();
    const saveFn = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={saveFn} />);

    await user.click(screen.getByRole("button", { name: /Edit provider openai/ }));
    const baseUrlInput = screen.getByLabelText("Base URL");
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "https://new.url.com");
    await user.click(screen.getByRole("button", { name: "Update Provider" }));
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect((screen.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows loading state when loading", () => {
    const loadFn = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AIProviderConfig onSave={onSave} onLoad={loadFn} />);
    expect(screen.getByText("Loading AI provider configuration...")).toBeDefined();
  });

  it("loads providers from onLoad callback", async () => {
    const loadFn = vi.fn().mockResolvedValue({
      providers: {
        gemini: {
          type: "gemini",
          apiKeyEnv: "GEMINI_API_KEY",
          supportsJsonObject: true,
          supportsStreaming: true,
          allowNoApiKey: false,
          timeoutMs: 60000,
          healthCheck: { enabled: true, timeoutMs: 10000 },
        },
      },
    });
    render(<AIProviderConfig onSave={onSave} onLoad={loadFn} />);

    await waitFor(() => {
      expect(screen.getAllByText("gemini").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Type: gemini/)).toBeDefined();
  });

  it("shows error when onLoad fails", async () => {
    const loadFn = vi.fn().mockRejectedValue(new Error("Provider config load failed"));
    render(<AIProviderConfig onSave={onSave} onLoad={loadFn} />);

    await waitFor(() => {
      expect(screen.getByText("Provider config load failed")).toBeDefined();
    });
  });

  it("shows error when onSave fails", async () => {
    const user = userEvent.setup();
    const saveFn = vi.fn().mockRejectedValue(new Error("Save failed"));
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={saveFn} />);

    await user.click(screen.getByRole("button", { name: /Edit provider openai/ }));
    const baseUrlInput = screen.getByLabelText("Base URL");
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "https://new.url.com");
    await user.click(screen.getByRole("button", { name: "Update Provider" }));
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeDefined();
    });
  });

  it("shows success message on successful save", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit provider openai/ }));
    const baseUrlInput = screen.getByLabelText("Base URL");
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "https://new.url.com");
    await user.click(screen.getByRole("button", { name: "Update Provider" }));
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    await waitFor(() => {
      expect(screen.getByText("AI provider configuration saved successfully")).toBeDefined();
    });
  });

  it("resets error state on dismiss", async () => {
    const user = userEvent.setup();
    const loadFn = vi.fn().mockRejectedValue(new Error("Config error"));
    render(<AIProviderConfig onSave={onSave} onLoad={loadFn} />);

    await waitFor(() => {
      expect(screen.getByText("Config error")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Config error")).toBeNull();
  });

  it("resets provider list via reset button", async () => {
    const user = userEvent.setup();
    const providers: Record<string, AiProviderConfig> = {
      original: {
        type: "openai",
        apiKeyEnv: "ORIGINAL_API_KEY",
        supportsJsonObject: true,
        supportsStreaming: true,
        allowNoApiKey: false,
        timeoutMs: 60000,
        healthCheck: { enabled: true, timeoutMs: 10000 },
      },
    };
    render(<AIProviderConfig defaultProviders={providers} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));
    const nameInput = screen.getByLabelText("Provider name");
    await user.type(nameInput, "extra");
    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    expect(screen.getAllByText("extra").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getAllByText("original").length).toBeGreaterThan(0);
    expect(screen.queryByText("extra")).toBeNull();
  });

  it("cancels provider editing", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit provider openai/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getAllByText("openai").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Update Provider" })).toBeNull();
  });

  it("changes provider type via select", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    const typeSelect = screen.getByLabelText("Provider type") as HTMLSelectElement;
    await user.selectOptions(typeSelect, "anthropic");

    expect(typeSelect.value).toBe("anthropic");
  });

  it("edits provider name when not adding new", async () => {
    const user = userEvent.setup();
    const providers: Record<string, AiProviderConfig> = {
      oldName: {
        type: "openai",
        apiKeyEnv: "API_KEY",
        supportsJsonObject: true,
        supportsStreaming: true,
        allowNoApiKey: false,
        timeoutMs: 60000,
        healthCheck: { enabled: true, timeoutMs: 10000 },
      },
    };
    render(<AIProviderConfig defaultProviders={providers} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit provider oldName/ }));

    const nameInput = screen.getByLabelText("Provider name") as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "renamed");

    await user.click(screen.getByRole("button", { name: "Update Provider" }));

    expect(screen.getAllByText("renamed").length).toBeGreaterThan(0);
    expect(screen.queryByText("oldName")).toBeNull();
  });

  it("toggles supportsJsonObject checkbox", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    const checkbox = screen.getByLabelText("Supports JSON mode") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await user.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("toggles supportsStreaming checkbox", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    const checkbox = screen.getByLabelText("Supports streaming") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await user.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("toggles allowNoApiKey checkbox", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    const checkbox = screen.getByLabelText("Allow no API key") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("shows custom headers section with add capability", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    expect(screen.getByText("No custom headers configured.")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Add header" }));

    const headerNameInput = screen.getByLabelText("Custom header 1 name");
    const headerValueInput = screen.getByLabelText("Custom header 1 value");
    expect(headerNameInput).toBeDefined();
    expect(headerValueInput).toBeDefined();
  });

  it("removes a custom header", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    await user.click(screen.getByRole("button", { name: "Add header" }));

    expect(screen.getByLabelText("Custom header 1 name")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Remove header 1" }));

    expect(screen.getByText("No custom headers configured.")).toBeDefined();
  });

  it("shows health check section with toggles", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    const healthCheckToggle = screen.getByLabelText("Enable health check") as HTMLInputElement;
    expect(healthCheckToggle.checked).toBe(true);

    await user.click(healthCheckToggle);
    expect(healthCheckToggle.checked).toBe(false);
  });

  it("shows an added provider and allows saving it", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    const nameInput = screen.getByLabelText("Provider name");
    await user.type(nameInput, "ollama");

    await user.click(screen.getByRole("button", { name: "Add Provider" }));

    expect(screen.getAllByText("ollama").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const saved = onSave.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved.ai).toBeDefined();
    const ai = saved.ai as Record<string, unknown>;
    const providers = ai.providers as Record<string, AiProviderConfig>;
    expect(providers.ollama).toBeDefined();
    expect(providers.ollama!.type).toBe("openai");
  });

  it("disables save when no dirty changes", () => {
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);

    expect(
      (screen.getByRole("button", { name: "Save Configuration" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables save when editor is open", async () => {
    const user = userEvent.setup();
    render(<AIProviderConfig defaultProviders={defaultProviders()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit provider openai/ }));

    expect(
      (screen.getByRole("button", { name: "Save Configuration" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
