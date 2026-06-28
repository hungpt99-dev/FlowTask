import { type Step, type StepStatus, StepsFileSchema, StepSchema } from "../schemas/step.schema.js";
import { fileExists, readJsonFile, atomicWriteJsonFile } from "../utils/fs.js";
import { stepsJsonPath } from "../utils/paths.js";
import { now } from "../utils/time.js";

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
    const updated: Step = { ...existing, ...updates, updatedAt: now() };

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
    return this.updateStep(runId, taskId, stepId, { status } as Partial<Step>);
  }

  async approveStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "approved" } as Partial<Step>);
  }

  async denyStep(runId: string, taskId: string, stepId: string): Promise<Step> {
    return this.updateStep(runId, taskId, stepId, { status: "denied" } as Partial<Step>);
  }

  async approveAllPending(runId: string, taskId: string): Promise<Step[]> {
    const stepsFile = await this.loadStepsFile(runId);
    const steps = stepsFile.stepsByTask[taskId] ?? [];
    const updated = steps.map((s) => {
      if (s.status === "pending_approval") {
        return { ...s, status: "approved" as const, updatedAt: now() };
      }
      return s;
    });
    stepsFile.stepsByTask[taskId] = updated;
    await this.saveStepsFile(runId, stepsFile);
    return updated.filter((s) => s.status === "approved");
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
}
