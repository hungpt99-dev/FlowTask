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
import { writeTextFile, readTextFile } from "../utils/fs.js";
import { getSnapshotsDir } from "../utils/paths.js";
import { now } from "../utils/time.js";
import { generateTaskId } from "../utils/ids.js";
import { RunManager } from "./run-manager.js";
import { EventStore } from "./event-store.js";

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
