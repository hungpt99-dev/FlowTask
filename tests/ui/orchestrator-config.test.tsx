// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrchestratorConfig } from "../../src/ui/components/OrchestratorConfig.js";
import { PlannerConfigSchema } from "../../src/schemas/planner.schema.js";
import { ValidationConfigSchema, type ExecutorEntry } from "../../src/schemas/config.schema.js";
import { z } from "zod";

type PlannerConfig = z.infer<typeof PlannerConfigSchema>;
type ValidationConfig = z.infer<typeof ValidationConfigSchema>;

function defaultPlanner(): PlannerConfig {
  return PlannerConfigSchema.parse({});
}

function defaultValidation(): ValidationConfig {
  return ValidationConfigSchema.parse({});
}

function defaultLimits() {
  return { maxRunMinutes: 120, maxTaskMinutes: 30, maxRetries: 2 };
}

describe("OrchestratorConfig", () => {
  let onSave: ReturnType<typeof vi.fn>;
  let onLoad: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSave = vi.fn().mockResolvedValue(undefined);
    onLoad = vi.fn();
  });

  it("renders the orchestrator config region", () => {
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("region", { name: "Orchestrator configuration" })).toBeDefined();
  });

  it("renders planner mode select with default value", () => {
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );
    const select = screen.getByLabelText("Planner mode") as HTMLSelectElement;
    expect(select.value).toBe("auto");
  });

  it("renders validation profile select with default value", () => {
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );
    const select = screen.getByLabelText("Validation profile") as HTMLSelectElement;
    expect(select.value).toBe("safe");
  });

  it("renders limits fields with default values", () => {
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );
    const runMinutes = screen.getByLabelText("Max run duration (minutes)") as HTMLInputElement;
    expect(runMinutes.value).toBe("120");
    const retries = screen.getByLabelText("Global max retries") as HTMLInputElement;
    expect(retries.value).toBe("2");
  });

  it("shows empty state when no executors are configured", () => {
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );
    expect(screen.getByText("No custom executors configured.")).toBeDefined();
  });

  it("renders existing executors", () => {
    const executors: Record<string, ExecutorEntry> = {
      myai: {
        type: "shell",
        command: "opencode",
        args: [],
        inputMode: "argument",
        timeoutMs: 300000,
      },
    };
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        executors={executors}
        onSave={onSave}
      />,
    );
    expect(screen.getAllByText("myai").length).toBeGreaterThan(0);
    expect(screen.getByText(/Type: shell/)).toBeDefined();
  });

  it("adds a new executor", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add Executor" }));

    const nameInput = screen.getByLabelText("Executor name");
    await user.type(nameInput, "custom-exec");

    await user.click(screen.getByRole("button", { name: "Save Executor" }));

    expect(screen.getAllByText("custom-exec").length).toBeGreaterThan(0);
  });

  it("edits an existing executor", async () => {
    const user = userEvent.setup();
    const executors: Record<string, ExecutorEntry> = {
      editMe: { type: "shell", args: [], inputMode: "argument", timeoutMs: 600000 },
    };
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        executors={executors}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Edit executor editMe/ }));

    const cmdInput = screen.getByLabelText("Command");
    await user.clear(cmdInput);
    await user.type(cmdInput, "npx tsx");

    await user.click(screen.getByRole("button", { name: "Save Executor" }));

    expect(screen.getByText(/Command: npx tsx/)).toBeDefined();
  });

  it("deletes an executor", async () => {
    const user = userEvent.setup();
    const executors: Record<string, ExecutorEntry> = {
      deleteMe: { type: "shell", args: [], inputMode: "argument", timeoutMs: 300000 },
    };
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        executors={executors}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Delete executor deleteMe/ }));

    expect(screen.queryByText("deleteMe")).toBeNull();
    expect(screen.getByText("No custom executors configured.")).toBeDefined();
  });

  it("updates planner mode on selection change", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    const select = screen.getByLabelText("Planner mode") as HTMLSelectElement;
    await user.selectOptions(select, "simple");

    expect(select.value).toBe("simple");
  });

  it("updates provider field", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    const input = screen.getByLabelText("Provider") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "anthropic");

    expect(input.value).toBe("anthropic");
  });

  it("updates model field", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    const input = screen.getByLabelText("Model") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "claude-3-5-sonnet");

    expect(input.value).toBe("claude-3-5-sonnet");
  });

  it("updates validation profile on selection change", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    const select = screen.getByLabelText("Validation profile") as HTMLSelectElement;
    await user.selectOptions(select, "full");

    expect(select.value).toBe("full");
  });

  it("calls onSave with planner changes", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    const modelInput = screen.getByLabelText("Model") as HTMLInputElement;
    await user.clear(modelInput);
    await user.type(modelInput, "gpt-4");

    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const saved = onSave.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved.planner).toBeDefined();
    expect((saved.planner as PlannerConfig).model).toBe("gpt-4");
  });

  it("calls onSave with executor changes", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add Executor" }));
    const nameInput = screen.getByLabelText("Executor name");
    await user.type(nameInput, "myexec");
    await user.click(screen.getByRole("button", { name: "Save Executor" }));

    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    const saved = onSave.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved.executors).toBeDefined();
    expect((saved.executors as Record<string, unknown>).myexec).toBeDefined();
  });

  it("shows loading state when loading", () => {
    const loadFn = vi.fn().mockReturnValue(new Promise(() => {}));
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
        onLoad={loadFn}
      />,
    );
    expect(screen.getByText("Loading orchestrator configuration...")).toBeDefined();
  });

  it("loads config from onLoad callback", async () => {
    const loadFn = vi.fn().mockResolvedValue({
      planner: PlannerConfigSchema.parse({
        default: "ai",
        provider: "anthropic",
        model: "claude-3-haiku",
      }),
      validation: ValidationConfigSchema.parse({ profile: "full" }),
      limits: { maxRunMinutes: 60, maxTaskMinutes: 15, maxRetries: 3 },
      executors: {
        customAI: {
          type: "command",
          command: "aider",
          args: [],
          inputMode: "stdin",
          timeoutMs: 600000,
        },
      },
    });
    render(<OrchestratorConfig onSave={onSave} onLoad={loadFn} />);

    await waitFor(() => {
      expect(screen.getAllByText("customAI").length).toBeGreaterThan(0);
    });

    const modelInput = screen.getByLabelText("Model") as HTMLInputElement;
    expect(modelInput.value).toBe("claude-3-haiku");

    const profileSelect = screen.getByLabelText("Validation profile") as HTMLSelectElement;
    expect(profileSelect.value).toBe("full");
  });

  it("shows error when onLoad fails", async () => {
    const loadFn = vi.fn().mockRejectedValue(new Error("Config load failed"));
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
        onLoad={loadFn}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Config load failed")).toBeDefined();
    });
  });

  it("shows error when onSave fails", async () => {
    const user = userEvent.setup();
    const saveFn = vi.fn().mockRejectedValue(new Error("Save failed"));
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={saveFn}
      />,
    );

    const modelInput = screen.getByLabelText("Model") as HTMLInputElement;
    await user.clear(modelInput);
    await user.type(modelInput, "gpt-4o");
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeDefined();
    });
  });

  it("shows success message on successful save", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    const modelInput = screen.getByLabelText("Model") as HTMLInputElement;
    await user.clear(modelInput);
    await user.type(modelInput, "gpt-4o");
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    await waitFor(() => {
      expect(screen.getByText("Configuration saved successfully")).toBeDefined();
    });
  });

  it("disables save button when no changes exist", () => {
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    const saveBtn = screen.getByRole("button", { name: "Save Configuration" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("enables save button after making changes", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    const modelInput = screen.getByLabelText("Model") as HTMLInputElement;
    await user.clear(modelInput);
    await user.type(modelInput, "gpt-4o");

    const saveBtn = screen.getByRole("button", { name: "Save Configuration" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("disables save button while saving", async () => {
    const user = userEvent.setup();
    const saveFn = vi.fn().mockReturnValue(new Promise(() => {}));
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={saveFn}
      />,
    );

    const modelInput = screen.getByLabelText("Model") as HTMLInputElement;
    await user.clear(modelInput);
    await user.type(modelInput, "gpt-4o");
    await user.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect((screen.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows step dependency table when executors exist", () => {
    const executors: Record<string, ExecutorEntry> = {
      stepA: { type: "shell", args: [], inputMode: "argument", timeoutMs: 300000 },
      stepB: { type: "shell", args: [], inputMode: "argument", timeoutMs: 300000 },
    };
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        executors={executors}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("table", { name: "Step dependency matrix" })).toBeDefined();
    expect(screen.getAllByText("stepA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("stepB").length).toBeGreaterThan(0);
  });

  it("adds a step dependency", async () => {
    const user = userEvent.setup();
    const executors: Record<string, ExecutorEntry> = {
      setup: { type: "shell", args: [], inputMode: "argument", timeoutMs: 300000 },
      build: { type: "shell", args: [], inputMode: "argument", timeoutMs: 300000 },
    };
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        executors={executors}
        onSave={onSave}
      />,
    );

    const addSelect = screen.getByLabelText("Add dependency for setup") as HTMLSelectElement;
    await user.selectOptions(addSelect, "build");

    expect(screen.getByRole("button", { name: "Remove dependency: setup → build" })).toBeDefined();
  });

  it("removes a step dependency", async () => {
    const user = userEvent.setup();
    const executors: Record<string, ExecutorEntry> = {
      setup: { type: "shell", args: [], inputMode: "argument", timeoutMs: 300000 },
      build: { type: "shell", args: [], inputMode: "argument", timeoutMs: 300000 },
    };
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        executors={executors}
        onSave={onSave}
      />,
    );

    const addSelect = screen.getByLabelText("Add dependency for setup") as HTMLSelectElement;
    await user.selectOptions(addSelect, "build");
    expect(screen.getByRole("button", { name: "Remove dependency: setup → build" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Remove dependency: setup → build" }));
    expect(screen.queryByRole("button", { name: "Remove dependency: setup → build" })).toBeNull();
  });

  it("shows validation commands section with add/remove capability", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add command" }));

    const cmdInput = screen.getByLabelText("Validation command 1") as HTMLInputElement;
    await user.type(cmdInput, "pnpm lint");

    await user.click(screen.getByRole("button", { name: /Remove command 1/ }));

    expect(screen.queryByLabelText("Validation command 1")).toBeNull();
  });

  it("shows executor args section with add/remove capability", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add Executor" }));
    await user.click(screen.getByRole("button", { name: "Add argument" }));

    const argInput = screen.getByLabelText("Argument 1") as HTMLInputElement;
    expect(argInput).toBeDefined();
  });

  it("shows error when saving with empty executor name", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add Executor" }));
    await user.click(screen.getByRole("button", { name: "Save Executor" }));

    expect(screen.getByText("Executor name is required")).toBeDefined();
  });

  it("resets error state on dismiss", async () => {
    const user = userEvent.setup();
    const loadFn = vi.fn().mockRejectedValue(new Error("Config error"));
    render(<OrchestratorConfig onSave={onSave} onLoad={loadFn} />);

    await waitFor(() => {
      expect(screen.getByText("Config error")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Config error")).toBeNull();
  });

  it("resets all changes via reset button", async () => {
    const user = userEvent.setup();
    render(
      <OrchestratorConfig
        defaultConfig={PlannerConfigSchema.parse({
          default: "auto",
          provider: "openai",
          model: "gpt-4.1-mini",
        })}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        onSave={onSave}
      />,
    );

    const modelInput = screen.getByLabelText("Model") as HTMLInputElement;
    await user.clear(modelInput);
    await user.type(modelInput, "changed-model");

    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("gpt-4.1-mini");
  });

  it("cancels executor edit", async () => {
    const user = userEvent.setup();
    const executors: Record<string, ExecutorEntry> = {
      testExec: { type: "shell", args: [], inputMode: "argument", timeoutMs: 300000 },
    };
    render(
      <OrchestratorConfig
        defaultConfig={defaultPlanner()}
        defaultValidation={defaultValidation()}
        defaultLimits={defaultLimits()}
        executors={executors}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Edit executor testExec/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getAllByText("testExec").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Save Executor" })).toBeNull();
  });
});
