import { describe, it, expect, beforeAll } from "vitest";
import { StateManager } from "../../src/core/state-manager.js";
import { testDir } from "../setup.js";

describe("StateManager", () => {
  let manager: StateManager;

  beforeAll(() => {
    manager = new StateManager(testDir);
  });

  it("should create an instance", () => {
    expect(manager).toBeInstanceOf(StateManager);
  });

  it("should return null when loading non-existent project state", async () => {
    const state = await manager.loadProjectState();
    expect(state).toBeNull();
  });

  it("should return null when loading non-existent run state", async () => {
    const state = await manager.loadRunState("non-existent-run");
    expect(state).toBeNull();
  });

  it("should save and load project state", async () => {
    await manager.saveProjectState({
      projectId: "test-project",
      status: "idle",
      updatedAt: new Date().toISOString(),
    });
    const loaded = await manager.loadProjectState();
    expect(loaded).not.toBeNull();
    expect(loaded!.projectId).toBe("test-project");
    expect(loaded!.status).toBe("idle");
  });

  it("should save and load run state", async () => {
    const runId = "test-run-001";
    const runState = {
      runId,
      status: "running" as const,
      progress: { total: 5, done: 2, running: 1, failed: 0, pending: 2 },
      updatedAt: new Date().toISOString(),
    };
    await manager.saveRunState(runId, runState);
    const loaded = await manager.loadRunState(runId);
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe(runId);
    expect(loaded!.progress.total).toBe(5);
  });

  it("should update project state with atomic writes", async () => {
    await manager.saveProjectState({
      projectId: "atomic-test",
      status: "has_running_run",
      activeRunId: "run-001",
      updatedAt: new Date().toISOString(),
    });
    const loaded = await manager.loadProjectState();
    expect(loaded!.status).toBe("has_running_run");
    expect(loaded!.activeRunId).toBe("run-001");
  });
});
