import {
  type Step,
  type StepStatus,
  type RetryPolicy,
  type TimeoutPolicy,
  type StepError,
  StepsFileSchema,
  StepSchema,
  isValidStepTransition,
  isStepTerminal,
  isStepActive,
} from "../schemas/step.schema.js";
import { fileExists, readJsonFile, atomicWriteJsonFile } from "../utils/fs.js";
import { stepsJsonPath } from "../utils/paths.js";
import { now } from "../utils/time.js";
import { generateStepId } from "../utils/ids.js";

interface StepsFile {
  runId: string;
  stepsByTask: Record<string, Step[]>;
}

export class StepManager {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  private async loadStepsFile(runId: string): Promise<StepsFile> {
    const sPath = stepsJsonPath(this.rootPath, runId);
    const exists = await fileExists(sPath);
    if (!exists) return { runId, stepsByTask: {} };
    try {
      const raw = await readJsonFile<Record<string, unknown>>(sPath);
      const result = StepsFileSchema.safeParse(raw);
      return result.success ? result.data : { runId, stepsByTask: {} };
    } catch {
      return { runId, stepsByTask: {} };
    }
  }

  private async saveStepsFile(runId: string, stepsFile: StepsFile): Promise<void> {
    await atomicWriteJsonFile(stepsJsonPath(this.rootPath, runId), stepsFile);
  }

  async loadSteps(runId: string, taskId: string): Promise<Step[]> {
    const stepsFile = await this.loadStepsFile(runId);
    return stepsFile.stepsByTask[taskId] ?? [];
  }

  async saveSteps(runId: string, taskId: string, steps: Step[]): Promise<void> {
    const stepsFile = await this.loadStepsFile(runId);
    stepsFile.stepsByTask[taskId] = steps;
    await this.saveStepsFile(runId, stepsFile);
  }

  async getStep(runId: string, taskId: string, stepId: string): Promise<Step | undefined> {
    const steps = await this.loadSteps(runId, taskId);
    return steps.find((s) => s.id === stepId);
  }

  async updateStep(
    runId: string,
    taskId: string,
    stepId: string,
    updates: Partial<Step>,
  ): Promise<Step> {
    const stepsFile = await this.loadStepsFile(runId);
    const steps = stepsFile.stepsByTask[taskId] ?? [];
    const idx = steps.findIndex((s) => s.id === stepId);
    if (idx < 0) throw new Error(`Step not found: ${stepId} in task ${taskId}`);

    const existing = steps[idx]!;
    const status = updates.status ?? existing.status;

    if (updates.status && updates.status !== existing.status) {
      if (!isValidStepTransition(existing.status, updates.status)) {
        throw new Error(
          `Invalid state transition: ${existing.status} → ${updates.status} for step ${stepId}`,
        );
      }
    }

    const updated: Step = {
      ...existing,
      ...updates,
      status,
      updatedAt: now(),
    };

    if (status === "running" && !updated.startedAt) {
      updated.startedAt = now();
    }
    if (isStepTerminal(status) && !updated.finishedAt) {
      updated.finishedAt = now();
    }

    const parsed = StepSchema.parse(updated);
    steps[idx] = parsed;
    stepsFile.stepsByTask[taskId] = steps;
    await this.saveStepsFile(runId, stepsFile);
    return parsed;
  }

