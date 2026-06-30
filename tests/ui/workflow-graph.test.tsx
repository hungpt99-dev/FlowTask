// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkflowGraph, type TaskDisplayStatus } from "../../src/ui/components/WorkflowGraph.js";
import type { WorkflowTask } from "../../src/schemas/workflow.schema.js";

function makeTask(id: string, overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id,
    title: `Task ${id}`,
    executor: "shell",
    dependsOn: [],
    acceptanceCriteria: [],
    maxRetries: 2,
    ...overrides,
  };
}

describe("WorkflowGraph", () => {
  it("renders empty state when no tasks", () => {
    render(<WorkflowGraph tasks={[]} />);
    expect(screen.getByText("No tasks to display")).toBeDefined();
  });

  it("renders custom empty message", () => {
    render(<WorkflowGraph tasks={[]} emptyMessage="Graph is empty" />);
    expect(screen.getByText("Graph is empty")).toBeDefined();
  });

  it("renders workflow graph with tasks", () => {
    const tasks = [makeTask("t1", { title: "Setup" })];
    const { container } = render(<WorkflowGraph tasks={tasks} />);
    expect(screen.getByRole("tree", { name: "Workflow task graph" })).toBeDefined();
    expect(screen.getByText("Setup")).toBeDefined();
  });

  it("renders multiple tasks", () => {
    const tasks = [makeTask("t1", { title: "Setup" }), makeTask("t2", { title: "Build" })];
    render(<WorkflowGraph tasks={tasks} />);
    expect(screen.getByText("Setup")).toBeDefined();
    expect(screen.getByText("Build")).toBeDefined();
  });

  it("renders task nodes as treeitems", () => {
    const tasks = [makeTask("t1", { title: "Setup" })];
    render(<WorkflowGraph tasks={tasks} />);
    const node = screen.getByRole("treeitem", { name: /Task: Setup/ });
    expect(node).toBeDefined();
  });

  it("shows task status in aria-label", () => {
    const tasks = [makeTask("t1", { title: "Build" })];
    const statuses: Record<string, TaskDisplayStatus> = { t1: "running" };
    render(<WorkflowGraph tasks={tasks} taskStatuses={statuses} />);
    expect(screen.getByRole("treeitem", { name: "Task: Build (running)" })).toBeDefined();
  });

  it("shows default status as pending when no statuses provided", () => {
    const tasks = [makeTask("t1", { title: "Build" })];
    render(<WorkflowGraph tasks={tasks} />);
    expect(screen.getByRole("treeitem", { name: "Task: Build (pending)" })).toBeDefined();
  });

  it("shows status text inside node", () => {
    const tasks = [makeTask("t1", { title: "Test" })];
    const statuses: Record<string, TaskDisplayStatus> = { t1: "success" };
    render(<WorkflowGraph tasks={tasks} taskStatuses={statuses} />);
    expect(screen.getByText("success")).toBeDefined();
  });

  it("renders edges between dependent tasks", () => {
    const tasks = [
      makeTask("t1", { title: "Setup" }),
      makeTask("t2", { title: "Build", dependsOn: ["t1"] }),
    ];
    const { container } = render(<WorkflowGraph tasks={tasks} />);
    const paths = container.querySelectorAll("path");
    const edgePaths = Array.from(paths).filter((p) => p.getAttribute("fill") === "none");
    expect(edgePaths.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onTaskClick when a node is clicked", () => {
    const onClick = vi.fn();
    const tasks = [makeTask("t1", { title: "Setup" })];
    render(<WorkflowGraph tasks={tasks} onTaskClick={onClick} />);
    fireEvent.click(screen.getByRole("treeitem", { name: /Task: Setup/ }));
    expect(onClick).toHaveBeenCalledWith("t1");
  });

  it("calls onTaskDoubleClick when a node is double-clicked", () => {
    const onDoubleClick = vi.fn();
    const tasks = [makeTask("t1", { title: "Setup" })];
    render(<WorkflowGraph tasks={tasks} onTaskDoubleClick={onDoubleClick} />);
    fireEvent.doubleClick(screen.getByRole("treeitem", { name: /Task: Setup/ }));
    expect(onDoubleClick).toHaveBeenCalledWith("t1");
  });

  it("highlights selected task node", () => {
    const tasks = [makeTask("t1", { title: "Setup" })];
    render(<WorkflowGraph tasks={tasks} selectedTaskId="t1" />);
    const node = screen.getByRole("treeitem", { name: /Task: Setup/ });
    expect(node.getAttribute("aria-selected")).toBe("true");
  });

  it("does not highlight unselected node", () => {
    const tasks = [makeTask("t1", { title: "Setup" }), makeTask("t2", { title: "Build" })];
    render(<WorkflowGraph tasks={tasks} selectedTaskId="t1" />);
    const node = screen.getByRole("treeitem", { name: /Task: Build/ });
    expect(node.getAttribute("aria-selected")).toBe("false");
  });

  it("supports keyboard navigation with Enter key", () => {
    const onClick = vi.fn();
    const tasks = [makeTask("t1", { title: "Setup" })];
    render(<WorkflowGraph tasks={tasks} onTaskClick={onClick} />);
    fireEvent.keyDown(screen.getByRole("treeitem", { name: /Task: Setup/ }), {
      key: "Enter",
    });
    expect(onClick).toHaveBeenCalledWith("t1");
  });

  it("supports keyboard navigation with Space key", () => {
    const onClick = vi.fn();
    const tasks = [makeTask("t1", { title: "Setup" })];
    render(<WorkflowGraph tasks={tasks} onTaskClick={onClick} />);
    fireEvent.keyDown(screen.getByRole("treeitem", { name: /Task: Setup/ }), {
      key: " ",
    });
    expect(onClick).toHaveBeenCalledWith("t1");
  });

  it("renders all status colors correctly", () => {
    const statuses: TaskDisplayStatus[] = [
      "pending",
      "running",
      "waiting_input",
      "success",
      "failed",
      "skipped",
    ];
    const tasks = statuses.map((s, i) => makeTask(`t${i}`, { title: s }));
    const taskStatuses: Record<string, TaskDisplayStatus> = {};
    for (let i = 0; i < statuses.length; i++) {
      taskStatuses[`t${i}`] = statuses[i]!;
    }
    render(<WorkflowGraph tasks={tasks} taskStatuses={taskStatuses} />);
    for (const s of statuses) {
      const matches = screen.getAllByText(s);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("handles circular dependencies without infinite loop", () => {
    const tasks = [
      makeTask("t1", { title: "A", dependsOn: ["t3"] }),
      makeTask("t2", { title: "B", dependsOn: ["t1"] }),
      makeTask("t3", { title: "C", dependsOn: ["t2"] }),
    ];
    expect(() => render(<WorkflowGraph tasks={tasks} />)).not.toThrow();
  });

  it("handles self-referencing dependency gracefully", () => {
    const tasks = [makeTask("t1", { title: "A", dependsOn: ["t1"] })];
    expect(() => render(<WorkflowGraph tasks={tasks} />)).not.toThrow();
  });

  it("ignores dependencies on non-existent tasks", () => {
    const tasks = [
      makeTask("t1", { title: "Setup" }),
      makeTask("t2", { title: "Build", dependsOn: ["nonexistent"] }),
    ];
    const { container } = render(<WorkflowGraph tasks={tasks} />);
    const paths = container.querySelectorAll("path");
    const edgePaths = Array.from(paths).filter((p) => p.getAttribute("fill") === "none");
    expect(edgePaths.length).toBe(0);
  });

  it("renders region with correct aria label", () => {
    const tasks = [makeTask("t1")];
    render(<WorkflowGraph tasks={tasks} />);
    expect(screen.getByRole("region", { name: "Workflow graph" })).toBeDefined();
  });

  it("handles large number of tasks without crashing", () => {
    const tasks = Array.from({ length: 50 }, (_, i) =>
      makeTask(`t${i}`, {
        title: `Task ${i}`,
        dependsOn: i > 0 ? [`t${i - 1}`] : [],
      }),
    );
    expect(() => render(<WorkflowGraph tasks={tasks} />)).not.toThrow();
  });
});
