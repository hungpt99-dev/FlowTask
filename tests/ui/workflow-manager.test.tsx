// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowManager } from "../../src/ui/components/WorkflowManager.js";
import type { RunIndexEntry } from "../../src/schemas/run.schema.js";
import type { WorkflowFile, WorkflowTask } from "../../src/schemas/workflow.schema.js";

function makeRunEntry(overrides: Partial<RunIndexEntry> = {}): RunIndexEntry {
  const now = new Date().toISOString();
  return {
    runId: `run_${Date.now()}`,
    title: "Test workflow",
    status: "created",
    mode: "auto",
    taskCount: 0,
    completedTaskCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: `task_${Date.now()}`,
    title: "Test task",
    description: "A test task",
    executor: "shell",
    dependsOn: [],
    acceptanceCriteria: [],
    maxRetries: 2,
    ...overrides,
  };
}

function makeWorkflow(tasks: WorkflowTask[] = []): WorkflowFile {
  return { runTitle: "Test workflow", tasks };
}

describe("WorkflowManager", () => {
  let onListWorkflows: ReturnType<typeof vi.fn>;
  let onCreateWorkflow: ReturnType<typeof vi.fn>;
  let onLoadWorkflow: ReturnType<typeof vi.fn>;
  let onSaveWorkflow: ReturnType<typeof vi.fn>;
  let onDeleteWorkflow: ReturnType<typeof vi.fn>;
  let onRunWorkflow: ReturnType<typeof vi.fn>;
  let onDuplicateWorkflow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onListWorkflows = vi.fn();
    onCreateWorkflow = vi.fn();
    onLoadWorkflow = vi.fn();
    onSaveWorkflow = vi.fn().mockResolvedValue(undefined);
    onDeleteWorkflow = vi.fn().mockResolvedValue(undefined);
    onRunWorkflow = vi.fn().mockResolvedValue(undefined);
    onDuplicateWorkflow = vi.fn();
  });

  it("renders the workflow list view by default", () => {
    render(<WorkflowManager />);
    expect(screen.getByRole("region", { name: "Workflow list" })).toBeDefined();
    expect(screen.getByText("Workflows")).toBeDefined();
  });

  it("shows empty state when no workflows exist", () => {
    render(<WorkflowManager />);
    expect(screen.getByText("No workflows yet. Create one to get started.")).toBeDefined();
  });

  it("renders workflows from prop", () => {
    const workflows = [makeRunEntry({ runId: "w1", title: "Workflow A" })];
    render(<WorkflowManager workflows={workflows} />);
    expect(screen.getByText("Workflow A")).toBeDefined();
    expect(screen.getByRole("listitem", { name: /Workflow: Workflow A/ })).toBeDefined();
  });

  it("renders multiple workflows", () => {
    const workflows = [
      makeRunEntry({ runId: "w1", title: "First" }),
      makeRunEntry({ runId: "w2", title: "Second" }),
    ];
    render(<WorkflowManager workflows={workflows} />);
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Second")).toBeDefined();
  });

  it("shows create new workflow button", () => {
    render(<WorkflowManager />);
    expect(screen.getByRole("button", { name: "Create new workflow" })).toBeDefined();
    expect(screen.getByText("+ New Workflow")).toBeDefined();
  });

  it("shows create form when create button is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkflowManager />);

    await user.click(screen.getByRole("button", { name: "Create new workflow" }));

    expect(screen.getByRole("region", { name: "Create workflow" })).toBeDefined();
    expect(screen.getByLabelText("Title *")).toBeDefined();
    expect(screen.getByLabelText("Mode")).toBeDefined();
    expect(screen.getByLabelText("Goal (optional)")).toBeDefined();
  });

  it("shows back button in create view", async () => {
    const user = userEvent.setup();
    render(<WorkflowManager />);

    await user.click(screen.getByRole("button", { name: "Create new workflow" }));
    await user.click(screen.getByRole("button", { name: "Back to workflow list" }));

    expect(screen.getByRole("region", { name: "Workflow list" })).toBeDefined();
  });

  it("validates empty title in create form", async () => {
    const user = userEvent.setup();
    render(<WorkflowManager />);

    await user.click(screen.getByRole("button", { name: "Create new workflow" }));
    await user.click(screen.getByRole("button", { name: "Create Workflow" }));

    expect(screen.getByText("Workflow title is required")).toBeDefined();
  });

  it("calls onCreateWorkflow and transitions to detail view", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "new_run", title: "My Workflow" });
    onCreateWorkflow.mockResolvedValue(entry);
    render(<WorkflowManager onCreateWorkflow={onCreateWorkflow} onLoadWorkflow={onLoadWorkflow} />);

    await user.click(screen.getByRole("button", { name: "Create new workflow" }));

    const titleInput = screen.getByLabelText("Title *");
    await user.type(titleInput, "My Workflow");

    await user.click(screen.getByRole("button", { name: "Create Workflow" }));

    await waitFor(() => {
      expect(onCreateWorkflow).toHaveBeenCalledWith("My Workflow", "auto", undefined);
    });
    expect(screen.getByRole("region", { name: "Workflow detail" })).toBeDefined();
  });

  it("shows error when onCreateWorkflow fails", async () => {
    const user = userEvent.setup();
    onCreateWorkflow.mockRejectedValue(new Error("Creation failed"));
    render(<WorkflowManager onCreateWorkflow={onCreateWorkflow} />);

    await user.click(screen.getByRole("button", { name: "Create new workflow" }));
    await user.type(screen.getByLabelText("Title *"), "My Workflow");
    await user.click(screen.getByRole("button", { name: "Create Workflow" }));

    await waitFor(() => {
      expect(screen.getByText("Creation failed")).toBeDefined();
    });
  });

  it("shows search input and status filter", () => {
    render(<WorkflowManager />);

    expect(screen.getByLabelText("Search workflows")).toBeDefined();
    expect(screen.getByLabelText("Filter by status")).toBeDefined();
  });

  it("filters workflows by search query", async () => {
    const user = userEvent.setup();
    const workflows = [
      makeRunEntry({ runId: "w1", title: "Alpha workflow" }),
      makeRunEntry({ runId: "w2", title: "Beta workflow" }),
    ];
    render(<WorkflowManager workflows={workflows} />);

    const searchInput = screen.getByLabelText("Search workflows");
    await user.type(searchInput, "Alpha");

    expect(screen.getByText("Alpha workflow")).toBeDefined();
    expect(screen.queryByText("Beta workflow")).toBeNull();
  });

  it("shows open and delete buttons for workflow items", () => {
    const workflows = [makeRunEntry({ runId: "w1", title: "Workflow" })];
    render(<WorkflowManager workflows={workflows} />);

    expect(screen.getByRole("button", { name: /Open workflow/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Delete workflow/ })).toBeDefined();
  });

  it("opens workflow detail view on click", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Detail workflow" });
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task 1" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(onLoadWorkflow).toHaveBeenCalledWith("w1");
    });
    expect(screen.getByRole("region", { name: "Workflow detail" })).toBeDefined();
  });

  it("shows delete confirmation inline in list", async () => {
    const user = userEvent.setup();
    const workflows = [makeRunEntry({ runId: "w1", title: "To Delete" })];
    render(<WorkflowManager workflows={workflows} />);

    await user.click(screen.getByRole("button", { name: /Delete workflow/ }));

    expect(screen.getByText(/Confirm\?/)).toBeDefined();
  });

  it("calls onDeleteWorkflow from list view", async () => {
    const user = userEvent.setup();
    const workflows = [makeRunEntry({ runId: "w1", title: "Delete Me" })];
    render(<WorkflowManager workflows={workflows} onDeleteWorkflow={onDeleteWorkflow} />);

    await user.click(screen.getByRole("button", { name: /Delete workflow/ }));
    await user.click(screen.getByRole("button", { name: /Confirm delete/ }));

    await waitFor(() => {
      expect(onDeleteWorkflow).toHaveBeenCalledWith("w1");
    });
  });

  it("cancels delete from list view", async () => {
    const user = userEvent.setup();
    const workflows = [makeRunEntry({ runId: "w1", title: "Keep Me" })];
    render(<WorkflowManager workflows={workflows} />);

    await user.click(screen.getByRole("button", { name: /Delete workflow/ }));
    await user.click(screen.getByRole("button", { name: "Cancel delete" }));

    expect(screen.queryByText(/Confirm\?/)).toBeNull();
  });

  it("returns to list view from detail view", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Back Test" });
    onLoadWorkflow.mockResolvedValue(makeWorkflow());
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Workflow detail" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Back to workflow list" }));

    expect(screen.getByRole("region", { name: "Workflow list" })).toBeDefined();
  });

  it("shows workflow detail info correctly", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({
      runId: "w1",
      title: "Detail View",
      status: "running",
      taskCount: 5,
      completedTaskCount: 2,
    });
    onLoadWorkflow.mockResolvedValue(makeWorkflow());
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByText("Detail View")).toBeDefined();
      expect(screen.getByText(/Tasks: 2\/5/)).toBeDefined();
    });
  });

  it("shows loading state when loading workflow tasks", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Loading" });
    onLoadWorkflow.mockReturnValue(new Promise(() => {}));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    expect(screen.getByText("Loading workflow tasks...")).toBeDefined();
  });

  it("shows error when onLoadWorkflow fails", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Error" });
    onLoadWorkflow.mockRejectedValue(new Error("Load error"));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByText("Load error")).toBeDefined();
    });
  });

  it("shows Run button for non-running workflow", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Run Me" });
    onLoadWorkflow.mockResolvedValue(makeWorkflow([makeTask({ id: "t1" })]));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
        onRunWorkflow={onRunWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Run this workflow" })).toBeDefined();
    });
  });

  it("shows Duplicate button in detail view", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Duplicate Me" });
    onLoadWorkflow.mockResolvedValue(makeWorkflow());
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
        onDuplicateWorkflow={onDuplicateWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Duplicate this workflow" })).toBeDefined();
    });
  });

  it("adds a task in detail view", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Add Task" });
    onLoadWorkflow.mockResolvedValue(makeWorkflow());
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add task to workflow" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Add task to workflow" }));

    expect(screen.getByDisplayValue("New task")).toBeDefined();
  });

  it("removes a task in detail view", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Remove Task" });
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task to remove" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Task to remove")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Remove task/ }));

    expect(screen.queryByDisplayValue("Task to remove")).toBeNull();
  });

  it("moves a task up and down", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Reorder" });
    const workflow = makeWorkflow([
      makeTask({ id: "t1", title: "First" }),
      makeTask({ id: "t2", title: "Second" }),
    ]);
    onLoadWorkflow.mockResolvedValue(workflow);
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("First")).toBeDefined();
      expect(screen.getByDisplayValue("Second")).toBeDefined();
    });

    const downButtons = screen.getAllByLabelText(/Move task.*down/);
    await user.click(downButtons[0]!);

    const taskInputs = screen.getAllByLabelText(/Title for task/);
    expect((taskInputs[0] as HTMLInputElement).value).toBe("Second");
    expect((taskInputs[1] as HTMLInputElement).value).toBe("First");
  });

  it("calls onSaveWorkflow with valid data", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Save Test" });
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Task")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Save Workflow" }));

    await waitFor(() => {
      expect(onSaveWorkflow).toHaveBeenCalledWith(
        "w1",
        expect.objectContaining({
          tasks: expect.arrayContaining([expect.objectContaining({ title: "Task" })]),
        }),
      );
    });
  });

  it("prevents save when no tasks exist", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Empty" });
    onLoadWorkflow.mockResolvedValue(makeWorkflow());
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Workflow" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Save Workflow" }));

    expect(screen.getByText("Workflow must have at least one task")).toBeDefined();
    expect(onSaveWorkflow).not.toHaveBeenCalled();
  });

  it("calls onListWorkflows on mount", async () => {
    const list = [makeRunEntry({ runId: "w1", title: "Auto Load" })];
    onListWorkflows.mockResolvedValue(list);
    render(<WorkflowManager onListWorkflows={onListWorkflows} />);

    await waitFor(() => {
      expect(onListWorkflows).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText("Auto Load")).toBeDefined();
    });
  });

  it("shows error when onListWorkflows fails", async () => {
    onListWorkflows.mockRejectedValue(new Error("Failed to load"));
    render(<WorkflowManager onListWorkflows={onListWorkflows} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load")).toBeDefined();
    });
  });

  it("dismisses error in list view", async () => {
    const user = userEvent.setup();
    onListWorkflows.mockRejectedValue(new Error("Dismiss me"));
    render(<WorkflowManager onListWorkflows={onListWorkflows} />);

    await waitFor(() => {
      expect(screen.getByText("Dismiss me")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Dismiss me")).toBeNull();
  });

  it("dismisses error in detail view", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Detail error" });
    onLoadWorkflow.mockRejectedValue(new Error("Detail err"));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByText("Detail err")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Detail err")).toBeNull();
  });

  it("handles onRunWorkflow call", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Run Test" });
    onLoadWorkflow.mockResolvedValue(makeWorkflow([makeTask({ id: "t1" })]));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
        onRunWorkflow={onRunWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Run this workflow" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Run this workflow" }));

    await waitFor(() => {
      expect(onRunWorkflow).toHaveBeenCalledWith("w1");
    });
  });

  it("handles onDuplicateWorkflow call", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Duplicate Test" });
    const dupEntry = makeRunEntry({ runId: "dup_1", title: "Copy of Duplicate Test" });
    onDuplicateWorkflow.mockResolvedValue(dupEntry);
    onLoadWorkflow.mockResolvedValue(makeWorkflow());
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
        onDuplicateWorkflow={onDuplicateWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Duplicate this workflow" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Duplicate this workflow" }));

    await waitFor(() => {
      expect(onDuplicateWorkflow).toHaveBeenCalledWith("w1");
    });
  });

  it("shows status badge colors for different statuses", () => {
    const workflows = [
      makeRunEntry({ runId: "w1", title: "Running", status: "running" }),
      makeRunEntry({ runId: "w2", title: "Failed", status: "failed" }),
      makeRunEntry({ runId: "w3", title: "Succeeded", status: "succeeded" }),
    ];
    render(<WorkflowManager workflows={workflows} />);

    expect(screen.getAllByText("Running").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Failed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Succeeded").length).toBeGreaterThanOrEqual(1);
  });

  it("shows mode and task count in list items", () => {
    const workflows = [
      makeRunEntry({
        runId: "w1",
        title: "Mode Test",
        mode: "manual",
        taskCount: 3,
        completedTaskCount: 1,
      }),
    ];
    render(<WorkflowManager workflows={workflows} />);

    expect(screen.getByText(/Mode: manual/)).toBeDefined();
    expect(screen.getByText(/1\/3 tasks/)).toBeDefined();
  });

  it("shows 'No workflows match' when filtered has no results", async () => {
    const user = userEvent.setup();
    const workflows = [makeRunEntry({ runId: "w1", title: "Only" })];
    render(<WorkflowManager workflows={workflows} />);

    const searchInput = screen.getByLabelText("Search workflows");
    await user.type(searchInput, "NonExistent");

    expect(screen.getByText("No workflows match your search criteria.")).toBeDefined();
  });

  it("shows loading spinner when loading", () => {
    onListWorkflows.mockReturnValue(new Promise(() => {}));
    render(<WorkflowManager onListWorkflows={onListWorkflows} />);

    expect(screen.getByText("Loading workflows...")).toBeDefined();
  });

  it("disables run button for running workflow", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({
      runId: "w1",
      title: "Already Running",
      status: "running",
    });
    onLoadWorkflow.mockResolvedValue(makeWorkflow([makeTask({ id: "t1" })]));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      const runBtn = screen.getByRole("button", { name: "Run this workflow" });
      expect(runBtn.getAttribute("disabled")).not.toBeNull();
      expect(runBtn.textContent).toBe("Running...");
    });
  });

  it("updates task title inline", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Edit Task" });
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Original" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Original")).toBeDefined();
    });

    const titleInput = screen.getByLabelText("Title for task 1");
    await user.clear(titleInput);
    await user.type(titleInput, "Updated");

    expect(screen.getByDisplayValue("Updated")).toBeDefined();
  });

  it("updates task description inline", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Desc Edit" });
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task", description: "Old desc" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Old desc")).toBeDefined();
    });

    const descInput = screen.getByLabelText("Description for task 1");
    await user.clear(descInput);
    await user.type(descInput, "New desc");

    expect(screen.getByDisplayValue("New desc")).toBeDefined();
  });

  it("updates task executor inline", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Exec Edit" });
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Task")).toBeDefined();
    });

    const execSelect = screen.getByLabelText("Executor for task 1");
    await user.selectOptions(execSelect, "opencode");

    expect((execSelect as HTMLSelectElement).value).toBe("opencode");
  });

  it("handles keyboard navigation on workflow items", () => {
    const workflows = [makeRunEntry({ runId: "w1", title: "Keyboard Nav" })];
    const openWorkflow = vi.fn();
    render(<WorkflowManager workflows={workflows} />);

    const item = screen.getByRole("listitem", { name: /Workflow: Keyboard Nav/ });
    fireEvent.keyDown(item, { key: "Enter" });

    expect(screen.getByRole("region", { name: "Workflow detail" })).toBeDefined();
  });

  it("shows cancel button in create form", async () => {
    const user = userEvent.setup();
    render(<WorkflowManager />);

    await user.click(screen.getByRole("button", { name: "Create new workflow" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("region", { name: "Workflow list" })).toBeDefined();
  });

  it("stops propagation on action button clicks", async () => {
    const user = userEvent.setup();
    const workflows = [makeRunEntry({ runId: "w1", title: "Stop Prop" })];
    const openSpy = vi.fn();
    render(<WorkflowManager workflows={workflows} />);

    const deleteBtn = screen.getByRole("button", { name: /Delete workflow/ });
    await user.click(deleteBtn);

    expect(screen.getByText(/Confirm\?/)).toBeDefined();
  });

  it("shows workflow detail delete button for terminal workflows", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({
      runId: "w1",
      title: "Terminal",
      status: "succeeded",
    });
    onLoadWorkflow.mockResolvedValue(makeWorkflow([makeTask({ id: "t1" })]));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete this workflow" })).toBeDefined();
    });
  });

  it("shows delete confirmation dialog in detail view", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({
      runId: "w1",
      title: "Delete Detail",
      status: "succeeded",
    });
    onLoadWorkflow.mockResolvedValue(makeWorkflow([makeTask({ id: "t1" })]));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
        onDeleteWorkflow={onDeleteWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete this workflow" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Delete this workflow" }));

    expect(screen.getByRole("alertdialog", { name: "Confirm delete workflow" })).toBeDefined();
  });

  it("calls onDeleteWorkflow from detail view", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({
      runId: "w1",
      title: "Del Detail",
      status: "succeeded",
    });
    onLoadWorkflow.mockResolvedValue(makeWorkflow([makeTask({ id: "t1" })]));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
        onDeleteWorkflow={onDeleteWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete this workflow" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Delete this workflow" }));

    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(onDeleteWorkflow).toHaveBeenCalledWith("w1");
    });
  });

  it("cancels delete in detail view", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({
      runId: "w1",
      title: "Cancel Del",
      status: "succeeded",
    });
    onLoadWorkflow.mockResolvedValue(makeWorkflow([makeTask({ id: "t1" })]));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
        onDeleteWorkflow={onDeleteWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete this workflow" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Delete this workflow" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog", { name: "Confirm delete workflow" })).toBeNull();
  });

  it("updates task retries inline", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Retry Edit" });
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Task")).toBeDefined();
    });

    const retryInput = screen.getByLabelText(/Retries/) as HTMLInputElement;
    await user.clear(retryInput);
    await user.type(retryInput, "5");

    expect(parseInt(retryInput.value, 10)).toBe(5);
  });

  it("handles error when onCreateWorkflow succeeds but returns undefined", async () => {
    const user = userEvent.setup();
    onCreateWorkflow.mockResolvedValue(undefined);
    render(<WorkflowManager onCreateWorkflow={onCreateWorkflow} />);

    await user.click(screen.getByRole("button", { name: "Create new workflow" }));
    await user.type(screen.getByLabelText("Title *"), "No Return");
    await user.click(screen.getByRole("button", { name: "Create Workflow" }));

    await waitFor(() => {
      expect(onCreateWorkflow).toHaveBeenCalled();
    });
  });

  it("supports creating workflow with mode and goal", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Full Create" });
    onCreateWorkflow.mockResolvedValue(entry);
    render(<WorkflowManager onCreateWorkflow={onCreateWorkflow} />);

    await user.click(screen.getByRole("button", { name: "Create new workflow" }));
    await user.type(screen.getByLabelText("Title *"), "Full Create");

    const modeSelect = screen.getByLabelText("Mode");
    await user.selectOptions(modeSelect, "manual");

    const goalInput = screen.getByLabelText("Goal (optional)");
    await user.type(goalInput, "My custom goal");

    await user.click(screen.getByRole("button", { name: "Create Workflow" }));

    await waitFor(() => {
      expect(onCreateWorkflow).toHaveBeenCalledWith("Full Create", "manual", "My custom goal");
    });
  });

  it("disables create button while saving", async () => {
    const user = userEvent.setup();
    onCreateWorkflow.mockReturnValue(new Promise(() => {}));
    render(<WorkflowManager onCreateWorkflow={onCreateWorkflow} />);

    await user.click(screen.getByRole("button", { name: "Create new workflow" }));
    await user.type(screen.getByLabelText("Title *"), "Saving");
    await user.click(screen.getByRole("button", { name: "Create Workflow" }));

    expect(
      screen.getByRole("button", { name: "Creating..." }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("disables save button in detail while saving", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Saving Detail" });
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    onSaveWorkflow.mockReturnValue(new Promise(() => {}));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Task")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Save Workflow" }));

    expect(
      screen.getByRole("button", { name: "Saving..." }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("shows error when onSaveWorkflow fails", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Save Error" });
    const workflow = makeWorkflow([makeTask({ id: "t1", title: "Task" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    onSaveWorkflow.mockRejectedValue(new Error("Save failed"));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Task")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Save Workflow" }));

    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeDefined();
    });
  });

  it("shows error when onRunWorkflow fails", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Run Error" });
    const workflow = makeWorkflow([makeTask({ id: "t1" })]);
    onLoadWorkflow.mockResolvedValue(workflow);
    onRunWorkflow.mockRejectedValue(new Error("Run failed"));
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
        onRunWorkflow={onRunWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Run this workflow" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Run this workflow" }));

    await waitFor(() => {
      expect(screen.getByText("Run failed")).toBeDefined();
    });
  });

  it("shows error when onDuplicateWorkflow fails", async () => {
    const user = userEvent.setup();
    const entry = makeRunEntry({ runId: "w1", title: "Dup Error" });
    onDuplicateWorkflow.mockRejectedValue(new Error("Dup failed"));
    onLoadWorkflow.mockResolvedValue(makeWorkflow());
    render(
      <WorkflowManager
        workflows={[entry]}
        onLoadWorkflow={onLoadWorkflow}
        onSaveWorkflow={onSaveWorkflow}
        onDuplicateWorkflow={onDuplicateWorkflow}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open workflow/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Duplicate this workflow" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Duplicate this workflow" }));

    await waitFor(() => {
      expect(screen.getByText("Dup failed")).toBeDefined();
    });
  });
});
