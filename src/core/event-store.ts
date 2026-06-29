import path from "node:path";
import {
  FlowTaskEventSchema,
  type FlowTaskEvent,
  AuditEventSchema,
} from "../schemas/event.schema.js";
import type { AuditEvent, AuditAction } from "../schemas/event.schema.js";
import {
  TimelineEventSchema,
  type TimelineEvent,
  type TimelineEventType,
  type RunStatus,
} from "../schemas/run.schema.js";
import { ensureDir, appendToFile, readTextFile, readDir } from "../utils/fs.js";
import { eventsJsonlPath, timelineJsonlPath, auditJsonlPath, getRunDir } from "../utils/paths.js";
import { now } from "../utils/time.js";
import type { DatabaseManager } from "./database-manager.js";
import { getEventBus } from "../ui/event-bus.js";
import type { UiEvent } from "../ui/event-bus.js";

export interface TimelineFilter {
  types?: TimelineEventType[];
  taskId?: string;
  stepId?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

export interface AuditFilter {
  actions?: AuditAction[];
  actor?: string;
  target?: string;
  severity?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

export interface RunStatusSummary {
  runId: string;
  status: RunStatus;
  stepCount: number;
  stepCompleted: number;
  stepFailed: number;
  stepSkipped: number;
  stepPending: number;
  stepRunning: number;
  validationPassed: number;
  validationFailed: number;
  totalErrors: number;
  totalRetries: number;
  lastEvent: string;
  lastEventTime: string;
  duration: number | undefined;
  hasBlockedSteps: boolean;
  hasStuckSteps: boolean;
  currentStep: string | undefined;
}

export interface StepProgress {
  runId: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  running: number;
  blocked: number;
  needsReview: number;
  percentage: number;
}

export class EventStore {
  private rootPath: string;
  private db: DatabaseManager | null = null;
  private watchers: Map<string, Set<(event: FlowTaskEvent) => void>> = new Map();
  private activeRuns: Set<string> = new Set();

  constructor(rootPath: string, db?: DatabaseManager) {
    this.rootPath = rootPath;
    this.db = db ?? null;
  }

  setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  // ── Existing FlowTask Event Methods ────────────────────

  async appendToRun(runId: string, event: Omit<FlowTaskEvent, "time">): Promise<void> {
    const eventPath = eventsJsonlPath(this.rootPath, runId);
    await ensureDir(getRunDir(this.rootPath, runId));
    const fullEvent: FlowTaskEvent = { ...event, time: now() };
    await appendToFile(eventPath, `${JSON.stringify(fullEvent)}\n`);

    if (this.db) {
      try {
        this.db.insertEvent(fullEvent);
      } catch {
        // DB write is secondary; JSONL is source of truth
      }
    }

    this.notifyWatchers(runId, fullEvent);
  }

  async readRunEvents(runId: string): Promise<FlowTaskEvent[]> {
    return this.readEventsFromPath<FlowTaskEvent>(
      eventsJsonlPath(this.rootPath, runId),
      FlowTaskEventSchema,
    );
  }

  async readRunEventsPaginated(runId: string, limit = 50, offset = 0): Promise<FlowTaskEvent[]> {
    const all = await this.readRunEvents(runId);
    return all.slice(offset, offset + limit);
  }

  async countRunEvents(runId: string): Promise<number> {
    const all = await this.readRunEvents(runId);
    return all.length;
  }

  async getEventsByType(runId: string, type: string): Promise<FlowTaskEvent[]> {
    const all = await this.readRunEvents(runId);
    return all.filter((e) => e.type === type);
  }

  async getEventsByTask(runId: string, taskId: string): Promise<FlowTaskEvent[]> {
    const all = await this.readRunEvents(runId);
    return all.filter((e) => e.taskId === taskId);
  }

  async searchEvents(runId: string, query: string): Promise<FlowTaskEvent[]> {
    const all = await this.readRunEvents(runId);
    const q = query.toLowerCase();
    return all.filter((e) => e.message?.toLowerCase().includes(q) ?? false);
  }

  async appendGlobal(event: Omit<FlowTaskEvent, "time">): Promise<void> {
    const eventPath = path.join(this.rootPath, ".flowtask", "events.jsonl");
    const fullEvent: FlowTaskEvent = { ...event, time: now() };
    await appendToFile(eventPath, `${JSON.stringify(fullEvent)}\n`);

    if (this.db) {
      try {
        this.db.insertEvent(fullEvent);
      } catch {
        // DB write is secondary
      }
    }
  }

