import { type FlowTaskConfig } from "../schemas/config.schema.js";
import { type WorkflowFile } from "../schemas/workflow.schema.js";
import { type Task } from "../schemas/task.schema.js";
import { type PlannerResult } from "../planner/planner.js";
import { PlannerRegistry } from "../planner/planner-registry.js";
import { RunManager } from "./run-manager.js";
import { EventStore } from "./event-store.js";
import { WorkflowManager } from "./workflow-manager.js";
import { generateTaskId } from "../utils/ids.js";
import { now } from "../utils/time.js";

export type ReplanStrategy = "keep-completed" | "keep-all" | "replace-all";

export interface ReplanResult {
  workflow: WorkflowFile;
  changes: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  strategy: ReplanStrategy;
}

export class WorkflowReplanner {
  constructor(
    private rootPath: string,
    private config: FlowTaskConfig,
    private runManager: RunManager,
    private eventStore: EventStore,
    private workflowManager: WorkflowManager,
  ) {}

  async replan(
    runId: string,
    options: {
      strategy?: ReplanStrategy;
      provider?: string;
      model?: string;
    } = {},
  ): Promise<ReplanResult> {
    const strategy = options.strategy ?? "keep-completed";

    const run = await this.runManager.loadRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    if (run.status === "completed") {
      throw new Error("Cannot replan a completed run");
    }

    const prompt = await this.runManager.loadPrompt(runId);
    const rulesContext = await this.runManager.loadRulesContext(runId);
    const existingTasks = await this.runManager.loadTasks(runId);

    const plannerPrompt = this.buildReplanPrompt(prompt, existingTasks);

    const plannerConfig = { ...this.config.planner };
    if (options.provider) {
      plannerConfig.provider = options.provider;
    }
    if (options.model) {
      plannerConfig.model = options.model;
    }

    const configWithOverrides: FlowTaskConfig = {
      ...this.config,
      planner: plannerConfig,
    };

    const registry = new PlannerRegistry(configWithOverrides);
    const { planner } = registry.getPlanner("ai");

    const planResult: PlannerResult = await planner.createPlan({
      projectRoot: this.rootPath,
      prompt: plannerPrompt,
      rulesContext,
      runId,
    });

    const newPlan: WorkflowFile = {
      runTitle: planResult.title,
      tasks: planResult.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        executor: t.executor === "shell" ? undefined : t.executor,
        dependsOn: t.dependsOn,
        acceptanceCriteria: t.acceptanceCriteria,
        validation: t.validation
          ? {
              commands: t.validation.commands,
              requiredFiles: t.validation.requiredFiles,
              requiredContent: t.validation.requiredContent,
              requiredArtifacts: t.validation.requiredArtifacts,
              requireGitDiff: t.validation.requireGitDiff,
            }
          : undefined,
        maxRetries: t.maxRetries !== 2 ? t.maxRetries : undefined,
      })),
    };

    const merged = await this.mergeWithExisting(existingTasks, newPlan, strategy);

    await this.eventStore.appendToRun(runId, {
      type: "workflow_replanned",
      message: `Workflow replanned with strategy: ${strategy}`,
      details: {
        strategy,
        aiTasks: planResult.tasks.length,
        mergedTasks: merged.workflow.tasks.length,
      },
    });

    return merged;
  }

  private buildReplanPrompt(originalPrompt: string, existingTasks: Task[]): string {
    const parts: string[] = [];

    parts.push("## Original User Request");
    parts.push(originalPrompt);
    parts.push("");

    parts.push("## Existing Workflow Context");
    parts.push("This run already has an existing task plan. You are replanning it.");
    parts.push("");

    const done = existingTasks.filter((t) => t.status === "done" || t.status === "skipped");
    const failed = existingTasks.filter((t) => t.status === "failed" || t.status === "interrupted");
    const pending = existingTasks.filter(
      (t) => t.status === "pending" || t.status === "blocked" || t.status === "cancelled",
    );

    if (done.length > 0) {
      parts.push(`### Completed Tasks (${done.length}) — must be KEPT as-is`);
      parts.push("These tasks are already done. Do NOT regenerate them.");
      parts.push("");
      for (const t of done) {
        parts.push(`- ${t.id}: ${t.title} [DONE]`);
      }
      parts.push("");
    }

    if (failed.length > 0) {
      parts.push(`### Failed/Interrupted Tasks (${failed.length}) — needs REPLAN`);
      parts.push("These tasks failed or were interrupted. Please regenerate them.");
      parts.push("");
      for (const t of failed) {
        parts.push(`- ${t.id}: ${t.title} [NEEDS_REPLAN]`);
        if (t.description) parts.push(`  Description: ${t.description}`);
      }
      parts.push("");
    }

    if (pending.length > 0) {
      parts.push(`### Pending Tasks (${pending.length}) — may be REPLANNED`);
      parts.push("These tasks are not yet started. You can keep, modify, or replace them.");
      parts.push("");
      for (const t of pending) {
        parts.push(`- ${t.id}: ${t.title} [PENDING]`);
      }
      parts.push("");
    }

    parts.push("## Replanning Instructions");
    parts.push("- Keep completed tasks AS-IS (they are already done).");
    parts.push("- Replace failed/pending tasks with improved versions if needed.");
    parts.push("- Add new tasks if the original prompt requires more work.");
    parts.push("- Maintain proper task ordering and dependencies.");
    parts.push("- Return a complete plan that includes kept tasks AND new/replacement tasks.");
    parts.push("- Use the same task IDs for tasks you want to keep.");
    parts.push("- Use new task IDs for newly generated tasks.");
    parts.push("- Maximum 20 tasks per run.");

    return parts.join("\n");
  }

  async mergeWithExisting(
    existingTasks: Task[],
    newPlan: WorkflowFile,
    strategy: ReplanStrategy,
  ): Promise<ReplanResult> {
    const timestamp = now();

    if (strategy === "replace-all") {
      const merged: Task[] = [];
      for (const t of existingTasks) {
        if (t.status === "running") {
          merged.push({ ...t, status: "interrupted", updatedAt: timestamp });
        }
      }

      const idMap = new Map(newPlan.tasks.map((t) => [t.title, t.id]));

      for (const nt of newPlan.tasks) {
        const depIds = (nt.dependsOn ?? []).map((dep) => {
          return idMap.get(dep) ?? dep;
        });

        merged.push({
          id: nt.id,
          runId: existingTasks[0]?.runId ?? "",
          title: nt.title,
          description: nt.description,
          status: "pending",
          executor: nt.executor ?? "shell",
          dependsOn: depIds,
          acceptanceCriteria: nt.acceptanceCriteria ?? [],
          validation: nt.validation
            ? {
                commands: nt.validation.commands,
                requiredFiles: nt.validation.requiredFiles,
                requiredContent: nt.validation.requiredContent,
                requiredArtifacts: nt.validation.requiredArtifacts,
                requireGitDiff: nt.validation.requireGitDiff,
              }
            : undefined,
          retryCount: 0,
          maxRetries: nt.maxRetries ?? 2,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      const skippedExisting = existingTasks.filter((t) => t.status === "running");
      const workflow: WorkflowFile = {
        runTitle: newPlan.runTitle,
        tasks: newPlan.tasks,
      };
      for (const s of skippedExisting) {
        workflow.tasks.push({
          id: s.id,
          title: s.title,
          description: s.description,
          executor: s.executor === "shell" ? undefined : s.executor,
          dependsOn: s.dependsOn,
          acceptanceCriteria: s.acceptanceCriteria,
          maxRetries: s.maxRetries !== 2 ? s.maxRetries : undefined,
        });
      }

      return {
        workflow,
        changes: {
          added: merged.length - existingTasks.filter((t) => t.status !== "running").length,
          removed: existingTasks.filter((t) => t.status !== "running").length,
          modified: 0,
          unchanged: skippedExisting.length,
        },
        strategy,
      };
    }

    if (strategy === "keep-all") {
      const existingTitles = new Set(existingTasks.map((t) => t.title.toLowerCase()));
      const newReplanTasks: Task[] = [];

      for (const nt of newPlan.tasks) {
        if (existingTitles.has(nt.title.toLowerCase())) continue;

        newReplanTasks.push({
          id: nt.id,
          runId: existingTasks[0]?.runId ?? "",
          title: nt.title,
          description: nt.description,
          status: "pending",
          executor: nt.executor ?? "shell",
          dependsOn: nt.dependsOn ?? [],
          acceptanceCriteria: nt.acceptanceCriteria ?? [],
          validation: nt.validation
            ? {
                commands: nt.validation.commands,
                requiredFiles: nt.validation.requiredFiles,
                requiredContent: nt.validation.requiredContent,
                requiredArtifacts: nt.validation.requiredArtifacts,
                requireGitDiff: nt.validation.requireGitDiff,
              }
            : undefined,
          retryCount: 0,
          maxRetries: nt.maxRetries ?? 2,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      return {
        workflow: {
          runTitle: newPlan.runTitle,
          tasks: existingTasks
            .map((t) => ({
              id: t.id,
              title: t.title,
              description: t.description,
              executor: t.executor === "shell" ? undefined : t.executor,
              dependsOn: t.dependsOn,
              acceptanceCriteria: t.acceptanceCriteria,
              maxRetries: t.maxRetries !== 2 ? t.maxRetries : undefined,
            }))
            .concat(
              newReplanTasks.map((t) => ({
                id: t.id,
                title: t.title,
                description: t.description,
                executor: t.executor === "shell" ? undefined : t.executor,
                dependsOn: t.dependsOn,
                acceptanceCriteria: t.acceptanceCriteria,
                maxRetries: t.maxRetries !== 2 ? t.maxRetries : undefined,
              })),
            ),
        },
        changes: {
          added: newReplanTasks.length,
          removed: 0,
          modified: 0,
          unchanged: existingTasks.length,
        },
        strategy,
      };
    }

    const existingDone = existingTasks.filter((t) => t.status === "done" || t.status === "skipped");
    const existingFailed = existingTasks.filter(
      (t) => t.status === "failed" || t.status === "interrupted",
    );
    const existingPending = existingTasks.filter(
      (t) => t.status === "pending" || t.status === "blocked" || t.status === "cancelled",
    );

    const merged: Task[] = [...existingDone];

    const newPlanTitles = new Map(newPlan.tasks.map((t) => [t.title.toLowerCase(), t]));

    let modifiedCount = 0;
    let removedCount = 0;
    let addedCount = 0;

    const allExistingForDepCheck = [...existingDone, ...existingFailed, ...existingPending];
    const existingIdByTitle = new Map(
      allExistingForDepCheck.map((t) => [t.title.toLowerCase(), t.id]),
    );
    const usedIds = new Set(allExistingForDepCheck.map((t) => t.id));
    const usedTitlesFromNew = new Set<string>();

    for (const ee of existingFailed) {
      const matchingNew = newPlanTitles.get(ee.title.toLowerCase());
      if (matchingNew) {
        const depIds = (matchingNew.dependsOn ?? []).map((dep) => {
          const lower = dep.toLowerCase();
          return existingIdByTitle.get(lower) ?? dep;
        });
        merged.push({
          ...ee,
          title: matchingNew.title,
          description: matchingNew.description ?? ee.description,
          executor: matchingNew.executor ?? ee.executor,
          dependsOn: depIds,
          acceptanceCriteria: matchingNew.acceptanceCriteria ?? ee.acceptanceCriteria,
          validation: matchingNew.validation
            ? {
                commands: matchingNew.validation.commands,
                requiredFiles: matchingNew.validation.requiredFiles,
                requiredContent: matchingNew.validation.requiredContent,
                requiredArtifacts: matchingNew.validation.requiredArtifacts,
                requireGitDiff: matchingNew.validation.requireGitDiff,
              }
            : ee.validation,
          maxRetries: matchingNew.maxRetries ?? ee.maxRetries,
          status: "pending",
          retryCount: 0,
          updatedAt: timestamp,
        });
        usedIds.add(ee.id);
        usedTitlesFromNew.add(ee.title.toLowerCase());
        modifiedCount++;
      } else {
        merged.push({ ...ee, status: "pending", retryCount: 0, updatedAt: timestamp });
        removedCount++;
      }
    }

    for (const ep of existingPending) {
      const matchingNew = newPlanTitles.get(ep.title.toLowerCase());
      if (matchingNew) {
        const depIds = (matchingNew.dependsOn ?? []).map((dep) => {
          const lower = dep.toLowerCase();
          return existingIdByTitle.get(lower) ?? dep;
        });
        merged.push({
          ...ep,
          title: matchingNew.title,
          description: matchingNew.description ?? ep.description,
          executor: matchingNew.executor ?? ep.executor,
          dependsOn: depIds,
          acceptanceCriteria: matchingNew.acceptanceCriteria ?? ep.acceptanceCriteria,
          validation: matchingNew.validation
            ? {
                commands: matchingNew.validation.commands,
                requiredFiles: matchingNew.validation.requiredFiles,
                requiredContent: matchingNew.validation.requiredContent,
                requiredArtifacts: matchingNew.validation.requiredArtifacts,
                requireGitDiff: matchingNew.validation.requireGitDiff,
              }
            : ep.validation,
          maxRetries: matchingNew.maxRetries ?? ep.maxRetries,
          updatedAt: timestamp,
        });
        usedIds.add(ep.id);
        usedTitlesFromNew.add(ep.title.toLowerCase());
        modifiedCount++;
      } else {
        merged.push({ ...ep, updatedAt: timestamp });
        removedCount++;
      }
    }

    for (const nt of newPlan.tasks) {
      if (usedTitlesFromNew.has(nt.title.toLowerCase())) continue;

      const newId = generateTaskId();
      const depIds = (nt.dependsOn ?? []).map((dep) => {
        const lower = dep.toLowerCase();
        return existingIdByTitle.get(lower) ?? newPlanTitles.get(lower)?.id ?? dep;
      });

      merged.push({
        id: newId,
        runId: existingTasks[0]?.runId ?? "",
        title: nt.title,
        description: nt.description,
        status: "pending",
        executor: nt.executor ?? "shell",
        dependsOn: depIds,
        acceptanceCriteria: nt.acceptanceCriteria ?? [],
        validation: nt.validation
          ? {
              commands: nt.validation.commands,
              requiredFiles: nt.validation.requiredFiles,
              requiredContent: nt.validation.requiredContent,
              requiredArtifacts: nt.validation.requiredArtifacts,
              requireGitDiff: nt.validation.requireGitDiff,
            }
          : undefined,
        retryCount: 0,
        maxRetries: nt.maxRetries ?? 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      addedCount++;
    }

    return {
      workflow: {
        runTitle: newPlan.runTitle,
        tasks: merged.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          executor: t.executor === "shell" ? undefined : t.executor,
          dependsOn: t.dependsOn,
          acceptanceCriteria: t.acceptanceCriteria,
          maxRetries: t.maxRetries !== 2 ? t.maxRetries : undefined,
        })),
      },
      changes: {
        added: addedCount,
        removed: removedCount,
        modified: modifiedCount,
        unchanged: existingDone.length,
      },
      strategy,
    };
  }
}
