import path from "node:path";
import * as yaml from "js-yaml";
import { type Task } from "../schemas/task.schema.js";
import {
  type WorkflowFile,
  type WorkflowTask,
  type WorkflowDiff,
  type WorkflowValidationResult,
  WorkflowFileSchema,
  WorkflowValidationResultSchema,
} from "../schemas/workflow.schema.js";
import type { OutputPlan } from "../schemas/output-plan.schema.js";
import {
  type WorkflowStatus,
  type WorkflowLifecycleEvent,
  type WorkflowState,
  type PendingGate,
  type ApprovalHistoryEntry,
  WorkflowStateSchema,
  WorkflowLifecycleEventTypeSchema,
  WorkflowStatusSchema,
  isValidWorkflowTransition,
  isWorkflowTerminal,
  isWorkflowActive,
  PendingGateSchema,
} from "../schemas/workflow-lifecycle.schema.js";
import {
  writeTextFile,
  readTextFile,
  atomicWriteJsonFile,
  fileExists,
  readJsonFile,
} from "../utils/fs.js";
import { getRunDir, getSnapshotsDir } from "../utils/paths.js";
import { now } from "../utils/time.js";
import { generateTaskId } from "../utils/ids.js";
import { RunManager } from "./run-manager.js";
import { EventStore } from "./event-store.js";
import { ApprovalGateChecker } from "../safety/approval-gate.js";
import type { ActionType, ApprovalGateResult } from "../safety/approval-gate.js";
import type { GateDecision } from "../safety/approval-manager.js";
import { randomUUID } from "node:crypto";

const MAX_SNAPSHOTS = 10;
const MODIFIABLE_STATUSES = new Set(["pending", "failed", "interrupted", "cancelled", "blocked"]);

export interface ExportOptions {
  format?: "yaml" | "json";
  skipCompleted?: boolean;
}

export interface ApplyOptions {
  dryRun?: boolean;
  noConfirm?: boolean;
  force?: boolean;
}

export interface AddTaskOptions {
  after?: string;
}

export interface RemoveTaskOptions {
  delete?: boolean;
  force?: boolean;
}

export interface ApplyResult {
  applied: boolean;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  snapshotPath?: string;
  errors: string[];
  warnings: string[];
}

export class WorkflowManager {
  constructor(
    private rootPath: string,
    private runManager: RunManager,
    private eventStore: EventStore,
  ) {}

  private workflowStatePath(runId: string): string {
    return path.join(getRunDir(this.rootPath, runId), "workflow-state.json");
  }