  async rotateGlobalEvents(maxEvents?: number): Promise<void> {
    const eventPath = path.join(this.rootPath, ".flowtask", "events.jsonl");
    const limit = maxEvents ?? 1000;
    try {
      const content = await readTextFile(eventPath);
      const lines = content.split("\n").filter(Boolean);
      if (lines.length <= limit) return;
      const rotated = lines.slice(lines.length - limit);
      const { writeTextFile } = await import("../utils/fs.js");
      await writeTextFile(eventPath, rotated.join("\n") + "\n");
    } catch {
      // non-critical
    }
  }

  queryEvents(runId?: string, type?: string, limit?: number): FlowTaskEvent[] {
    if (!this.db) return [];
    try {
      return this.db.queryEvents(runId, type, limit);
    } catch {
      return [];
    }
  }

  // ── Timeline Management ────────────────────────────────

  async appendTimeline(
    runId: string,
    type: TimelineEventType,
    message?: string,
    details?: Record<string, unknown>,
    taskId?: string,
    stepId?: string,
    status?: string,
  ): Promise<TimelineEvent> {
    const tPath = timelineJsonlPath(this.rootPath, runId);
    await ensureDir(getRunDir(this.rootPath, runId));
    const event: TimelineEvent = {
      type,
      timestamp: now(),
      runId,
      taskId,
      stepId,
      status,
      message,
      details,
    };
    await appendToFile(tPath, `${JSON.stringify(event)}\n`);
    return event;
  }

  async getTimeline(runId: string, filter?: TimelineFilter): Promise<TimelineEvent[]> {
    const all = await this.readTimelineFile(runId);
    if (!filter) return all;

    let filtered = all;

    if (filter.types && filter.types.length > 0) {
      filtered = filtered.filter((e) => filter.types!.includes(e.type as TimelineEventType));
    }

    if (filter.taskId) {
      filtered = filtered.filter((e) => e.taskId === filter.taskId);
    }

    if (filter.stepId) {
      filtered = filtered.filter((e) => e.stepId === filter.stepId);
    }

    if (filter.startTime) {
      filtered = filtered.filter((e) => e.timestamp >= filter.startTime!);
    }

    if (filter.endTime) {
      filtered = filtered.filter((e) => e.timestamp <= filter.endTime!);
    }

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return filtered.slice(offset, offset + limit);
  }

  async searchTimeline(runId: string, query: string): Promise<TimelineEvent[]> {
    const all = await this.readTimelineFile(runId);
    const q = query.toLowerCase();
    return all.filter(
      (e) =>
        e.message?.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.status?.toLowerCase().includes(q),
    );
  }

  async getTimelineSummary(runId: string): Promise<{
    total: number;
    byType: Record<string, number>;
    firstEvent: TimelineEvent | null;
    lastEvent: TimelineEvent | null;
  }> {
    const all = await this.readTimelineFile(runId);
    const byType: Record<string, number> = {};
    for (const e of all) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    return {
      total: all.length,
      byType,
      firstEvent: all[0] ?? null,
      lastEvent: all[all.length - 1] ?? null,
    };
  }

  // ── Audit Log ──────────────────────────────────────────

  async appendAudit(
    runId: string,
    action: AuditAction,
    message?: string,
    details?: Record<string, unknown>,
    actor?: string,
    target?: string,
    severity: AuditEvent["severity"] = "info",
    taskId?: string,
    stepId?: string,
  ): Promise<AuditEvent> {
    const aPath = auditJsonlPath(this.rootPath, runId);
    await ensureDir(getRunDir(this.rootPath, runId));
    const event: AuditEvent = {
      time: now(),
      action,
      runId,
      taskId,
      stepId,
      actor,
      target,
      message,
      details,
      severity,
    };
    await appendToFile(aPath, `${JSON.stringify(event)}\n`);
    return event;
  }

