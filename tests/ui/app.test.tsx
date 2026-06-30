// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App, AppStateProvider, useAppState } from "../../src/ui/App.js";
import type { WorkflowFile, WorkflowTask } from "../../src/schemas/workflow.schema.js";

function makeTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: `task_${Date.now()}`,
    title: "Test task",
    executor: "shell",
    dependsOn: [],
    acceptanceCriteria: [],
    ...overrides,
  };
}

function makeWorkflow(tasks: WorkflowTask[] = []): WorkflowFile {
  return { runTitle: "Test workflow", tasks };
}

describe("App", () => {
  it("renders the app with navigation", () => {
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
  });

  it("shows FlowTask branding in sidebar", () => {
    render(<App />);
    expect(screen.getByText("FlowTask")).toBeDefined();
  });

  it("renders dashboard by default", () => {
    render(<App />);
    expect(screen.getByRole("region", { name: "Dashboard" })).toBeDefined();
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThanOrEqual(1);
  });

  it("shows server status indicator", () => {
    render(<App />);
    expect(screen.getByLabelText(/Server status:/)).toBeDefined();
  });
});

describe("AppStateProvider", () => {
  it("provides default state", () => {
    function TestConsumer() {
      const { state } = useAppState();
      return (
        <div>
          <span data-testid="server-status">{state.serverStatus}</span>
          <span data-testid="tasks-count">{state.workflow?.tasks.length ?? 0}</span>
          <span data-testid="providers-count">{Object.keys(state.aiProviders).length}</span>
        </div>
      );
    }

    render(
      <AppStateProvider>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("server-status").textContent).toBe("connecting");
    expect(screen.getByTestId("tasks-count").textContent).toBe("0");
    expect(screen.getByTestId("providers-count").textContent).toBe("0");
  });

  it("accepts initial workflow", () => {
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Initial task" })]);

    function TestConsumer() {
      const { state } = useAppState();
      return <span data-testid="tasks-count">{state.workflow?.tasks.length}</span>;
    }

    render(
      <AppStateProvider initialWorkflow={workflow}>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("tasks-count").textContent).toBe("1");
  });

  it("accepts initial AI providers", () => {
    const providers = { openai: { type: "openai" as const } };

    function TestConsumer() {
      const { state } = useAppState();
      return <span data-testid="providers-count">{Object.keys(state.aiProviders).length}</span>;
    }

    render(
      <AppStateProvider initialAiProviders={providers}>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("providers-count").textContent).toBe("1");
  });

  it("accepts initial runs", () => {
    const runs = [
      {
        runId: "run_1",
        title: "Test run",
        status: "running" as const,
        mode: "auto" as const,
        taskCount: 2,
        completedTaskCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    function TestConsumer() {
      const { state } = useAppState();
      return <span data-testid="runs-count">{state.runs.length}</span>;
    }

    render(
      <AppStateProvider initialRuns={runs}>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("runs-count").textContent).toBe("1");
  });

  it("updates server status", () => {
    function TestConsumer() {
      const { state, setServerStatus } = useAppState();
      return (
        <div>
          <span data-testid="status">{state.serverStatus}</span>
          <button onClick={() => setServerStatus("connected")}>Connect</button>
        </div>
      );
    }

    render(
      <AppStateProvider>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("status").textContent).toBe("connecting");
    fireEvent.click(screen.getByText("Connect"));
    expect(screen.getByTestId("status").textContent).toBe("connected");
  });

  it("updates workflow via setWorkflow", () => {
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task" })]);

    function TestConsumer() {
      const { state, setWorkflow } = useAppState();
      return (
        <div>
          <span data-testid="count">{state.workflow?.tasks.length ?? 0}</span>
          <button onClick={() => setWorkflow(workflow)}>Set Workflow</button>
        </div>
      );
    }

    render(
      <AppStateProvider>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("count").textContent).toBe("0");
    fireEvent.click(screen.getByText("Set Workflow"));
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("updates AI providers via setAiProviders", () => {
    function TestConsumer() {
      const { state, setAiProviders } = useAppState();
      return (
        <div>
          <span data-testid="count">{Object.keys(state.aiProviders).length}</span>
          <button onClick={() => setAiProviders({ custom: { type: "custom" as const } })}>
            Add Provider
          </button>
        </div>
      );
    }

    render(
      <AppStateProvider>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("count").textContent).toBe("0");
    fireEvent.click(screen.getByText("Add Provider"));
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("updates runs via setRuns", () => {
    const run = {
      runId: "run_1",
      title: "New run",
      status: "running" as const,
      mode: "auto" as const,
      taskCount: 1,
      completedTaskCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    function TestConsumer() {
      const { state, setRuns } = useAppState();
      return (
        <div>
          <span data-testid="count">{state.runs.length}</span>
          <button onClick={() => setRuns([run])}>Set Runs</button>
        </div>
      );
    }

    render(
      <AppStateProvider>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("count").textContent).toBe("0");
    fireEvent.click(screen.getByText("Set Runs"));
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("toggles sidebar collapse", () => {
    function TestConsumer() {
      const { state, toggleSidebar } = useAppState();
      return (
        <div>
          <span data-testid="collapsed">{state.sidebarCollapsed ? "true" : "false"}</span>
          <button onClick={toggleSidebar}>Toggle</button>
        </div>
      );
    }

    render(
      <AppStateProvider>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("collapsed").textContent).toBe("false");
    fireEvent.click(screen.getByText("Toggle"));
    expect(screen.getByTestId("collapsed").textContent).toBe("true");
  });

  it("calls onSaveWorkflow when saveWorkflow is invoked", async () => {
    const onSaveWorkflow = vi.fn().mockResolvedValue(undefined);
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task" })]);

    function TestConsumer() {
      const { saveWorkflow } = useAppState();
      return <button onClick={() => saveWorkflow(workflow)}>Save</button>;
    }

    render(
      <AppStateProvider onSaveWorkflow={onSaveWorkflow}>
        <TestConsumer />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(onSaveWorkflow).toHaveBeenCalledWith(workflow);
    });
  });

  it("calls onSaveOrchestratorConfig when saveOrchestratorConfig is invoked", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    function TestConsumer() {
      const { saveOrchestratorConfig } = useAppState();
      return (
        <button onClick={() => saveOrchestratorConfig({ planner: { default: "auto" } })}>
          Save
        </button>
      );
    }

    render(
      <AppStateProvider onSaveOrchestratorConfig={onSave}>
        <TestConsumer />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
  });

  it("throws error if useAppState used outside provider", () => {
    function TestConsumer() {
      useAppState();
      return null;
    }

    expect(() => render(<TestConsumer />)).toThrow(
      "useAppState must be used within an AppStateProvider",
    );
  });

  it("calls onSaveAiProviders when saveAiProviders is invoked", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    function TestConsumer() {
      const { saveAiProviders } = useAppState();
      return <button onClick={() => saveAiProviders({ ai: { providers: {} } })}>Save</button>;
    }

    render(
      <AppStateProvider onSaveAiProviders={onSave}>
        <TestConsumer />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
  });

  it("preserves existing state when updating single field", () => {
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task" })]);
    const providers = { openai: { type: "openai" as const } };

    function TestConsumer() {
      const { state, setServerStatus } = useAppState();
      return (
        <div>
          <span data-testid="tasks">{state.workflow?.tasks.length ?? 0}</span>
          <span data-testid="providers">{Object.keys(state.aiProviders).length}</span>
          <span data-testid="status">{state.serverStatus}</span>
          <button onClick={() => setServerStatus("connected")}>Connect</button>
        </div>
      );
    }

    render(
      <AppStateProvider initialWorkflow={workflow} initialAiProviders={providers}>
        <TestConsumer />
      </AppStateProvider>,
    );

    expect(screen.getByTestId("tasks").textContent).toBe("1");
    expect(screen.getByTestId("providers").textContent).toBe("1");
    expect(screen.getByTestId("status").textContent).toBe("connecting");

    fireEvent.click(screen.getByText("Connect"));

    expect(screen.getByTestId("tasks").textContent).toBe("1");
    expect(screen.getByTestId("providers").textContent).toBe("1");
    expect(screen.getByTestId("status").textContent).toBe("connected");
  });
});

describe("Dashboard", () => {
  it("shows workflow task count", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Task 1" }),
      makeTask({ id: "t2", title: "Task 2" }),
    ];
    const workflow = makeWorkflow(tasks);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppStateProvider initialWorkflow={workflow}>
          <div>Dashboard rendered</div>
        </AppStateProvider>
      </MemoryRouter>,
    );
  });

  it("shows AI providers count on dashboard", () => {
    const providers = {
      openai: { type: "openai" as const },
      anthropic: { type: "anthropic" as const, baseUrl: "https://api.anthropic.com" },
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppStateProvider initialAiProviders={providers}>
          <div>Dashboard has providers</div>
        </AppStateProvider>
      </MemoryRouter>,
    );
  });
});

describe("Sidebar", () => {
  it("has navigation links for all views", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav.querySelector('a[href="/"]')).toBeDefined();
    expect(nav.querySelector('a[href="/workflow-editor"]')).toBeDefined();
    expect(nav.querySelector('a[href="/orchestrator"]')).toBeDefined();
    expect(nav.querySelector('a[href="/ai-providers"]')).toBeDefined();
    expect(nav.querySelector('a[href="/run-monitor"]')).toBeDefined();
    expect(nav.querySelector('a[href="/workflow-graph"]')).toBeDefined();
  });

  it("collapses sidebar when toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggleButton = screen.getByLabelText("Collapse sidebar");
    await user.click(toggleButton);

    expect(screen.getByLabelText("Expand sidebar")).toBeDefined();
    expect(screen.queryByText("FlowTask")).toBeNull();
  });

  it("expands collapsed sidebar when toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText("Collapse sidebar"));
    expect(screen.getByLabelText("Expand sidebar")).toBeDefined();

    await user.click(screen.getByLabelText("Expand sidebar"));
    expect(screen.getByLabelText("Collapse sidebar")).toBeDefined();
    expect(screen.getByText("FlowTask")).toBeDefined();
  });
});