  async updateStepStatus(
    runId: string,
    taskId: string,
    stepId: string,
    status: StepStatus,
  ): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status });
  }

  async approveStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    const step = await this.getStep(runId, taskId, stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    if (step.status === "pending_approval") {
      return this.updateStep(runId, taskId, stepId, { status: "approved" });
    }
    if (step.status === "waiting_approval") {
      return this.updateStep(runId, taskId, stepId, { status: "running" });
    }
    return this.updateStep(runId, taskId, stepId, { status: "approved" });
  }

  async denyStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    const step = await this.getStep(runId, taskId, stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    if (step.status === "pending_approval") {
      return this.updateStep(runId, taskId, stepId, { status: "denied" });
    }
    if (step.status === "waiting_approval") {
      return this.updateStep(runId, taskId, stepId, { status: "cancelled" });
    }
    return this.updateStep(runId, taskId, stepId, { status: "denied" });
  }

  async approveAllPending(runId: string, taskId: string): Promise<Step[]> {
    const stepsFile = await this.loadStepsFile(runId);
    const steps = stepsFile.stepsByTask[taskId] ?? [];
    const approved: Step[] = [];
    const updated = steps.map((s) => {
      if (s.status === "pending_approval") {
        const a = { ...s, status: "approved" as const, updatedAt: now() };
        approved.push(a);
        return a;
      }
      if (s.status === "waiting_approval") {
        const a = { ...s, status: "running" as const, updatedAt: now() };
        approved.push(a);
        return a;
      }
      return s;
    });
    stepsFile.stepsByTask[taskId] = updated;
    await this.saveStepsFile(runId, stepsFile);
    return approved;
  }

  async approveAllPendingForRun(runId: string): Promise<Step[]> {
    const stepsFile = await this.loadStepsFile(runId);
    const approved: Step[] = [];
    for (const [taskId, steps] of Object.entries(stepsFile.stepsByTask)) {
      const updated = steps.map((s) => {
        if (s.status === "pending_approval") {
          const a = { ...s, status: "approved" as const, updatedAt: now() };
          approved.push(a);
          return a;
        }
        if (s.status === "waiting_approval") {
          const a = { ...s, status: "running" as const, updatedAt: now() };
          approved.push(a);
          return a;
        }
        return s;
      });
      stepsFile.stepsByTask[taskId] = updated;
    }
    await this.saveStepsFile(runId, stepsFile);
    return approved;
  }

  async loadAllSteps(runId: string): Promise<Record<string, Step[]>> {
    const stepsFile = await this.loadStepsFile(runId);
    return stepsFile.stepsByTask;
  }

  async pauseStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "paused" });
  }

  async resumeStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "running" });
  }

  async cancelStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "cancelled" });
  }

  async skipStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "skipped" });
  }

  async retryStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    const step = await this.getStep(runId, taskId, stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    const retryPolicy = step.retryPolicy ?? {
      maxRetries: 2,
      retryDelayMs: 1000,
      retryBackoff: "linear" as const,
    };
    const currentRetries = step.errors?.length ?? 0;
    if (currentRetries >= retryPolicy.maxRetries) {
      throw new Error(`Step ${stepId} has exhausted max retries (${retryPolicy.maxRetries})`);
    }
    return this.updateStep(runId, taskId, stepId, { status: "pending" });
  }

  async markStepInputRequired(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "waiting_input" });
  }

  async provideStepInput(
    runId: string,
    taskId: string,
    stepId: string,
    input: Record<string, unknown>,
  ): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { input, status: "running" });
  }

  async markStepStuck(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "stuck" });
  }

  async recoverStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "running" });
  }

  async setStepAsNeedsReview(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "needs_user_review" });
  }

  async recordStepError(
    runId: string,
    taskId: string,
    stepId: string,
    error: Omit<StepError, "timestamp" | "retryCount">,
  ): Promise<Step> {
    const step = await this.getStep(runId, taskId, stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    const errors = step.errors ?? [];
    const newError: StepError = {
      ...error,
      timestamp: now(),
      retryCount: errors.length,
    };
    return this.updateStep(runId, taskId, stepId, { errors: [...errors, newError] });
  }

  async addStep(runId: string, taskId: string, stepDef: Partial<Step>): Promise<Step> {
    const nowStr = now();
    const step: Step = StepSchema.parse({
      id: generateStepId(),
      taskId,
      runId,
      title: stepDef.title ?? "New step",
      type: stepDef.type ?? "command",
      status: "created",
      requiresApproval: stepDef.requiresApproval ?? false,
      order: stepDef.order ?? 0,
      createdAt: nowStr,
      updatedAt: nowStr,
      dependsOn: stepDef.dependsOn ?? [],
      ...stepDef,
    });

    const stepsFile = await this.loadStepsFile(runId);
    const steps = stepsFile.stepsByTask[taskId] ?? [];
    steps.push(step);
    stepsFile.stepsByTask[taskId] = steps;
    await this.saveStepsFile(runId, stepsFile);
    return step;
  }

  async removeStep(runId: string, taskId: string, stepId: string): Promise<void> {
    const stepsFile = await this.loadStepsFile(runId);
    const steps = stepsFile.stepsByTask[taskId] ?? [];
    const dependents = steps.filter((s) => s.dependsOn.includes(stepId));
    if (dependents.length > 0) {
      throw new Error(
        `Cannot remove step ${stepId}: ${dependents.length} step(s) depend on it (${dependents.map((s) => s.id).join(", ")})`,
      );
    }
    const idx = steps.findIndex((s) => s.id === stepId);
    if (idx < 0) throw new Error(`Step not found: ${stepId}`);
    steps.splice(idx, 1);
    stepsFile.stepsByTask[taskId] = steps;
    await this.saveStepsFile(runId, stepsFile);
  }

  async getDependencyStatus(
    runId: string,
    taskId: string,
    stepId: string,
  ): Promise<{
    blocked: boolean;
    blockingStepIds: string[];
    satisfied: boolean;
    satisfiedStepIds: string[];
    pendingStepIds: string[];
    failedStepIds: string[];
  }> {
    const step = await this.getStep(runId, taskId, stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    const deps = step.dependsOn;
    if (deps.length === 0) {
      return {
        blocked: false,
        blockingStepIds: [],
        satisfied: true,
        satisfiedStepIds: [],
        pendingStepIds: [],
        failedStepIds: [],
      };
    }

    const allSteps = await this.loadSteps(runId, taskId);
    const blockingStepIds: string[] = [];
    const satisfiedStepIds: string[] = [];
    const pendingStepIds: string[] = [];
    const failedStepIds: string[] = [];

    for (const depId of deps) {
      const depStep = allSteps.find((s) => s.id === depId);
      if (!depStep) {
        blockingStepIds.push(depId);
        continue;
      }
      if (
        depStep.status === "succeeded" ||
        depStep.status === "done" ||
        depStep.status === "skipped"
      ) {
        satisfiedStepIds.push(depId);
      } else if (
        isStepActive(depStep.status) ||
        depStep.status === "pending" ||
        depStep.status === "paused"
      ) {
        pendingStepIds.push(depId);
      } else if (
        depStep.status === "failed" ||
        depStep.status === "cancelled" ||
        depStep.status === "stuck"
      ) {
        failedStepIds.push(depId);
      } else {
        pendingStepIds.push(depId);
      }
    }

    return {
      blocked: blockingStepIds.length > 0 || pendingStepIds.length > 0,
      blockingStepIds,
      satisfied: blockingStepIds.length === 0 && pendingStepIds.length === 0,
      satisfiedStepIds,
      pendingStepIds,
      failedStepIds,
    };
  }

  async canExecute(runId: string, taskId: string, stepId: string): Promise<boolean> {
    const status = await this.getDependencyStatus(runId, taskId, stepId);
    return status.satisfied;
  }

  async getReadySteps(runId: string, taskId: string): Promise<Step[]> {
    const steps = await this.loadSteps(runId, taskId);
    const ready: Step[] = [];
    for (const step of steps) {
      if (step.status !== "created" && step.status !== "pending") continue;
      if (step.status === "pending") {
        const depStatus = await this.getDependencyStatus(runId, taskId, step.id);
        if (depStatus.satisfied) {
          ready.push(step);
        }
      } else {
        ready.push(step);
      }
    }
    return ready;
  }

  async getBlockedSteps(runId: string, taskId: string): Promise<Step[]> {
    const steps = await this.loadSteps(runId, taskId);
    const blocked: Step[] = [];
    for (const step of steps) {
      if (step.status !== "created" && step.status !== "pending") continue;
      const depStatus = await this.getDependencyStatus(runId, taskId, step.id);
      if (!depStatus.satisfied) {
        blocked.push(step);
      }
    }
    return blocked;
  }

  async markStepFailed(
    runId: string,
    taskId: string,
    stepId: string,
    error?: Omit<StepError, "timestamp" | "retryCount">,
  ): Promise<Step> {
    const step = await this.getStep(runId, taskId, stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    const updates: Partial<Step> = { status: "failed" as StepStatus };

    if (error) {
      const errors = step.errors ?? [];
      const newError: StepError = {
        ...error,
        timestamp: now(),
        retryCount: errors.length,
      };
      updates.errors = [...errors, newError];
    }

    return this.updateStep(runId, taskId, stepId, updates);
  }

  async markStepValidating(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "validating" });
  }

  async markStepSucceeded(
    runId: string,
    taskId: string,
    stepId: string,
    output?: Record<string, unknown>,
  ): Promise<Step> {
    const updates: Partial<Step> = { status: "succeeded" as StepStatus };
    if (output) {
      updates.output = output;
    }
    return this.updateStep(runId, taskId, stepId, updates);
  }

  async markStepWaitingDependency(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "waiting_dependency" });
  }

  async getStepsByStatus(runId: string, taskId: string, status: StepStatus): Promise<Step[]> {
    const steps = await this.loadSteps(runId, taskId);
    return steps.filter((s) => s.status === status);
  }

  async countStepsByStatus(runId: string, taskId: string): Promise<Record<string, number>> {
    const steps = await this.loadSteps(runId, taskId);
    const counts: Record<string, number> = {};
    for (const step of steps) {
      const st = step.status;
      counts[st] = (counts[st] ?? 0) + 1;
    }
    return counts;
  }

  async duplicateSteps(runId: string, sourceTaskId: string, targetTaskId: string): Promise<Step[]> {
    const steps = await this.loadSteps(runId, sourceTaskId);
    const nowStr = now();
    const duplicated = steps.map((s) => ({
      ...s,
      id: generateStepId(),
      taskId: targetTaskId,
      status: "created" as StepStatus,
      startedAt: undefined,
      finishedAt: undefined,
      createdAt: nowStr,
      updatedAt: nowStr,
      errors: undefined,
      output: undefined,
      checkpointId: undefined,
    }));
    await this.saveSteps(runId, targetTaskId, duplicated);
    return duplicated;
  }

  async getStepTimeline(
    runId: string,
    taskId: string,
    stepId: string,
  ): Promise<{ startedAt?: string; finishedAt?: string; errors: StepError[] }> {
    const step = await this.getStep(runId, taskId, stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    return {
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      errors: step.errors ?? [],
    };
  }

  async resetStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, {
      status: "pending",
      exitCode: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      errors: [],
      output: undefined,
      checkpointId: undefined,
    });
  }
}
