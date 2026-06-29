import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HookManager } from "../../src/core/hook-manager.js";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

describe("HookManager", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "flowtask-hooks-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should execute beforeRun hooks", async () => {
    const markerPath = join(testDir, "before-run-marker");
    const config = {
      beforeRun: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeRun({ runId: "test-run" });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute afterRun hooks", async () => {
    const markerPath = join(testDir, "after-run-marker");
    const config = {
      afterRun: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runAfterRun({ runId: "test-run", success: true });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute beforeTask hooks", async () => {
    const markerPath = join(testDir, "before-task-marker");
    const config = {
      beforeTask: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeTask({ runId: "test-run", taskId: "task-1", taskTitle: "Test Task" });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute afterTask hooks", async () => {
    const markerPath = join(testDir, "after-task-marker");
    const config = {
      afterTask: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runAfterTask({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
      success: true,
    });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute beforeRetry hooks", async () => {
    const markerPath = join(testDir, "before-retry-marker");
    const config = {
      beforeRetry: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeRetry({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
      retryCount: 1,
      maxRetries: 3,
    });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute afterRetry hooks", async () => {
    const markerPath = join(testDir, "after-retry-marker");
    const config = {
      afterRetry: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runAfterRetry({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
      retryCount: 1,
      maxRetries: 3,
      success: true,
    });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should execute onFailure hooks", async () => {
    const markerPath = join(testDir, "failure-marker");
    const config = {
      onFailure: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runOnFailure({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
      error: "Something failed",
    });
    expect(existsSync(markerPath)).toBe(true);
  });

  it("should log hook execution results", async () => {
    const markerPath = join(testDir, "log-marker");
    const config = {
      beforeTask: [`touch ${markerPath}`],
    };
    const manager = new HookManager(testDir, config);
    const results = await manager.runBeforeTask({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.entry).toBe(`touch ${markerPath}`);
  });

  it("should report failed hooks without throwing when failOnError is false", async () => {
    const config = {
      beforeTask: ["exit 1"],
      failOnError: false,
    };
    const manager = new HookManager(testDir, config);
    const results = await manager.runBeforeTask({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
  });

  it("should throw on hook failure when failOnError is true", async () => {
    const config = {
      beforeTask: ["exit 1"],
      failOnError: true,
    };
    const manager = new HookManager(testDir, config);
    await expect(
      manager.runBeforeTask({ runId: "test-run", taskId: "task-1", taskTitle: "Test Task" }),
    ).rejects.toThrow();
  });

  it("should execute multiple hooks in order", async () => {
    const orderPath = join(testDir, "order.txt");
    const config = {
      beforeRun: [`echo "first" >> ${orderPath}`, `echo "second" >> ${orderPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeRun({ runId: "test-run" });
    const content = readFileSync(orderPath, "utf-8").trim().split("\n");
    expect(content).toEqual(["first", "second"]);
  });

  it("should pass hook context via environment variables", async () => {
    const envPath = join(testDir, "env.txt");
    const config = {
      beforeTask: [`echo "$HOOK_RUN_ID|$HOOK_TASK_ID|$HOOK_TASK_TITLE" > ${envPath}`],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeTask({
      runId: "test-run-123",
      taskId: "task-abc",
      taskTitle: "My Task",
    });
    const content = readFileSync(envPath, "utf-8").trim();
    expect(content).toBe("test-run-123|task-abc|My Task");
  });

  it("should not execute hooks when config is empty", async () => {
    const manager = new HookManager(testDir, {});
    const results = await manager.runBeforeTask({
      runId: "test-run",
      taskId: "task-1",
      taskTitle: "Test Task",
    });
    expect(results).toEqual([]);
  });

  it("should not execute hooks when config is undefined", async () => {
    const manager = new HookManager(testDir);
    const results = await manager.runBeforeRun({ runId: "test-run" });
    expect(results).toEqual([]);
  });

  // ── New lifecycle hook tests ────────────────────────

  it("should execute beforeScan hooks", async () => {
    const marker = join(testDir, "before-scan");
    const config = { beforeScan: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeScan({ runId: "r" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute afterScan hooks", async () => {
    const marker = join(testDir, "after-scan");
    const config = { afterScan: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runAfterScan({ runId: "r" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute beforePlan hooks", async () => {
    const marker = join(testDir, "before-plan");
    const config = { beforePlan: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runBeforePlan({ runId: "r" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute afterPlan hooks", async () => {
    const marker = join(testDir, "after-plan");
    const config = { afterPlan: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runAfterPlan({ runId: "r" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute beforeStep hooks", async () => {
    const marker = join(testDir, "before-step");
    const config = { beforeStep: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeStep({ runId: "r", taskId: "t", taskTitle: "T" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute afterStep hooks", async () => {
    const marker = join(testDir, "after-step");
    const config = { afterStep: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runAfterStep({ runId: "r", taskId: "t", taskTitle: "T", success: true });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute onStepFail hooks", async () => {
    const marker = join(testDir, "step-fail");
    const config = { onStepFail: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runOnStepFail({ runId: "r", taskId: "t", taskTitle: "T", error: "err" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute onStepRetry hooks", async () => {
    const marker = join(testDir, "step-retry");
    const config = { onStepRetry: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runOnStepRetry({
      runId: "r",
      taskId: "t",
      taskTitle: "T",
      retryCount: 1,
      maxRetries: 3,
    });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute onApprovalRequired hooks", async () => {
    const marker = join(testDir, "approval");
    const config = { onApprovalRequired: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runOnApprovalRequired({ runId: "r", taskId: "t", taskTitle: "T", stepId: "s" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute beforeValidate hooks", async () => {
    const marker = join(testDir, "before-val");
    const config = { beforeValidate: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeValidate({ runId: "r", taskId: "t", taskTitle: "T" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute afterValidate hooks", async () => {
    const marker = join(testDir, "after-val");
    const config = { afterValidate: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runAfterValidate({
      runId: "r",
      taskId: "t",
      taskTitle: "T",
      validationStatus: "passed",
    });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute onArtifactCreated hooks", async () => {
    const marker = join(testDir, "artifact");
    const config = { onArtifactCreated: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runOnArtifactCreated({
      runId: "r",
      taskId: "t",
      artifactId: "a1",
      artifactType: "report",
      fileName: "report.md",
    });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute onFileChanged hooks", async () => {
    const marker = join(testDir, "file-changed");
    const config = { onFileChanged: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runOnFileChanged({ runId: "r", taskId: "t", fileName: "src/main.ts" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute onRunComplete hooks", async () => {
    const marker = join(testDir, "run-complete");
    const config = { onRunComplete: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runOnRunComplete({ runId: "r", success: true });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute onRunFail hooks", async () => {
    const marker = join(testDir, "run-fail");
    const config = { onRunFail: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runOnRunFail({ runId: "r", error: "failed" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should execute onRunCancel hooks", async () => {
    const marker = join(testDir, "run-cancel");
    const config = { onRunCancel: [`touch ${marker}`] };
    const manager = new HookManager(testDir, config);
    await manager.runOnRunCancel({ runId: "r" });
    expect(existsSync(marker)).toBe(true);
  });

  it("should pass extended context fields as environment variables", async () => {
    const envPath = join(testDir, "ext-env.txt");
    const config = {
      beforeStep: [
        `echo "$HOOK_STEP_ID|$HOOK_STEP_TITLE|$HOOK_ARTIFACT_ID|$HOOK_ARTIFACT_TYPE|$HOOK_FILE_NAME|$HOOK_VALIDATION_STATUS" > ${envPath}`,
      ],
    };
    const manager = new HookManager(testDir, config);
    await manager.runBeforeStep({
      runId: "r",
      taskId: "t",
      taskTitle: "T",
      stepId: "s1",
      stepTitle: "My Step",
      artifactId: "a1",
      artifactType: "report",
      fileName: "output.md",
      validationStatus: "passed",
    });
    const content = readFileSync(envPath, "utf-8").trim();
    expect(content).toBe("s1|My Step|a1|report|output.md|passed");
  });

  it("should execute shell hook entry with object config", async () => {
    const marker = join(testDir, "shell-entry");
    const config = {
      beforeRun: [{ type: "shell" as const, command: `touch ${marker}`, timeoutMs: 5000 }],
    };
    const manager = new HookManager(testDir, config);
    const results = await manager.runBeforeRun({ runId: "r" });
    expect(existsSync(marker)).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe("shell");
    expect(results[0]!.success).toBe(true);
  });

  it("should return duration in hook results", async () => {
    const config = {
      beforeRun: ["echo hello"],
    };
    const manager = new HookManager(testDir, config);
    const results = await manager.runBeforeRun({ runId: "r" });
    expect(results).toHaveLength(1);
    expect(results[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should return empty arrays for all new hook points with empty config", async () => {
    const manager = new HookManager(testDir, {});
    const hooks = [
      manager.runBeforeScan({ runId: "r" }),
      manager.runAfterScan({ runId: "r" }),
      manager.runBeforePlan({ runId: "r" }),
      manager.runAfterPlan({ runId: "r" }),
      manager.runBeforeStep({ runId: "r", taskId: "t", taskTitle: "T" }),
      manager.runAfterStep({ runId: "r", taskId: "t", taskTitle: "T", success: true }),
      manager.runOnStepFail({ runId: "r", taskId: "t", taskTitle: "T", error: "e" }),
      manager.runOnStepRetry({
        runId: "r",
        taskId: "t",
        taskTitle: "T",
        retryCount: 1,
        maxRetries: 3,
      }),
      manager.runOnApprovalRequired({ runId: "r", taskId: "t", taskTitle: "T" }),
      manager.runBeforeValidate({ runId: "r", taskId: "t", taskTitle: "T" }),
      manager.runAfterValidate({ runId: "r", taskId: "t", taskTitle: "T", validationStatus: "ok" }),
      manager.runOnArtifactCreated({ runId: "r", taskId: "t", artifactId: "a1" }),
      manager.runOnFileChanged({ runId: "r", taskId: "t", fileName: "f.ts" }),
      manager.runOnRunComplete({ runId: "r", success: true }),
      manager.runOnRunFail({ runId: "r", error: "e" }),
      manager.runOnRunCancel({ runId: "r" }),
    ];
    const results = await Promise.all(hooks);
    for (const r of results) {
      expect(r).toEqual([]);
    }
  });
});