  async getAuditLog(runId: string, filter?: AuditFilter): Promise<AuditEvent[]> {
    const all = await this.readAuditFile(runId);
    if (!filter) return all;

    let filtered = all;

    if (filter.actions && filter.actions.length > 0) {
      filtered = filtered.filter((e) => filter.actions!.includes(e.action));
    }

    if (filter.actor) {
      filtered = filtered.filter((e) => e.actor === filter.actor);
    }

    if (filter.target) {
      filtered = filtered.filter((e) => e.target === filter.target);
    }

    if (filter.severity) {
      filtered = filtered.filter((e) => e.severity === filter.severity);
    }

    if (filter.startTime) {
      filtered = filtered.filter((e) => e.time >= filter.startTime!);
    }

    if (filter.endTime) {
      filtered = filtered.filter((e) => e.time <= filter.endTime!);
    }

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return filtered.slice(offset, offset + limit);
  }

  async searchAuditLog(runId: string, query: string): Promise<AuditEvent[]> {
    const all = await this.readAuditFile(runId);
    const q = query.toLowerCase();
    return all.filter(
      (e) =>
        e.message?.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        e.actor?.toLowerCase().includes(q) ||
        e.target?.toLowerCase().includes(q),
    );
  }

  async getAuditSummary(runId: string): Promise<{
    total: number;
    byAction: Record<string, number>;
    bySeverity: Record<string, number>;
    errors: number;
    warnings: number;
    firstEvent: AuditEvent | null;
    lastEvent: AuditEvent | null;
  }> {
    const all = await this.readAuditFile(runId);
    const byAction: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let errors = 0;
    let warnings = 0;
    for (const e of all) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
      if (e.severity === "error") errors++;
      if (e.severity === "warn") warnings++;
    }
    return {
      total: all.length,
      byAction,
      bySeverity,
      errors,
      warnings,
      firstEvent: all[0] ?? null,
      lastEvent: all[all.length - 1] ?? null,
    };
  }

  // ── Real-Time Visibility ───────────────────────────────

  markRunActive(runId: string): void {
    this.activeRuns.add(runId);
  }

  markRunInactive(runId: string): void {
    this.activeRuns.delete(runId);
  }

  getActiveRuns(): string[] {
    return [...this.activeRuns];
  }

