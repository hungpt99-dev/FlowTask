import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { ProjectManager } from "../../src/core/project-manager.js";
import { RunLifecycle } from "../../src/core/run-lifecycle.js";
import { RunManager } from "../../src/core/run-manager.js";
import { testDir } from "../setup.js";
import { join } from "node:path";
import { generateDefaultConfig } from "../../src/config/default-config.js";

vi.mock("enquirer", () => ({
  default: vi.fn(),
}));

describe("RunLifecycle", () => {
  let projectDir: string;
  let projectId: string;

  beforeAll(async () => {
    projectDir = join(testDir, "lifecycle-test");
    const manager = new ProjectManager();
    const project = await manager.init(projectDir, "Lifecycle Test");
    projectId = project.projectId;
  });

  it("should execute a plan-only run", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.executeRun("Generate README file", { mode: "plan-only" });
    expect(result.run).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.run.status).toBe("planning");
  });

  it("should execute a dry-run", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.executeRun("Create a test file", { mode: "dry-run" });
    expect(result.success).toBe(true);
  });

  it("should create run files during plan-only", async () => {
    const config = await new ProjectManager().loadConfig(projectDir);
    const lifecycle = new RunLifecycle(projectDir, projectId, config);
    const result = await lifecycle.executeRun("Document the API", { mode: "plan-only" });
    const runManager = new RunManager(projectDir);
    const run = await runManager.loadRun(result.run.runId);
    expect(run).toBeDefined();

    const { fileExists } = await import("../../src/utils/fs.js");
    const { promptMdPath, planMdPath } = await import("../../src/utils/paths.js");
    expect(await fileExists(promptMdPath(projectDir, result.run.runId))).toBe(true);
    expect(await fileExists(planMdPath(projectDir, result.run.runId))).toBe(true);
  });

  describe("approval config propagation", () => {
    it("should accept auto approval mode option", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Auto approval test", {
        mode: "plan-only",
        approvalMode: "auto",
      });
      expect(result.success).toBe(true);
    });

    it("should accept skip approval mode option", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Skip approval test", {
        mode: "plan-only",
        approvalMode: "skip",
      });
      expect(result.success).toBe(true);
    });

    it("should accept manual approval mode option", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Manual approval test", {
        mode: "plan-only",
        approvalMode: "manual",
      });
      expect(result.success).toBe(true);
    });

    it("should work with autoApprove enabled in default config", async () => {
      const config = generateDefaultConfig();
      config.approval = { enabled: true, autoApprove: true, requireFor: [] };
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Auto approve config test", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });

    it("should work with approval disabled in default config", async () => {
      const config = generateDefaultConfig();
      config.approval = { enabled: false, autoApprove: false, requireFor: [] };
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Disabled approval config test", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("skip validation", () => {
    it("should accept --skip-validation flag in plan-only mode", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Skip validation test", {
        mode: "plan-only",
        skipValidation: true,
      });
      expect(result.success).toBe(true);
      expect(result.run.status).toBe("planning");
    });

    it("should default to validation enabled when not specified", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Default validation test", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });

    it("should work with dry-run and skipValidation", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Dry run skip validation", {
        mode: "dry-run",
        skipValidation: true,
      });
      expect(result.success).toBe(true);
    });

    it("should accept skipValidation via constructor option", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config, undefined, {
        skipValidation: true,
      });
      const result = await lifecycle.executeRun("Constructor skip validation", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });

    it("should accept skipValidation via config", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      config.validation!.skipValidation = true;
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      const result = await lifecycle.executeRun("Config skip validation", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });

    it("should be overridable via setSkipValidation", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      lifecycle.setSkipValidation(true);
      const result = await lifecycle.executeRun("SetSkipValidation test", {
        mode: "plan-only",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("inline interactive input handling", () => {
    let EnquirerMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.resetAllMocks();
      const { default: Enquirer } = await import("enquirer");
      EnquirerMock = Enquirer as unknown as ReturnType<typeof vi.fn>;
    });

    function setupTTY() {
      const original = process.stdin.isTTY;
      process.stdin.isTTY = true as unknown as boolean;
      return original;
    }

    function restoreTTY(original: boolean | undefined) {
      process.stdin.isTTY = original as unknown as boolean;
    }

    function createMockEnquirer(response: string) {
      const mockInstance = {
        prompt: vi.fn().mockResolvedValue({ response }),
      };
      EnquirerMock.mockReturnValue(mockInstance);
      return mockInstance;
    }

    it("should inline-prompt for waiting_input in TTY mode, collect input, and auto-continue", async () => {
      const orig = setupTTY();
      try {
        const mockInstance = createMockEnquirer("inline-answer");
        const config = await new ProjectManager().loadConfig(projectDir);
        config.defaultExecutor = "shell";
        config.validation = { ...config.validation, skipValidation: true };
        config.approval = { enabled: true, autoApprove: true, requireFor: [] };
        const lifecycle = new RunLifecycle(projectDir, projectId, config);
        lifecycle.setSkipValidation(true);
        const result = await lifecycle.executeRun("Test input", { mode: "plan-only" });

        const runManager = new RunManager(projectDir);
        const tasks = await runManager.loadTasks(result.run.runId);
        await runManager.updateTaskStatus(result.run.runId, tasks[0]!.id, "waiting_input");

        const cont = await lifecycle.continueRun(result.run.runId);

        expect(mockInstance.prompt).toHaveBeenCalledTimes(1);
        expect(cont.success).toBe(true);
        expect(cont.paused).toBe(false);

        const updated = await runManager.loadTasks(result.run.runId);
        const first = updated.find((t) => t.id === tasks[0]!.id);
        expect(first?.status).toBe("done");
      } finally {
        restoreTTY(orig);
      }
    }, 15000);

    it("should fall back to external input in non-TTY mode", async () => {
      const orig = process.stdin.isTTY;
      process.stdin.isTTY = false as unknown as boolean;
      try {
        const config = await new ProjectManager().loadConfig(projectDir);
        config.defaultExecutor = "shell";
        config.validation = { ...config.validation, skipValidation: true };
        config.approval = { enabled: true, autoApprove: true, requireFor: [] };
        const lifecycle = new RunLifecycle(projectDir, projectId, config);
        lifecycle.setSkipValidation(true);
        const result = await lifecycle.executeRun("Test input", { mode: "plan-only" });

        const runManager = new RunManager(projectDir);
        const tasks = await runManager.loadTasks(result.run.runId);
        await runManager.updateTaskStatus(result.run.runId, tasks[0]!.id, "waiting_input");

        const cont = await lifecycle.continueRun(result.run.runId);

        expect(cont.paused).toBe(true);
        expect(cont.success).toBe(true);

        const updated = await runManager.loadTasks(result.run.runId);
        const first = updated.find((t) => t.id === tasks[0]!.id);
        expect(first?.status).toBe("waiting_input");
      } finally {
        process.stdin.isTTY = orig;
      }
    });

    it("should handle repeated waiting_input prompts across multiple tasks", async () => {
      const orig = setupTTY();
      try {
        const mockInstance = createMockEnquirer("go");
        const config = await new ProjectManager().loadConfig(projectDir);
        config.defaultExecutor = "shell";
        config.validation = { ...config.validation, skipValidation: true };
        config.approval = { enabled: true, autoApprove: true, requireFor: [] };
        const lifecycle = new RunLifecycle(projectDir, projectId, config);
        lifecycle.setSkipValidation(true);
        const result = await lifecycle.executeRun("Test multi-step", { mode: "plan-only" });

        const runManager = new RunManager(projectDir);
        const tasks = await runManager.loadTasks(result.run.runId);
        expect(tasks.length).toBeGreaterThan(1);

        for (const t of tasks) {
          await runManager.updateTaskStatus(result.run.runId, t.id, "waiting_input");
        }

        const cont = await lifecycle.continueRun(result.run.runId);

        expect(mockInstance.prompt).toHaveBeenCalled();
        expect(cont.success).toBe(true);
        expect(cont.paused).toBe(false);

        const updated = await runManager.loadTasks(result.run.runId);
        for (const t of updated) {
          expect(t.status).toBe("done");
        }
      } finally {
        restoreTTY(orig);
      }
    }, 30000);
  });

  describe("auto-continue behavior", () => {
    let EnquirerMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.resetAllMocks();
      const { default: Enquirer } = await import("enquirer");
      EnquirerMock = Enquirer as unknown as ReturnType<typeof vi.fn>;
    });

    function setupTTY() {
      const original = process.stdin.isTTY;
      process.stdin.isTTY = true as unknown as boolean;
      return original;
    }

    function restoreTTY(original: boolean | undefined) {
      process.stdin.isTTY = original as unknown as boolean;
    }

    it("should auto-continue to next pending step after previous step completes", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      config.defaultExecutor = "shell";
      config.validation = { ...config.validation, skipValidation: true };
      config.approval = { enabled: true, autoApprove: true, requireFor: [] };
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      lifecycle.setSkipValidation(true);
      const result = await lifecycle.executeRun("Test auto-continue", { mode: "plan-only" });

      const runManager = new RunManager(projectDir);
      const tasks = await runManager.loadTasks(result.run.runId);
      expect(tasks.length).toBeGreaterThan(1);

      await runManager.updateTaskStatus(result.run.runId, tasks[0]!.id, "done");

      const cont = await lifecycle.continueRun(result.run.runId);

      expect(cont.success).toBe(true);
      expect(cont.paused).toBe(false);

      const updated = await runManager.loadTasks(result.run.runId);
      const second = updated.find((t) => t.id === tasks[1]!.id);
      expect(second?.status).toBe("done");
    }, 15000);

    it("should skip all completed steps and auto-continue to next pending", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      config.defaultExecutor = "shell";
      config.validation = { ...config.validation, skipValidation: true };
      config.approval = { enabled: true, autoApprove: true, requireFor: [] };
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      lifecycle.setSkipValidation(true);
      const result = await lifecycle.executeRun("Test skip completed", { mode: "plan-only" });

      const runManager = new RunManager(projectDir);
      const tasks = await runManager.loadTasks(result.run.runId);
      expect(tasks.length).toBeGreaterThan(2);

      await runManager.updateTaskStatus(result.run.runId, tasks[0]!.id, "done");
      await runManager.updateTaskStatus(result.run.runId, tasks[1]!.id, "done");

      const cont = await lifecycle.continueRun(result.run.runId);

      expect(cont.success).toBe(true);
      expect(cont.paused).toBe(false);

      const updated = await runManager.loadTasks(result.run.runId);
      const third = updated.find((t) => t.id === tasks[2]!.id);
      expect(third?.status).toBe("done");
    }, 15000);

    it("should auto-continue pending steps without requiring user input", async () => {
      const config = await new ProjectManager().loadConfig(projectDir);
      config.defaultExecutor = "shell";
      config.validation = { ...config.validation, skipValidation: true };
      config.approval = { enabled: true, autoApprove: true, requireFor: [] };
      const lifecycle = new RunLifecycle(projectDir, projectId, config);
      lifecycle.setSkipValidation(true);
      const result = await lifecycle.executeRun("Test no input prompt", { mode: "plan-only" });

      const cont = await lifecycle.continueRun(result.run.runId);

      expect(cont.success).toBe(true);
      expect(cont.paused).toBe(false);
      expect(EnquirerMock).not.toHaveBeenCalled();

      const runManager = new RunManager(projectDir);
      const updated = await runManager.loadTasks(result.run.runId);
      const doneCount = updated.filter((t) => t.status === "done").length;
      expect(doneCount).toBe(updated.length);
    }, 15000);

    it("should handle mixed states: done, waiting_input, and pending steps", async () => {
      const orig = setupTTY();
      try {
        const mockInstance = {
          prompt: vi.fn().mockResolvedValue({ response: "user-input" }),
        };
        EnquirerMock.mockReturnValue(mockInstance);

        const config = await new ProjectManager().loadConfig(projectDir);
        config.defaultExecutor = "shell";
        config.validation = { ...config.validation, skipValidation: true };
        config.approval = { enabled: true, autoApprove: true, requireFor: [] };
        const lifecycle = new RunLifecycle(projectDir, projectId, config);
        lifecycle.setSkipValidation(true);
        const result = await lifecycle.executeRun("Test mixed states", { mode: "plan-only" });

        const runManager = new RunManager(projectDir);
        const tasks = await runManager.loadTasks(result.run.runId);
        expect(tasks.length).toBeGreaterThan(2);

        await runManager.updateTaskStatus(result.run.runId, tasks[0]!.id, "done");
        await runManager.updateTaskStatus(result.run.runId, tasks[1]!.id, "waiting_input");

        const cont = await lifecycle.continueRun(result.run.runId);

        expect(mockInstance.prompt).toHaveBeenCalledTimes(1);
        expect(cont.success).toBe(true);
        expect(cont.paused).toBe(false);

        const updated = await runManager.loadTasks(result.run.runId);
        const first = updated.find((t) => t.id === tasks[0]!.id);
        const second = updated.find((t) => t.id === tasks[1]!.id);
        const third = updated.find((t) => t.id === tasks[2]!.id);
        expect(first?.status).toBe("done");
        expect(second?.status).toBe("done");
        expect(third?.status).toBe("done");
      } finally {
        restoreTTY(orig);
      }
    }, 30000);
  });
});