  async loadWorkflowState(runId: string): Promise<WorkflowState | null> {
    const sPath = this.workflowStatePath(runId);
    const exists = await fileExists(sPath);
    if (!exists) return null;
    try {
      const raw = await readJsonFile<Record<string, unknown>>(sPath);
      const result = WorkflowStateSchema.safeParse(raw);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  async saveWorkflowState(state: WorkflowState): Promise<void> {
    const updated = { ...state, updatedAt: now() };
    const parsed = WorkflowStateSchema.parse(updated);
    await atomicWriteJsonFile(this.workflowStatePath(state.runId), parsed);
  }

  async initWorkflowState(runId: string): Promise<WorkflowState> {
    const nowStr = now();
    const state: WorkflowState = {
      runId,
      status: "created",
      retryCount: 0,
      errorCount: 0,
      lifecycle: [
        {
          type: "workflow_created",
          timestamp: nowStr,
          workflowStatus: "created",
          message: "Workflow created",
        },
      ],
      updatedAt: nowStr,
    };
    await this.saveWorkflowState(state);
    return state;
  }

  async transitionWorkflowState(
    runId: string,
    newStatus: WorkflowStatus,
    message?: string,
    details?: Record<string, unknown>,
  ): Promise<WorkflowState> {
    const state = (await this.loadWorkflowState(runId)) ?? (await this.initWorkflowState(runId));

    if (!isValidWorkflowTransition(state.status, newStatus)) {
      throw new Error(`Invalid workflow state transition: ${state.status} → ${newStatus}`);
    }

    const previousStatus = state.status;

    const event: WorkflowLifecycleEvent = {
      type: "state_transition",
      timestamp: now(),
      workflowStatus: newStatus,
      message: message ?? `State transition: ${previousStatus} → ${newStatus}`,
      details: { ...details, previousStatus },
    };

    const updated: WorkflowState = {
      ...state,
      status: newStatus,
      previousStatus,
      lifecycle: [...state.lifecycle, event],
      updatedAt: now(),
    };

    if (isWorkflowTerminal(newStatus)) {
      updated.completedAt = now();
    }
    if (newStatus === "paused") {
      updated.pausedAt = now();
    }
    if (newStatus === "running" && !updated.startedAt) {
      updated.startedAt = now();
    }

    await this.saveWorkflowState(updated);

    await this.eventStore.appendToRun(runId, {
      type: "workflow_applied",
      message: `Workflow state: ${previousStatus} → ${newStatus}`,
      details: { previousStatus, newStatus },
    });

    return updated;
  }

  async pauseWorkflow(runId: string): Promise<WorkflowState> {
    const state = await this.transitionWorkflowState(runId, "paused", "Workflow paused");

    await this.eventStore.appendToRun(runId, {
      type: "workflow_applied",
      message: "Workflow paused",
    });

    return { ...state, pausedAt: now() };
  }

  async resumeWorkflow(runId: string): Promise<WorkflowState> {
    const state = await this.transitionWorkflowState(runId, "running", "Workflow resumed");

    await this.eventStore.appendToRun(runId, {
      type: "workflow_applied",
      message: "Workflow resumed",
    });

    return state;
  }

  async cancelWorkflow(runId: string): Promise<WorkflowState> {
    return this.transitionWorkflowState(runId, "cancelled", "Workflow cancelled");
  }

  async failWorkflow(runId: string, errorMessage?: string): Promise<WorkflowState> {
    return this.transitionWorkflowState(runId, "failed", errorMessage ?? "Workflow failed");
  }

  async completeWorkflow(runId: string): Promise<WorkflowState> {
    return this.transitionWorkflowState(runId, "succeeded", "Workflow completed successfully");
  }

  async markWorkflowStuck(runId: string, reason?: string): Promise<WorkflowState> {
    return this.transitionWorkflowState(runId, "stuck", reason ?? "Workflow stuck");
  }

  async markWorkflowNeedsReview(runId: string, reason?: string): Promise<WorkflowState> {
    return this.transitionWorkflowState(
      runId,
      "needs_user_review",
      reason ?? "Workflow needs user review",
    );
  }

  async retryWorkflow(runId: string): Promise<WorkflowState> {
    const state = await this.loadWorkflowState(runId);
    if (!state) throw new Error(`No workflow state for run: ${runId}`);

    const updated: WorkflowState = {
      ...state,
      status: "running",
      retryCount: (state.retryCount ?? 0) + 1,
      lifecycle: [
        ...state.lifecycle,
        {
          type: "state_transition",
          timestamp: now(),
          workflowStatus: "running",
          message: `Workflow retry #${(state.retryCount ?? 0) + 1}`,
          details: { previousStatus: state.status, retryCount: (state.retryCount ?? 0) + 1 },
        },
      ],
      updatedAt: now(),
    };

    await this.saveWorkflowState(updated);

    await this.eventStore.appendToRun(runId, {
      type: "workflow_applied",
      message: `Workflow retry #${(state.retryCount ?? 0) + 1}`,
    });

    return updated;
  }

  async getWorkflowStatus(runId: string): Promise<WorkflowStatus | null> {
    const state = await this.loadWorkflowState(runId);
    return state?.status ?? null;
  }

  async getWorkflowTimeline(runId: string): Promise<WorkflowLifecycleEvent[]> {
    const state = await this.loadWorkflowState(runId);
    return state?.lifecycle ?? [];
  }

  async isWorkflowPaused(runId: string): Promise<boolean> {
    const status = await this.getWorkflowStatus(runId);
    return status === "paused";
  }

  async isWorkflowActive(runId: string): Promise<boolean> {
    const status = await this.getWorkflowStatus(runId);
    return status ? isWorkflowActive(status) : false;
  }

  async isWorkflowTerminal(runId: string): Promise<boolean> {
    const status = await this.getWorkflowStatus(runId);
    return status ? isWorkflowTerminal(status) : false;
  }

  async exportWorkflow(
    runId: string,
    options?: ExportOptions,
  ): Promise<{ workflow: WorkflowFile; yaml: string; json: string }> {
    const tasks = await this.runManager.loadTasks(runId);

    let filtered = tasks;
    if (options?.skipCompleted) {
      filtered = tasks.filter((t) => !["done", "skipped"].includes(t.status));
    }

    const workflowTasks: WorkflowTask[] = filtered.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      executor: t.executor === "shell" ? undefined : t.executor,
      dependsOn: t.dependsOn,
      acceptanceCriteria: t.acceptanceCriteria,
      validation: t.validation
        ? {
            commands: t.validation.commands,
            requiredArtifacts: t.validation.requiredArtifacts,
            requireGitDiff: t.validation.requireGitDiff,
          }
        : undefined,
      outputPlan: t.outputPlan as OutputPlan | undefined,
      maxRetries: t.maxRetries !== 2 ? t.maxRetries : undefined,
    }));