  isRunActive(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  subscribeToRun(runId: string, callback: (event: FlowTaskEvent) => void): () => void {
    if (!this.watchers.has(runId)) {
      this.watchers.set(runId, new Set());
    }
    this.watchers.get(runId)!.add(callback);
    return () => {
      this.watchers.get(runId)?.delete(callback);
      if (this.watchers.get(runId)?.size === 0) {
        this.watchers.delete(runId);
      }
    };
  }

  private notifyWatchers(runId: string, event: FlowTaskEvent): void {
    const watchers = this.watchers.get(runId);
    if (!watchers) return;
    for (const cb of watchers) {
      try {
        cb(event);
      } catch {
        // watcher error is non-critical
      }
    }
  }

  async getRunStatusSummary(
    runId: string,
    runStatus: RunStatus,
    steps?: { status: string }[],
    events?: FlowTaskEvent[],
    errorCount = 0,
    retryCount = 0,
    startedAt?: string,
  ): Promise<RunStatusSummary> {
    const timelineEvents = events ?? (await this.readRunEvents(runId));
    const stepList = steps ?? [];
    const lastEvt = timelineEvents[timelineEvents.length - 1];

    const stepCompleted = stepList.filter(
      (s) => s.status === "completed" || s.status === "done",
    ).length;
    const stepFailed = stepList.filter((s) => s.status === "failed").length;
    const stepSkipped = stepList.filter((s) => s.status === "skipped").length;
    const stepPending = stepList.filter((s) => s.status === "pending").length;
    const stepRunning = stepList.filter(
      (s) => s.status === "running" || s.status === "started",
    ).length;
    const blocked = stepList.filter((s) => s.status === "blocked").length;
    const stuck = stepList.filter((s) => s.status === "stuck").length;

    const currentStep = stepList.find((s) => s.status === "running" || s.status === "started");

    const validationPassed = timelineEvents.filter((e) => e.type === "validation_passed").length;
    const validationFailed = timelineEvents.filter((e) => e.type === "validation_failed").length;

    return {
      runId,
      status: runStatus,
      stepCount: stepList.length,
      stepCompleted,
      stepFailed,
      stepSkipped,
      stepPending,
      stepRunning,
      validationPassed,
      validationFailed,
      totalErrors: errorCount,
      totalRetries: retryCount,
      lastEvent: lastEvt?.type ?? "none",
      lastEventTime: lastEvt?.time ?? "",
      duration: startedAt ? new Date().getTime() - new Date(startedAt).getTime() : undefined,
      hasBlockedSteps: blocked > 0,
      hasStuckSteps: stuck > 0,
      currentStep: currentStep
        ? ((currentStep as { title?: string }).title ?? undefined)
        : undefined,
    };
  }

  getStepProgress(steps: { status: string }[]): StepProgress {
    const total = steps.length;
    const completed = steps.filter((s) => s.status === "completed" || s.status === "done").length;
    const failed = steps.filter((s) => s.status === "failed").length;
    const skipped = steps.filter((s) => s.status === "skipped").length;
    const pending = steps.filter((s) => s.status === "pending").length;
    const running = steps.filter((s) => s.status === "running" || s.status === "started").length;
    const blocked = steps.filter((s) => s.status === "blocked").length;
    const needsReview = steps.filter((s) => s.status === "needs_user_review").length;

    return {
      runId: "",
      total,
      completed,
      failed,
      skipped,
      pending,
      running,
      blocked,
      needsReview,
      percentage: total > 0 ? Math.round(((completed + skipped) / total) * 100) : 0,
    };
  }

  // ── Cross-Run Queries ──────────────────────────────────

  async listRunsWithTimeline(runIds: string[]): Promise<Map<string, TimelineEvent[]>> {
    const result = new Map<string, TimelineEvent[]>();
    for (const runId of runIds) {
      try {
        const timeline = await this.readTimelineFile(runId);
        result.set(runId, timeline);
      } catch {
        result.set(runId, []);
      }
    }
    return result;
  }

  async listRunsWithAudit(runIds: string[]): Promise<Map<string, AuditEvent[]>> {
    const result = new Map<string, AuditEvent[]>();
    for (const runId of runIds) {
      try {
        const audit = await this.readAuditFile(runId);
        result.set(runId, audit);
      } catch {
        result.set(runId, []);
      }
    }
    return result;
  }

  // ── Event Bus Integration ─────────────────────────────

  createRunEventBusBridge(runId: string): () => void {
    const bus = getEventBus();
    const handler = (uiEvent: UiEvent) => {
      const type = this.uiEventToFlowTaskEventType(uiEvent.type);
      if (!type) return;
      this.appendToRun(runId, {
        type: type as FlowTaskEvent["type"],
        runId,
        message: this.uiEventToMessage(uiEvent),
        details: uiEvent as unknown as Record<string, unknown>,
      }).catch(() => {});
    };
    const unsub = bus.subscribe(handler);
    return unsub;
  }

  private uiEventToFlowTaskEventType(uiType: string): string | null {
    const map: Record<string, string> = {
      run_started: "run_started",
      rules_loaded: "rules_loaded",
      task_started: "task_started",
      executor_started: "executor_started",
      executor_output: "executor_output",
      executor_exited: "executor_exited",
      executor_failed: "executor_failed",
      validation_started: "validation_started",
      validation_passed: "validation_passed",
      validation_failed: "validation_failed",
      validation_skipped: "validation_skipped",
      task_completed: "task_completed",
      task_failed: "task_failed",
      run_completed: "run_completed",
      run_failed: "run_failed",
    };
    return map[uiType] ?? null;
  }

  private uiEventToMessage(event: UiEvent): string | undefined {
    if ("message" in event) return (event as { message?: string }).message;
    if ("reason" in event) return (event as { reason?: string }).reason;
    if ("title" in event) return (event as { title?: string }).title;
    return undefined;
  }

  // ── Private Helpers ────────────────────────────────────

  private async readEventsFromPath<T>(
    filePath: string,
    schema: { safeParse(data: unknown): { success: boolean; data?: T } },
  ): Promise<T[]> {
    try {
      const content = await readTextFile(filePath);
      const results: T[] = [];
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const result = schema.safeParse(parsed);
        if (result.success && result.data) {
          results.push(result.data);
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  private async readTimelineFile(runId: string): Promise<TimelineEvent[]> {
    return this.readEventsFromPath<TimelineEvent>(
      timelineJsonlPath(this.rootPath, runId),
      TimelineEventSchema,
    );
  }

  private async readAuditFile(runId: string): Promise<AuditEvent[]> {
    return this.readEventsFromPath<AuditEvent>(
      auditJsonlPath(this.rootPath, runId),
      AuditEventSchema as unknown as {
        safeParse(data: unknown): { success: boolean; data?: AuditEvent };
      },
    );
  }
}
