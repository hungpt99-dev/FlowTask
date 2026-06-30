// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunMonitor } from "../../src/ui/components/RunMonitor.js";
import type { RunIndexEntry, Run, RunError } from "../../src/schemas/run.schema.js";
import type { Task } from "../../src/schemas/task.schema.js";
import type { Step, StepError } from "../../src/schemas/step.schema.js";
import type { FlowTaskEvent } from "../../src/schemas/event.schema.js";

// ── Helpers ──

function makeRun(overrides: Partial<Run> = {}): Run {
  const now = new Date().toISOString();
  return {
    runId: `run_${Date.now()}`,
    projectId: "test-project",
    title: "Test run",
    status: "created",
    mode: "auto",
    taskCount: 0,
    completedTaskCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRunIndex(overrides: Partial<RunIndexEntry> = {}): RunIndexEntry {
  const now = new Date().toISOString();
  return {
    runId: `run_${Date.now()}`,
    title: "Test run",
    status: "created",
    taskCount: 0,
    completedTaskCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  const base: Task = {
    id: `task_${Date.now()}`,
    runId: "run_1",
    title: "Test task",
    status: "pending" as Task["status"],
    executor: "shell",
    dependsOn: [],
    acceptanceCriteria: [],
    retryCount: 0,
    maxRetries: 2,
    createdAt: now,
    updatedAt: now,
  };
  return { ...base, ...overrides, dependsOn: overrides.dependsOn ?? base.dependsOn };
}

function makeStep(overrides: Partial<Step> = {}): Step {
  const now = new Date().toISOString();
  const base: Step = {
    id: `step_${Date.now()}`,
    taskId: "task_1",
    runId: "run_1",
    title: "Test step",
    type: "command",
    status: "pending" as Step["status"],
    order: 0,
    dependsOn: [],
    requiresApproval: false,
    createdAt: now,
    updatedAt: now,
  };
  return { ...base, ...overrides, dependsOn: overrides.dependsOn ?? base.dependsOn };
}

interface RunDetail {
  run: Run;
  tasks: Task[];
  steps: Record<string, Step[]>;
  events: FlowTaskEvent[];
}

function makeRunDetail(overrides: Partial<RunDetail> = {}): RunDetail {
  const run = makeRun({ runId: "run_1", title: "Detail run" });
  const task1 = makeTask({ id: "task_1", runId: "run_1", title: "Setup", status: "running" });
  const task2 = makeTask({ id: "task_2", runId: "run_1", title: "Build", status: "pending" });
  const step1 = makeStep({
    id: "step_1",
    taskId: "task_1",
    runId: "run_1",
    title: "Install deps",
    status: "running",
    order: 0,
  });
  const step2 = makeStep({
    id: "step_2",
    taskId: "task_1",
    runId: "run_1",
    title: "Configure",
    status: "pending",
    order: 1,
  });
  return {
    run,
    tasks: [task1, task2],
    steps: {
      task_1: [step1, step2],
      task_2: [],
    },
    events: [],
    ...overrides,
  };
}

// ── SSE mock ──

interface SseHandler {
  onopen: (() => void) | null;
  onmessage: ((msg: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
}

let sseHandlers: Map<string, SseHandler> = new Map();
let sseCloseCallbacks: (() => void)[] = [];

function createMockEventSource(url: string): SseHandler {
  const handler: SseHandler = { onopen: null, onmessage: null, onerror: null, close: vi.fn() };
  sseHandlers.set(url, handler);
  return handler;
}

beforeAll(() => {
  vi.stubGlobal(
    "EventSource",
    vi.fn((url: string) => createMockEventSource(url)),
  );
});

beforeEach(() => {
  sseHandlers.clear();
  sseCloseCallbacks = [];
});

function triggerSseOpen(url: string): void {
  const h = sseHandlers.get(url);
  h?.onopen?.();
}

function triggerSseMessage(url: string, data: unknown): void {
  const h = sseHandlers.get(url);
  h?.onmessage?.({ data: JSON.stringify(data) });
}

function triggerSseError(url: string): void {
  const h = sseHandlers.get(url);
  h?.onerror?.();
}

// ── Tests ──

describe("RunMonitor", () => {
  let onListRuns: ReturnType<typeof vi.fn>;
  let onLoadRun: ReturnType<typeof vi.fn>;
  let onLoadLogs: ReturnType<typeof vi.fn>;
  let onCancelRun: ReturnType<typeof vi.fn>;
  let onProvideInput: ReturnType<typeof vi.fn>;
  let onListArtifacts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onListRuns = vi.fn().mockResolvedValue([]);
    onLoadRun = vi.fn();
    onLoadLogs = vi.fn().mockResolvedValue("");
    onCancelRun = vi.fn().mockResolvedValue(undefined);
    onProvideInput = vi.fn().mockResolvedValue(undefined);
    onListArtifacts = vi.fn().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllTimers();
    sseHandlers.clear();
    sseCloseCallbacks = [];
  });

  it("renders the run monitor", async () => {
    render(<RunMonitor onListRuns={onListRuns} />);
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Run monitor" })).toBeDefined();
    });
  });

  it("shows empty state when no runs exist", async () => {
    render(<RunMonitor onListRuns={onListRuns} />);
    await waitFor(() => {
      expect(screen.getByText("No runs found")).toBeDefined();
    });
  });

  it("shows 'select a run' when no run selected", async () => {
    render(<RunMonitor onListRuns={onListRuns} />);
    await waitFor(() => {
      expect(screen.getByText("Select a run to view details")).toBeDefined();
    });
  });

  it("renders runs from initial prop", () => {
    const runs = [
      makeRunIndex({ runId: "r1", title: "First run", status: "running" }),
      makeRunIndex({ runId: "r2", title: "Second run", status: "succeeded" }),
    ];
    render(<RunMonitor runs={runs} />);
    expect(screen.getByText("First run")).toBeDefined();
    expect(screen.getByText("Second run")).toBeDefined();
    expect(screen.getByText("Running")).toBeDefined();
    expect(screen.getByText("Succeeded")).toBeDefined();
  });

  it("calls onListRuns on mount", async () => {
    render(<RunMonitor onListRuns={onListRuns} />);
    await waitFor(() => {
      expect(onListRuns).toHaveBeenCalledTimes(1);
    });
  });

  it("filters runs by search query", () => {
    const runs = [
      makeRunIndex({ runId: "r1", title: "Deploy app", status: "running" }),
      makeRunIndex({ runId: "r2", title: "Build docs", status: "succeeded" }),
    ];
    render(<RunMonitor runs={runs} />);

    const searchInput = screen.getByLabelText("Filter runs");
    fireEvent.change(searchInput, { target: { value: "deploy" } });

    expect(screen.getByText("Deploy app")).toBeDefined();
    expect(screen.queryByText("Build docs")).toBeNull();
  });

  it("shows no matching runs when filter has no results", () => {
    const runs = [makeRunIndex({ runId: "r1", title: "Test run", status: "running" })];
    render(<RunMonitor runs={runs} />);

    const searchInput = screen.getByLabelText("Filter runs");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    expect(screen.getByText("No matching runs")).toBeDefined();
  });

  it("selects a run and loads detail", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(<RunMonitor runs={runs} onListRuns={onListRuns} onLoadRun={onLoadRun} />);

    const runItem = screen.getByRole("listitem", { name: /Run: Detail run/ });
    await act(async () => {
      fireEvent.click(runItem);
    });

    await waitFor(() => {
      expect(onLoadRun).toHaveBeenCalledWith("run_1");
    });

    await waitFor(() => {
      expect(screen.getByText("Setup")).toBeDefined();
      expect(screen.getByText("Build")).toBeDefined();
    });
  });

  it("selects a task and loads logs", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);
    onLoadLogs.mockResolvedValue("line 1\nline 2\nerror: something failed\nline 4");

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onLoadLogs={onLoadLogs}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Setup")).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Task: Setup/ }));
    });

    await waitFor(() => {
      expect(onLoadLogs).toHaveBeenCalledWith("run_1", "task_1");
    });

    await waitFor(() => {
      expect(screen.getByText(/line 1/)).toBeDefined();
    });
  });

  it("shows waiting_input section when a step is waiting for input", async () => {
    const waitingStep = makeStep({
      id: "step_input",
      taskId: "task_1",
      title: "User prompt",
      status: "waiting_input",
      description: "Please enter the API endpoint",
      order: 0,
    });

    const detail = makeRunDetail({
      tasks: [makeTask({ id: "task_1", runId: "run_1", title: "Setup", status: "waiting_input" })],
      steps: {
        task_1: [waitingStep],
      },
    });

    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "waiting_input" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onProvideInput={onProvideInput}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Input Required")).toBeDefined();
      expect(screen.getByText(/Please enter the API endpoint/)).toBeDefined();
    });
  });

  it("sends input when user types and clicks Send", async () => {
    const user = userEvent.setup();
    const waitingStep = makeStep({
      id: "step_input",
      taskId: "task_1",
      title: "User prompt",
      status: "waiting_input",
      order: 0,
    });

    const detail = makeRunDetail({
      tasks: [makeTask({ id: "task_1", runId: "run_1", title: "Setup", status: "waiting_input" })],
      steps: {
        task_1: [waitingStep],
      },
      run: makeRun({ runId: "run_1", title: "Detail run", status: "waiting_input" }),
    });

    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "waiting_input" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onProvideInput={onProvideInput}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Input Required")).toBeDefined();
    });

    const textarea = screen.getByLabelText("Input response");
    await user.type(textarea, "my response");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(onProvideInput).toHaveBeenCalledWith("run_1", "task_1", "step_input", "my response");
    });
  });

  it("shows auto-scroll checkbox and toggles it", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);
    onLoadLogs.mockResolvedValue("test log line");

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onLoadLogs={onLoadLogs}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => expect(screen.getByText("Setup")).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Task: Setup/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Auto-scroll")).toBeDefined();
    });

    const checkbox = screen.getByLabelText("Auto-scroll") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await act(async () => {
      fireEvent.click(checkbox);
    });

    expect(checkbox.checked).toBe(false);
  });

  it("shows cancel button for active runs", async () => {
    const detail = makeRunDetail({
      run: makeRun({ runId: "run_1", title: "Detail run", status: "running" }),
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onCancelRun={onCancelRun}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel Run" })).toBeDefined();
    });
  });

  it("calls onCancelRun when cancel button clicked", async () => {
    const detail = makeRunDetail({
      run: makeRun({ runId: "run_1", title: "Detail run", status: "running" }),
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onCancelRun={onCancelRun}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel Run" })).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel Run" }));
    });

    await waitFor(() => {
      expect(onCancelRun).toHaveBeenCalledWith("run_1");
    });
  });

  it("does not show cancel button for terminal runs", async () => {
    const detail = makeRunDetail({
      run: makeRun({ runId: "run_1", title: "Detail run", status: "succeeded" }),
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "succeeded" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onCancelRun={onCancelRun}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Setup")).toBeDefined();
    });

    expect(screen.queryByRole("button", { name: "Cancel Run" })).toBeNull();
  });

  it("displays run errors", async () => {
    const runError: RunError = {
      message: "Connection timeout",
      timestamp: new Date().toISOString(),
    };
    const detail = makeRunDetail({
      run: makeRun({ runId: "run_1", title: "Detail run", status: "failed", errors: [runError] }),
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "failed" })];
    render(<RunMonitor runs={runs} onListRuns={onListRuns} onLoadRun={onLoadRun} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Connection timeout")).toBeDefined();
    });
  });

  it("displays step errors", async () => {
    const stepError: StepError = {
      message: "Command not found",
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };
    const erroredStep = makeStep({
      id: "step_err",
      taskId: "task_1",
      title: "Run script",
      status: "failed",
      errors: [stepError],
      order: 0,
    });
    const detail = makeRunDetail({
      tasks: [makeTask({ id: "task_1", runId: "run_1", title: "Setup", status: "failed" })],
      steps: { task_1: [erroredStep] },
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "failed" })];
    render(<RunMonitor runs={runs} onListRuns={onListRuns} onLoadRun={onLoadRun} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Command not found")).toBeDefined();
    });
  });

  it("shows step details when a step is selected", async () => {
    const step = makeStep({
      id: "step_1",
      taskId: "task_1",
      title: "Install deps",
      status: "running",
      command: "npm install",
      exitCode: 0,
      order: 0,
    });
    const detail = makeRunDetail({
      tasks: [makeTask({ id: "task_1", runId: "run_1", title: "Setup", status: "running" })],
      steps: { task_1: [step] },
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(<RunMonitor runs={runs} onListRuns={onListRuns} onLoadRun={onLoadRun} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => expect(screen.getByText("Setup")).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Task: Setup/ }));
    });

    await waitFor(() => expect(screen.getByText("Install deps")).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Step: Install deps/ }));
    });

    await waitFor(() => expect(screen.getByText("npm install")).toBeDefined());

    await waitFor(() => {
      expect(screen.getByText(/Exit code:/)).toBeDefined();
    });
  });

  it("shows task progress in run header", async () => {
    const detail = makeRunDetail({
      tasks: [
        makeTask({ id: "t1", runId: "run_1", title: "Done task", status: "done" }),
        makeTask({ id: "t2", runId: "run_1", title: "Running task", status: "running" }),
        makeTask({ id: "t3", runId: "run_1", title: "Failed task", status: "failed" }),
        makeTask({ id: "t4", runId: "run_1", title: "Pending task", status: "pending" }),
      ],
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [
      makeRunIndex({
        runId: "run_1",
        title: "Detail run",
        status: "running",
        taskCount: 4,
        completedTaskCount: 2,
      }),
    ];
    render(<RunMonitor runs={runs} onListRuns={onListRuns} onLoadRun={onLoadRun} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/2\/4 tasks/)).toBeDefined();
    });
  });

  it("displays runtime duration", async () => {
    const detail = makeRunDetail({
      run: makeRun({
        runId: "run_1",
        title: "Detail run",
        status: "succeeded",
        durationMs: 125000,
      }),
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "succeeded" })];
    render(<RunMonitor runs={runs} onListRuns={onListRuns} onLoadRun={onLoadRun} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText(/2m 5s/)).toBeDefined();
    });
  });

  it("handles error from cancel run", async () => {
    onCancelRun.mockRejectedValue(new Error("Something went wrong"));

    const detail = makeRunDetail({
      run: makeRun({ runId: "run_1", title: "Detail run", status: "running" }),
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onCancelRun={onCancelRun}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel Run" })).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel Run" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeDefined();
    });
  });

  it("dismisses error message", async () => {
    onCancelRun.mockRejectedValue(new Error("Something went wrong"));

    const detail = makeRunDetail({
      run: makeRun({ runId: "run_1", title: "Detail run", status: "running" }),
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onCancelRun={onCancelRun}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel Run" })).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel Run" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Something went wrong")).toBeNull();
    });
  });

  it("shows success message after cancelling a run", async () => {
    const detail = makeRunDetail({
      run: makeRun({ runId: "run_1", title: "Detail run", status: "running" }),
    });
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onCancelRun={onCancelRun}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel Run" })).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel Run" }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Run cancelled/)).toBeDefined();
    });
  });

  it("selects and deselects a run when clicked twice", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);
    onListRuns.mockResolvedValue([
      makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" }),
    ]);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(<RunMonitor runs={runs} onListRuns={onListRuns} onLoadRun={onLoadRun} />);

    await waitFor(() => {
      expect(screen.getByRole("listitem", { name: /Run: Detail run/ })).toBeDefined();
    });

    const runItem = screen.getByRole("listitem", { name: /Run: Detail run/ });

    await act(async () => {
      fireEvent.click(runItem);
    });

    await waitFor(() => {
      expect(onLoadRun).toHaveBeenCalledWith("run_1");
    });

    await act(async () => {
      fireEvent.click(runItem);
    });

    await waitFor(() => {
      expect(screen.getByText("Select a run to view details")).toBeDefined();
    });
  });

  // ── SSE / Real-time tests ──

  it("shows connection status badge when sseUrl is provided", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        sseUrl="http://localhost:3487/api"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Connecting...")).toBeDefined();
    });
  });

  it("updates connection status to Live when SSE connects", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        sseUrl="http://localhost:3487/api"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Connecting...")).toBeDefined();
    });

    const sseUrl = "http://localhost:3487/api/runs/run_1/events";
    const handler = sseHandlers.get(sseUrl);
    expect(handler).toBeDefined();

    await act(async () => {
      triggerSseOpen(sseUrl);
    });

    await waitFor(() => {
      expect(screen.getByText("Live")).toBeDefined();
    });
  });

  it("receives live events via SSE and displays them in timeline view", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        sseUrl="http://localhost:3487/api"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    const sseUrl = "http://localhost:3487/api/runs/run_1/events";

    await act(async () => {
      triggerSseOpen(sseUrl);
    });

    await act(async () => {
      triggerSseMessage(sseUrl, {
        time: new Date().toISOString(),
        type: "task_started",
        runId: "run_1",
        taskId: "task_1",
        message: "Building project",
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("timeline"));
    });

    await waitFor(() => {
      expect(screen.getAllByText("task_started").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getByText("Building project")).toBeDefined();
    });
  });

  it("shows event count in timeline tab", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        sseUrl="http://localhost:3487/api"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    const sseUrl = "http://localhost:3487/api/runs/run_1/events";

    await act(async () => {
      triggerSseOpen(sseUrl);
      triggerSseMessage(sseUrl, {
        time: new Date().toISOString(),
        type: "task_started",
        runId: "run_1",
      });
      triggerSseMessage(sseUrl, {
        time: new Date().toISOString(),
        type: "task_completed",
        runId: "run_1",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("(2)")).toBeDefined();
    });
  });

  it("filters events by type in timeline", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        sseUrl="http://localhost:3487/api"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    const sseUrl = "http://localhost:3487/api/runs/run_1/events";

    await act(async () => {
      triggerSseOpen(sseUrl);
      triggerSseMessage(sseUrl, {
        time: new Date().toISOString(),
        type: "task_started",
        runId: "run_1",
      });
      triggerSseMessage(sseUrl, {
        time: new Date().toISOString(),
        type: "task_completed",
        runId: "run_1",
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("timeline"));
    });

    await waitFor(() => {
      expect(screen.getAllByText("task_started").length).toBeGreaterThan(0);
    });

    await act(async () => {
      const select = screen.getByLabelText("Filter events by type");
      fireEvent.change(select, { target: { value: "task_completed" } });
    });

    await waitFor(() => {
      const timelineLog = screen.getByRole("log", { name: "Live events" });
      expect(timelineLog.textContent).not.toContain("task_started");
    });
  });

  it("shows view tabs and switches between them", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onListArtifacts={onListArtifacts}
        sseUrl="http://localhost:3487/api"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "tasks" })).toBeDefined();
      expect(screen.getByRole("button", { name: "timeline" })).toBeDefined();
      expect(screen.getByRole("button", { name: "artifacts" })).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("artifacts"));
    });

    await waitFor(() => {
      expect(screen.getByText(/Artifacts/)).toBeDefined();
    });
  });

  it("shows empty artifact state", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);
    onListArtifacts.mockResolvedValue([]);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onListArtifacts={onListArtifacts}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("artifacts"));
    });

    await waitFor(() => {
      expect(screen.getByText("No artifacts for this run")).toBeDefined();
    });
  });

  it("displays artifacts when present", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);
    onListArtifacts.mockResolvedValue([
      {
        artifactId: "art_1",
        runId: "run_1",
        taskId: "task_1",
        type: "text",
        title: "Build output",
        path: "/tmp/output.log",
        createdAt: new Date().toISOString(),
      },
    ]);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        onListArtifacts={onListArtifacts}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("artifacts"));
    });

    await waitFor(() => {
      expect(screen.getByText("Build output")).toBeDefined();
    });
  });

  it("shows Reconnecting... on SSE error", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        sseUrl="http://localhost:3487/api"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    const sseUrl = "http://localhost:3487/api/runs/run_1/events";

    await act(async () => {
      triggerSseOpen(sseUrl);
    });

    await act(async () => {
      triggerSseError(sseUrl);
    });

    await waitFor(() => {
      expect(screen.getByText("Reconnecting...")).toBeDefined();
    });
  });

  it("handles run_completed SSE event by updating status", async () => {
    const detail = makeRunDetail();
    onLoadRun.mockResolvedValue(detail);

    const runs = [makeRunIndex({ runId: "run_1", title: "Detail run", status: "running" })];
    render(
      <RunMonitor
        runs={runs}
        onListRuns={onListRuns}
        onLoadRun={onLoadRun}
        sseUrl="http://localhost:3487/api"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem", { name: /Run: Detail run/ }));
    });

    await waitFor(() => {
      expect(screen.getByText("Running")).toBeDefined();
    });

    const sseUrl = "http://localhost:3487/api/runs/run_1/events";

    await act(async () => {
      triggerSseOpen(sseUrl);
      triggerSseMessage(sseUrl, {
        time: new Date().toISOString(),
        type: "run_completed",
        runId: "run_1",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Succeeded")).toBeDefined();
    });
  });
});