    const run = await this.runManager.loadRun(runId);
    const workflow: WorkflowFile = {
      runTitle: run?.title,
      tasks: workflowTasks,
    };

    const yamlStr = yaml.dump(workflow, { indent: 2, lineWidth: 120, noRefs: true });
    const jsonStr = JSON.stringify(workflow, null, 2);

    return { workflow, yaml: yamlStr, json: jsonStr };
  }

  async buildDiff(runId: string, workflow: WorkflowFile): Promise<WorkflowDiff> {
    const currentTasks = await this.runManager.loadTasks(runId);
    return this.computeDiff(currentTasks, workflow);
  }

  async applyWorkflow(
    runId: string,
    workflow: WorkflowFile,
    options?: ApplyOptions,
  ): Promise<ApplyResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const currentTasks = await this.runManager.loadTasks(runId);

    const validation = this.validateWorkflow(workflow, currentTasks);
    if (!validation.valid) {
      errors.push(...validation.errors);
      errors.push(...validation.cycles.map((c) => `Circular dependency: ${c.join(" -> ")}`));
      errors.push(...validation.deadRefs.map((r) => `Dead reference: ${r}`));
      return {
        applied: false,
        added: 0,
        removed: 0,
        modified: 0,
        unchanged: 0,
        errors,
        warnings: validation.warnings,
      };
    }

    const diff = this.computeDiff(currentTasks, workflow);
    const snapshotPath = options?.dryRun ? undefined : await this.saveSnapshot(runId);

    if (options?.dryRun) {
      return {
        applied: false,
        added: diff.added.length,
        removed: diff.removed.length,
        modified: diff.modified.length,
        unchanged: diff.unchanged.length,
        snapshotPath,
        errors: [],
        warnings: [],
      };
    }

    const currentMap = new Map(currentTasks.map((t) => [t.id, t]));
    const newTasks: Task[] = [];

    for (const wt of workflow.tasks) {
      const existing = currentMap.get(wt.id);
      if (existing) {
        if (diff.unchanged.includes(wt.id)) {
          newTasks.push(existing);
          continue;
        }

        if (!options?.force && !MODIFIABLE_STATUSES.has(existing.status)) {
          warnings.push(
            `Cannot modify task ${wt.id} (status: ${existing.status}). Use --force to override.`,
          );
          newTasks.push(existing);
          continue;
        }

        newTasks.push(this.mergeTask(existing, wt));
      } else {
        const nowStr = now();
        newTasks.push({
          id: wt.id,
          runId,
          title: wt.title,
          description: wt.description,
          status: "pending",
          executor: wt.executor ?? "shell",
          dependsOn: wt.dependsOn ?? [],
          acceptanceCriteria: wt.acceptanceCriteria ?? [],
          validation: wt.validation
            ? {
                commands: wt.validation.commands,
                requiredArtifacts: wt.validation.requiredArtifacts,
                requireGitDiff: wt.validation.requireGitDiff,
              }
            : undefined,
          outputPlan: wt.outputPlan,
          retryCount: 0,
          maxRetries: wt.maxRetries ?? 2,
          createdAt: nowStr,
          updatedAt: nowStr,
        });
      }
    }

    const removedIds = new Set(diff.removed.map((r) => r.id));
    if (options?.force) {
      const finalIds = new Set(newTasks.map((t) => t.id));
      for (const task of currentTasks) {
        if (removedIds.has(task.id) && !finalIds.has(task.id)) {
          const updatedDeps = task.dependsOn.filter((d) => !removedIds.has(d));
          newTasks.push({ ...task, status: "skipped", dependsOn: updatedDeps, updatedAt: now() });
        }
      }
    } else {
      const currentIds = new Set(currentTasks.map((t) => t.id));
      const workflowIds = new Set(workflow.tasks.map((t) => t.id));
      for (const task of currentTasks) {
        if (!workflowIds.has(task.id) && currentIds.has(task.id)) {
          newTasks.push({ ...task, status: "skipped", updatedAt: now() });
        }
      }
    }

    newTasks.sort((a, b) => {
      const aIdx = workflow.tasks.findIndex((t) => t.id === a.id);
      const bIdx = workflow.tasks.findIndex((t) => t.id === b.id);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return (
        currentTasks.findIndex((t) => t.id === a.id) - currentTasks.findIndex((t) => t.id === b.id)
      );
    });

    await this.runManager.saveTasks(runId, newTasks);

    await this.eventStore.appendToRun(runId, {
      type: "workflow_applied",
      message: `Workflow applied: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.modified.length} modified`,
      details: {
        added: diff.added.length,
        removed: diff.removed.length,
        modified: diff.modified.length,
        snapshotPath,
      },
    });

    return {
      applied: true,
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
      unchanged: diff.unchanged.length,
      snapshotPath,
      errors,
      warnings,
    };
  }

  async addTask(
    runId: string,
    taskDef: Partial<WorkflowTask>,
    options?: AddTaskOptions,
  ): Promise<Task> {
    const tasks = await this.runManager.loadTasks(runId);
    const nowStr = now();

    const task: Task = {
      id: generateTaskId(),
      runId,
      title: taskDef.title ?? "New task",
      description: taskDef.description,
      status: "pending",
      executor: taskDef.executor ?? "shell",
      dependsOn: taskDef.dependsOn ?? [],
      acceptanceCriteria: taskDef.acceptanceCriteria ?? [],
      retryCount: 0,
      maxRetries: taskDef.maxRetries ?? 2,
      createdAt: nowStr,
      updatedAt: nowStr,
    };

    if (options?.after) {
      const afterIdx = tasks.findIndex((t) => t.id === options.after);
      if (afterIdx >= 0) {
        tasks.splice(afterIdx + 1, 0, task);
      } else {
        tasks.push(task);
      }
    } else {
      tasks.push(task);
    }

    await this.runManager.saveTasks(runId, tasks);

    await this.eventStore.appendToRun(runId, {
      type: "workflow_added_task",
      taskId: task.id,
      message: `Task added: ${task.title}`,
    });

    return task;
  }

  async removeTask(runId: string, taskId: string, options?: RemoveTaskOptions): Promise<void> {
    const tasks = await this.runManager.loadTasks(runId);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) throw new Error(`Task not found: ${taskId}`);

    if (options?.force) {
      for (const t of tasks) {
        if (t.dependsOn.includes(taskId)) {
          t.dependsOn = t.dependsOn.filter((d) => d !== taskId);
        }
      }
    } else {
      const dependents = tasks.filter((t) => t.dependsOn.includes(taskId));
      if (dependents.length > 0) {
        throw new Error(
          `Cannot remove task ${taskId}: ${dependents.length} task(s) depend on it (${dependents.map((t) => t.id).join(", ")})`,
        );
      }
    }

    if (options?.delete) {
      tasks.splice(idx, 1);
    } else {
      tasks[idx] = { ...tasks[idx]!, status: "skipped", updatedAt: now() };
    }

    await this.runManager.saveTasks(runId, tasks);

    await this.eventStore.appendToRun(runId, {
      type: "workflow_removed_task",
      taskId,
      message: options?.delete ? `Task deleted: ${taskId}` : `Task skipped: ${taskId}`,
    });
  }

  async reorderTasks(runId: string, orderedIds: string[]): Promise<void> {
    const tasks = await this.runManager.loadTasks(runId);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const reordered: Task[] = [];
    for (const id of orderedIds) {
      const task = taskMap.get(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      reordered.push(task);
      taskMap.delete(id);
    }

    for (const task of taskMap.values()) {
      reordered.push(task);
    }

    this.validateOrdering(reordered);

    await this.runManager.saveTasks(runId, reordered);

    await this.eventStore.appendToRun(runId, {
      type: "workflow_reordered",
      message: `Tasks reordered`,
      details: { orderedIds },
    });
  }

  async reorderTask(runId: string, taskId: string, newIndex: number): Promise<void> {
    const tasks = await this.runManager.loadTasks(runId);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) throw new Error(`Task not found: ${taskId}`);

    const [task] = tasks.splice(idx, 1);
    tasks.splice(newIndex, 0, task!);

    this.validateOrdering(tasks);

    await this.runManager.saveTasks(runId, tasks);

    await this.eventStore.appendToRun(runId, {
      type: "workflow_reordered",
      taskId,
      message: `Task moved: ${taskId} to position ${newIndex}`,
    });
  }

  async saveSnapshot(runId: string): Promise<string> {
    const snapDir = getSnapshotsDir(this.rootPath, runId);
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z/, "");
    const snapshotPath = path.join(snapDir, `workflow-before-${timestamp}.yaml`);

    const { yaml: yamlStr } = await this.exportWorkflow(runId);
    await writeTextFile(snapshotPath, yamlStr);

    await this.eventStore.appendToRun(runId, {
      type: "workflow_snapshot_saved",
      message: `Snapshot saved: workflow-before-${timestamp}.yaml`,
    });

    await this.cleanOldSnapshots(runId);

    return snapshotPath;
  }

  async loadWorkflowFromFile(filePath: string): Promise<WorkflowFile> {
    const content = await readTextFile(filePath);
    const ext = path.extname(filePath).toLowerCase();

    let parsed: unknown;
    if (ext === ".json") {
      parsed = JSON.parse(content);
    } else {
      parsed = yaml.load(content);
    }

    const result = WorkflowFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid workflow file: ${result.error.message}`);
    }
    return result.data;
  }

  validateWorkflow(workflow: WorkflowFile, tasks?: Task[]): WorkflowValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!workflow.tasks.length) {
      errors.push("Workflow must have at least one task");
      return { valid: false, cycles: [], deadRefs: [], orphans: [], errors, warnings };
    }

    const ids = new Set<string>();
    for (const t of workflow.tasks) {
      if (ids.has(t.id)) {
        errors.push(`Duplicate task ID: ${t.id}`);
      }
      ids.add(t.id);
    }

    const deadRefs: string[] = [];
    for (const t of workflow.tasks) {
      for (const dep of t.dependsOn ?? []) {
        if (!ids.has(dep)) {
          deadRefs.push(`${t.id} depends on ${dep} which does not exist`);
        }
      }
    }

    if (deadRefs.length > 0) {
      errors.push(...deadRefs);
    }

    const cycles = this.detectCycles(workflow.tasks);
    if (cycles.length > 0) {
      errors.push(...cycles.map((c) => `Circular dependency: ${c.join(" -> ")}`));
    }

    const orphans = this.findOrphans(workflow.tasks);
    if (orphans.length > 0) {
      warnings.push(...orphans.map((id) => `Orphan task: ${id} (not in dependency graph)`));
    }

    if (tasks) {
      const currentMap = new Map(tasks.map((t) => [t.id, t]));
      for (const wt of workflow.tasks) {
        const existing = currentMap.get(wt.id);
        if (existing && existing.status === "running") {
          warnings.push(
            `Task ${wt.id} is currently running. Stop or interrupt it before modifying.`,
          );
        }
      }
    }

    return WorkflowValidationResultSchema.parse({
      valid: errors.length === 0,
      cycles,
      deadRefs,
      orphans,
      errors,
      warnings,
    });
  }

  private computeDiff(currentTasks: Task[], workflow: WorkflowFile): WorkflowDiff {
    const currentMap = new Map(currentTasks.map((t) => [t.id, t]));
    const workflowMap = new Map(workflow.tasks.map((t) => [t.id, t]));

    const added: WorkflowFile["tasks"] = [];
    const removed: { id: string; title: string; reason?: string }[] = [];
    const modified: { id: string; title?: { old: string; new: string }; changes: string[] }[] = [];
    const unchanged: string[] = [];

    for (const wt of workflow.tasks) {
      const existing = currentMap.get(wt.id);
      if (!existing) {
        added.push(wt);
      } else {
        const changes = this.detectChanges(existing, wt);
        if (changes.length > 0) {
          modified.push({
            id: wt.id,
            title: existing.title !== wt.title ? { old: existing.title, new: wt.title } : undefined,
            changes,
          });
        } else {
          unchanged.push(wt.id);
        }
      }
    }

    for (const task of currentTasks) {
      if (!workflowMap.has(task.id)) {
        removed.push({ id: task.id, title: task.title });
      }
    }

    return { added, removed, modified, unchanged };
  }

  private detectChanges(existing: Task, wt: WorkflowTask): string[] {
    const changes: string[] = [];
    if (existing.title !== wt.title) changes.push(`title: "${existing.title}" → "${wt.title}"`);
    if ((existing.description ?? "") !== (wt.description ?? ""))
      changes.push("description modified");
    if (existing.executor !== (wt.executor ?? "shell"))
      changes.push(`executor: ${existing.executor} → ${wt.executor}`);
    if (JSON.stringify(existing.dependsOn) !== JSON.stringify(wt.dependsOn ?? []))
      changes.push("dependencies modified");
    if (JSON.stringify(existing.acceptanceCriteria) !== JSON.stringify(wt.acceptanceCriteria ?? []))
      changes.push("acceptance criteria modified");
    if (existing.maxRetries !== (wt.maxRetries ?? 2))
      changes.push(`maxRetries: ${existing.maxRetries} → ${wt.maxRetries}`);
    return changes;
  }

  private mergeTask(existing: Task, wt: WorkflowTask): Task {
    return {
      ...existing,
      title: wt.title,
      description: wt.description ?? existing.description,
      executor: wt.executor ?? existing.executor,
      dependsOn: wt.dependsOn ?? existing.dependsOn,
      acceptanceCriteria: wt.acceptanceCriteria ?? existing.acceptanceCriteria,
      validation: wt.validation
        ? {
            commands: wt.validation.commands,

            requiredArtifacts: wt.validation.requiredArtifacts,
            requireGitDiff: wt.validation.requireGitDiff,
          }
        : existing.validation,
      outputPlan: (wt.outputPlan ?? existing.outputPlan) as OutputPlan | undefined,
      maxRetries: wt.maxRetries ?? existing.maxRetries,
      updatedAt: now(),
    };
  }

  private detectCycles(tasks: WorkflowTask[]): string[][] {
    const adj = new Map<string, string[]>();
    for (const t of tasks) {
      adj.set(t.id, t.dependsOn ?? []);
    }

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();
    const cycles: string[][] = [];

    for (const t of tasks) {
      color.set(t.id, WHITE);
      parent.set(t.id, null);
    }

    function dfs(node: string): void {
      color.set(node, GRAY);
      const neighbors = adj.get(node) ?? [];
      for (const neighbor of neighbors) {
        if (!color.has(neighbor)) continue;
        if (color.get(neighbor) === GRAY) {
          const cycle: string[] = [];
          let cur: string | null = node;
          while (cur !== null && cur !== neighbor) {
            cycle.unshift(cur);
            cur = parent.get(cur) ?? null;
          }
          cycle.unshift(neighbor);
          cycle.push(neighbor);
          cycles.push(cycle);
        } else if (color.get(neighbor) === WHITE) {
          parent.set(neighbor, node);
          dfs(neighbor);
        }
      }
      color.set(node, BLACK);
    }

    for (const t of tasks) {
      if (color.get(t.id) === WHITE) {
        dfs(t.id);
      }
    }

    return cycles;
  }

  private findOrphans(tasks: WorkflowTask[]): string[] {
    if (tasks.length === 0) return [];

    const adj = new Map<string, string[]>();
    const reverseAdj = new Map<string, string[]>();

    for (const t of tasks) {
      if (!adj.has(t.id)) adj.set(t.id, []);
      if (!reverseAdj.has(t.id)) reverseAdj.set(t.id, []);
    }

    for (const t of tasks) {
      for (const dep of t.dependsOn ?? []) {
        adj.get(t.id)?.push(dep);
        reverseAdj.get(dep)?.push(t.id);
      }
    }

    const reachable = new Set<string>();
    const roots = tasks.filter((t) => (t.dependsOn ?? []).length === 0);
    for (const root of roots) {
      this.walkGraph(root.id, adj, reachable);
    }

    const orphans: string[] = [];
    for (const t of tasks) {
      if (!reachable.has(t.id)) {
        orphans.push(t.id);
      }
    }

    return orphans;
  }

  private walkGraph(node: string, adj: Map<string, string[]>, visited: Set<string>): void {
    if (visited.has(node)) return;
    visited.add(node);
    for (const neighbor of adj.get(node) ?? []) {
      this.walkGraph(neighbor, adj, visited);
    }
  }

  private validateOrdering(tasks: Task[]): void {
    const positions = new Map(tasks.map((t, i) => [t.id, i]));

    for (const t of tasks) {
      for (const dep of t.dependsOn) {
        const depPos = positions.get(dep);
        const taskPos = positions.get(t.id);
        if (depPos !== undefined && taskPos !== undefined && depPos > taskPos) {
          throw new Error(
            `Invalid ordering: ${t.id} appears before its dependency ${dep}. ` +
              `Dependencies must appear before tasks that depend on them.`,
          );
        }
      }
    }
  }

  async checkWorkflowRiskyActions(workflow: WorkflowFile): Promise<{
    allSafe: boolean;
    riskyActions: Array<{
      taskId: string;
      actionType: ActionType;
      riskLevel: string;
      reason: string;
    }>;
  }> {
    const checker = new ApprovalGateChecker();
    const riskyActions: Array<{
      taskId: string;
      actionType: ActionType;
      riskLevel: string;
      reason: string;
    }> = [];

    for (const task of workflow.tasks) {
      const actionType = checker.classifyStepType(task.title, task.validation?.commands?.join(" "));
      const result = checker.checkAction(actionType);
      if (result.requiresApproval) {
        riskyActions.push({
          taskId: task.id,
          actionType: result.actionType,
          riskLevel: result.riskLevel,
          reason: result.reason,
        });
      }
    }

    return { allSafe: riskyActions.length === 0, riskyActions };
  }

  async requirePlanApproval(
    workflow: WorkflowFile,
    approvalGateChecker?: ApprovalGateChecker,
  ): Promise<{
    requiresApproval: boolean;
    riskyActions: Array<{
      taskId: string;
      actionType: ActionType;
      riskLevel: string;
      reason: string;
    }>;
  }> {
    const checker = approvalGateChecker ?? new ApprovalGateChecker();
    const requiresPlanApproval = checker.getConfig().requirePlanApproval;

    if (!requiresPlanApproval) {
      return { requiresApproval: false, riskyActions: [] };
    }

    const { riskyActions } = await this.checkWorkflowRiskyActions(workflow);

    if (riskyActions.length === 0) {
      return { requiresApproval: false, riskyActions: [] };
    }

    return { requiresApproval: true, riskyActions };
  }

  async applyWorkflowWithApprovalCheck(
    runId: string,
    workflow: WorkflowFile,
    options?: ApplyOptions & { approved?: boolean },
  ): Promise<ApplyResult> {
    if (!options?.noConfirm && !options?.approved) {
      const { requiresApproval, riskyActions } = await this.requirePlanApproval(workflow);

      if (requiresApproval && !options?.force) {
        return {
          applied: false,
          added: 0,
          removed: 0,
          modified: 0,
          unchanged: 0,
          errors: [
            "Workflow contains risky actions and requires approval. " +
              "Use --force to bypass or approve the plan first via CLI.",
          ],
          warnings: riskyActions.map(
            (r) =>
              `Risky action: ${r.actionType} (${r.riskLevel}) in task ${r.taskId}: ${r.reason}`,
          ),
        };
      }
    }

    return this.applyWorkflow(runId, workflow, options);
  }

  checkStepRequiresApproval(
    stepTitle: string,
    stepCommand?: string,
    context?: {
      estimatedCost?: number;
      failureCount?: number;
    },
  ): ApprovalGateResult {
    const checker = new ApprovalGateChecker();
    const actionType = checker.classifyStepType(stepTitle, stepCommand);
    return checker.checkAction(actionType, context);
  }

  async requireGateApproval(
    runId: string,
    taskId: string,
    actionType: string,
    riskLevel: string,
    reason: string,
    details?: string,
  ): Promise<string> {
    const state = await this.loadWorkflowState(runId);
    if (!state) throw new Error(`No workflow state for run: ${runId}`);

    const gateId = `gate_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const nowStr = now();

    const gate: PendingGate = {
      id: gateId,
      taskId,
      actionType,
      riskLevel,
      reason,
      details,
      status: "pending",
      createdAt: nowStr,
    };

    const pendingGates = [...(state.pendingGates ?? []), gate];
    const updated: WorkflowState = {
      ...state,
      status: "waiting_approval",
      pendingGates,
      lifecycle: [
        ...state.lifecycle,
        {
          type: "gate_approval_required",
          timestamp: nowStr,
          workflowStatus: "waiting_approval",
          message: `Gate approval required: ${actionType} for task ${taskId}`,
          details: { gateId, actionType, riskLevel, reason, taskId },
        },
      ],
      updatedAt: nowStr,
    };

    await this.saveWorkflowState(updated);
    await this.runManager.addRunApproval(runId, {
      id: gateId,
      type: "step",
      status: "pending",
      reason: `${actionType} (${riskLevel}): ${reason}`,
    });
    await this.eventStore.appendToRun(runId, {
      type: "approval_requested",
      message: `Gate approval required: ${actionType} for task ${taskId}`,
      details: { gateId, actionType, riskLevel, reason, taskId },
    });

    return gateId;
  }

  async resolveGateApproval(
    runId: string,
    gateId: string,
    decision: GateDecision,
    resolvedBy?: string,
  ): Promise<boolean> {
    const state = await this.loadWorkflowState(runId);
    if (!state) throw new Error(`No workflow state for run: ${runId}`);

    const gates = state.pendingGates ?? [];
    const idx = gates.findIndex((g) => g.id === gateId);
    if (idx < 0) return false;

    const gate = gates[idx]!;
    const nowStr = now();

    const gateStatus =
      decision === "approved" ? "approved" : decision === "override" ? "overridden" : "rejected";

    const updatedGates = [...gates];
    updatedGates[idx] = {
      ...gate,
      status: gateStatus,
      resolvedAt: nowStr,
      resolvedBy,
    };

    const historyEntry: ApprovalHistoryEntry = {
      id: gateId,
      taskId: gate.taskId,
      actionType: gate.actionType,
      riskLevel: gate.riskLevel,
      decision,
      reason: `Resolved by ${resolvedBy ?? "user"}`,
      autoApproved: false,
      createdAt: nowStr,
    };

    const remainingUnresolved = updatedGates.filter((g) => g.status === "pending");
    const newStatus: WorkflowStatus =
      remainingUnresolved.length > 0 ? "waiting_approval" : "running";

    const updated: WorkflowState = {
      ...state,
      status: newStatus,
      pendingGates: updatedGates,
      approvalHistory: [...(state.approvalHistory ?? []), historyEntry],
      lifecycle: [
        ...state.lifecycle,
        {
          type:
            decision === "approved" || decision === "override" ? "gate_approved" : "gate_rejected",
          timestamp: nowStr,
          workflowStatus: newStatus,
          message: `Gate ${decision}: ${gate.actionType} (${gate.riskLevel})`,
          details: { gateId, decision, actionType: gate.actionType, taskId: gate.taskId },
        },
      ],
      updatedAt: nowStr,
    };

    await this.saveWorkflowState(updated);

    await this.runManager.resolveRunApproval(
      runId,
      gateId,
      decision === "approved" ? "approved" : "rejected",
    );

    await this.eventStore.appendToRun(runId, {
      type: "approval_approved",
      message: `Gate ${decision}: ${gate.actionType}`,
      details: { gateId, decision, actionType: gate.actionType, taskId: gate.taskId },
    });

    return true;
  }

  async getPendingGates(runId: string): Promise<PendingGate[]> {
    const state = await this.loadWorkflowState(runId);
    if (!state) return [];
    const gates = state.pendingGates ?? [];
    return gates.filter((g) => g.status === "pending");
  }

  async recordGateDecision(
    runId: string,
    actionType: string,
    riskLevel: string,
    decision: GateDecision,
    reason?: string,
    autoApproved?: boolean,
  ): Promise<void> {
    const state = await this.loadWorkflowState(runId);
    if (!state) return;

    const nowStr = now();
    const historyEntry: ApprovalHistoryEntry = {
      id: `hist_${Date.now()}_${randomUUID().slice(0, 8)}`,
      actionType,
      riskLevel,
      decision,
      reason,
      autoApproved: autoApproved ?? false,
      createdAt: nowStr,
    };

    const updated: WorkflowState = {
      ...state,
      approvalHistory: [...(state.approvalHistory ?? []), historyEntry],
      updatedAt: nowStr,
    };

    await this.saveWorkflowState(updated);
  }

  private async cleanOldSnapshots(runId: string): Promise<void> {
    const snapDir = getSnapshotsDir(this.rootPath, runId);
    try {
      const { readdir, unlink } = await import("node:fs/promises");
      const files = await readdir(snapDir);
      const snapshots = files
        .filter((f) => f.startsWith("workflow-before-"))
        .sort()
        .reverse();

      if (snapshots.length > MAX_SNAPSHOTS) {
        for (const old of snapshots.slice(MAX_SNAPSHOTS)) {
          await unlink(path.join(snapDir, old));
        }
      }
    } catch {
      // snapshot dir may not exist yet
    }
  }
}
