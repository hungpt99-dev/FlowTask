// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowEditor } from "../../src/ui/components/WorkflowEditor.js";
import type { WorkflowFile, WorkflowTask } from "../../src/schemas/workflow.schema.js";

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

describe("WorkflowEditor", () => {
  let onSave: ReturnType<typeof vi.fn>;
  let onLoad: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSave = vi.fn().mockResolvedValue(undefined);
    onLoad = vi.fn();
  });

  it("renders the workflow editor", () => {
    render(<WorkflowEditor workflow={makeWorkflow()} onSave={onSave} />);
    expect(screen.getByRole("region", { name: "Workflow editor" })).toBeDefined();
  });

  it("renders the workflow title", () => {
    render(<WorkflowEditor workflow={makeWorkflow()} onSave={onSave} />);
    expect(screen.getByLabelText("Workflow title")).toBeDefined();
  });

  it("shows empty state when no tasks exist", () => {
    render(<WorkflowEditor workflow={makeWorkflow()} onSave={onSave} />);
    expect(screen.getByText("No tasks yet. Add one to get started.")).toBeDefined();
  });

  it("renders task list from workflow prop", () => {
    const tasks = [makeTask({ id: "t1", title: "Task one" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);
    expect(screen.getByText("Task one")).toBeDefined();
    expect(screen.getByRole("listitem", { name: "Task: Task one" })).toBeDefined();
  });

  it("renders multiple tasks", () => {
    const tasks = [
      makeTask({ id: "t1", title: "First task" }),
      makeTask({ id: "t2", title: "Second task" }),
    ];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);
    expect(screen.getByText("First task")).toBeDefined();
    expect(screen.getByText("Second task")).toBeDefined();
  });

  it("shows executor badge when not shell", () => {
    const tasks = [makeTask({ id: "t1", title: "Task", executor: "opencode" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);
    expect(screen.getByText("Exec: opencode")).toBeDefined();
  });

  it("does not show executor badge for shell", () => {
    const tasks = [makeTask({ id: "t1", title: "Task", executor: "shell" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);
    expect(screen.queryByText(/Exec:/)).toBeNull();
  });

  it("shows dependencies on task card", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Setup" }),
      makeTask({ id: "t2", title: "Build", dependsOn: ["t1"] }),
    ];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);
    expect(screen.getByText(/Depends on: t1/)).toBeDefined();
  });

  it("adds a new task", async () => {
    const user = userEvent.setup();
    render(<WorkflowEditor workflow={makeWorkflow()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Task" }));

    const titleInput = screen.getByLabelText("Title *");
    await user.type(titleInput, "New task");

    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(screen.getByText("New task")).toBeDefined();
  });

  it("edits an existing task", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "t1", title: "Old title" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit Old title/ }));

    const titleInput = screen.getByLabelText("Title *");
    await user.clear(titleInput);
    await user.type(titleInput, "Updated title");

    await user.click(screen.getByRole("button", { name: "Update Task" }));

    expect(screen.queryByText("Old title")).toBeNull();
    expect(screen.getByText("Updated title")).toBeDefined();
  });

  it("deletes a task", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "t1", title: "Task to delete" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Delete Task to delete/ }));
    await user.click(screen.getByRole("button", { name: "Confirm Delete" }));

    expect(screen.queryByText("Task to delete")).toBeNull();
  });

  it("shows validation error for empty title when adding", async () => {
    const user = userEvent.setup();
    render(<WorkflowEditor workflow={makeWorkflow()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Task" }));
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(screen.getByText("Title is required")).toBeDefined();
  });

  it("shows validation error for duplicate task ID", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "t1", title: "Existing" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Task" }));

    const idInput = screen.getByLabelText("Task ID");
    await user.clear(idInput);
    await user.type(idInput, "t1");

    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(screen.getByText("Task ID already exists")).toBeDefined();
  });

  it("cancels task editing", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "t1", title: "Task" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit Task/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Task")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Update Task" })).toBeNull();
  });

  it("calls onSave with valid workflow data", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "t1", title: "Task" })];
    const saveFn = vi.fn().mockResolvedValue(undefined);
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={saveFn} />);

    await user.click(screen.getByRole("button", { name: "Save Workflow" }));

    await waitFor(() => {
      expect(saveFn).toHaveBeenCalledTimes(1);
    });
    const saved = saveFn.mock.calls[0]![0] as WorkflowFile;
    expect(saved.tasks.length).toBe(1);
    expect(saved.tasks[0]!.title).toBe("Task");
  });

  it("prevents save when no tasks exist", async () => {
    const user = userEvent.setup();
    render(<WorkflowEditor workflow={makeWorkflow()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Save Workflow" }));

    expect(screen.getByText("Workflow must have at least one task")).toBeDefined();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows loading state when loading", () => {
    const loadFn = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<WorkflowEditor onSave={onSave} onLoad={loadFn} />);
    expect(screen.getByText("Loading workflow...")).toBeDefined();
  });

  it("loads workflow from onLoad callback", async () => {
    const tasks = [makeTask({ id: "t1", title: "Loaded task" })];
    const loadFn = vi.fn().mockResolvedValue(makeWorkflow(tasks));
    render(<WorkflowEditor onSave={onSave} onLoad={loadFn} />);

    await waitFor(() => {
      expect(screen.getByText("Loaded task")).toBeDefined();
    });
  });

  it("shows error when onLoad fails", async () => {
    const loadFn = vi.fn().mockRejectedValue(new Error("Load failed"));
    render(<WorkflowEditor onSave={onSave} onLoad={loadFn} />);

    await waitFor(() => {
      expect(screen.getByText("Load failed")).toBeDefined();
    });
  });

  it("shows error when onSave fails", async () => {
    const user = userEvent.setup();
    const saveFn = vi.fn().mockRejectedValue(new Error("Save failed"));
    const tasks = [makeTask({ id: "t1", title: "Task" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={saveFn} />);

    await user.click(screen.getByRole("button", { name: "Save Workflow" }));

    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeDefined();
    });
  });

  it("disables save button while saving", async () => {
    const user = userEvent.setup();
    const saveFn = vi.fn().mockReturnValue(new Promise(() => {}));
    const tasks = [makeTask({ id: "t1", title: "Task" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={saveFn} />);

    await user.click(screen.getByRole("button", { name: "Save Workflow" }));

    expect(
      screen.getByRole("button", { name: "Saving..." }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("resets error state on dismiss", async () => {
    const user = userEvent.setup();
    const loadFn = vi.fn().mockRejectedValue(new Error("Test error"));
    render(<WorkflowEditor onSave={onSave} onLoad={loadFn} />);

    await waitFor(() => {
      expect(screen.getByText("Test error")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Test error")).toBeNull();
  });

  it("adds dependency from available tasks", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "t1", title: "Setup" }), makeTask({ id: "t2", title: "Build" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit Build/ }));
    const select = screen.getByLabelText("Add dependency");
    await user.selectOptions(select, "t1");

    expect(screen.getByRole("button", { name: /Remove dependency Setup/ })).toBeDefined();
  });

  it("removes a dependency", async () => {
    const user = userEvent.setup();
    const tasks = [
      makeTask({ id: "t1", title: "Setup" }),
      makeTask({ id: "t2", title: "Build", dependsOn: ["t1"] }),
    ];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit Build/ }));

    expect(screen.getByRole("button", { name: /Remove dependency Setup/ })).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Remove dependency Setup/ }));

    expect(screen.queryByRole("button", { name: /Remove dependency Setup/ })).toBeNull();
  });

  it("shows non-shell executor badge", () => {
    const tasks = [makeTask({ id: "t1", title: "AI task", executor: "claude" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);
    expect(screen.getByText("Exec: claude")).toBeDefined();
  });

  it("allows selecting a different executor", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "t1", title: "Task" })];
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Edit Task/ }));

    const select = screen.getByLabelText("Executor") as HTMLSelectElement;
    await user.selectOptions(select, "opencode");

    expect(select.value).toBe("opencode");
  });

  it("saves workflow with the updated executor", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "t1", title: "Task", executor: "shell" })];
    const saveFn = vi.fn().mockResolvedValue(undefined);
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={saveFn} />);

    await user.click(screen.getByRole("button", { name: /Edit Task/ }));
    const select = screen.getByLabelText("Executor") as HTMLSelectElement;
    await user.selectOptions(select, "claude");
    await user.click(screen.getByRole("button", { name: "Update Task" }));
    await user.click(screen.getByRole("button", { name: "Save Workflow" }));

    await waitFor(() => {
      expect(saveFn).toHaveBeenCalled();
    });
    const saved = saveFn.mock.calls[0]![0] as WorkflowFile;
    expect(saved.tasks[0]!.executor).toBe("claude");
  });

  it("resets the editor state via reset button", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "t1", title: "Task" })];
    const saveFn = vi.fn().mockRejectedValue(new Error("Oops"));
    render(<WorkflowEditor workflow={makeWorkflow(tasks)} onSave={saveFn} />);

    await user.click(screen.getByRole("button", { name: "Save Workflow" }));
    await waitFor(() => {
      expect(screen.getByText("Oops")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByText("Oops")).toBeNull();
  });
});
