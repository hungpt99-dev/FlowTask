import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseManager } from "./database-manager.js";
import type { CheckpointRecord, CheckpointStateType } from "../schemas/checkpoint.schema.js";
import { ensureDir, fileExists, writeTextFile, readTextFile } from "../utils/fs.js";
import { getSnapshotsDir } from "../utils/paths.js";
import { now } from "../utils/time.js";

const SNAPSHOT_THRESHOLD_BYTES = 1024;

export interface CheckpointState {
  runId: string;
  taskId?: string;
  stepId?: string;
  status: string;
  progress?: {
    total: number;
    done: number;
    running: number;
    failed: number;
    pending: number;
  };
  [key: string]: unknown;
}

export interface CheckpointResult {
  checkpoint: CheckpointRecord;
  state: CheckpointState;
  fromSnapshot: boolean;
}

export class CheckpointService {
  private db: DatabaseManager;
  private rootPath: string;

  constructor(db: DatabaseManager, rootPath: string) {
    this.db = db;
    this.rootPath = rootPath;
  }

  async saveCheckpoint(
    runId: string,
    state: CheckpointState,
    options?: {
      taskId?: string;
      stepId?: string;
      stateType?: CheckpointStateType;
    },
  ): Promise<CheckpointRecord> {
    const checkpointId = this.generateCheckpointId();
    const stateJson = JSON.stringify(state);
    const stateBytes = Buffer.byteLength(stateJson, "utf-8");
    const shouldSnapshot = stateBytes > SNAPSHOT_THRESHOLD_BYTES;
    const stateType = options?.stateType ?? "run_state";

    let isSnapshot = false;
    let snapshotPath: string | undefined;
    let snapshotSize: number | undefined;
    let snapshotHash: string | undefined;

    if (shouldSnapshot) {
      snapshotPath = path.join(getSnapshotsDir(this.rootPath, runId), `${checkpointId}.json`);
      snapshotSize = stateBytes;
      snapshotHash = crypto.createHash("sha256").update(stateJson).digest("hex");

      await ensureDir(path.dirname(snapshotPath));
      await writeTextFile(snapshotPath, stateJson);

      isSnapshot = true;
    }

    const record: CheckpointRecord = {
      checkpointId,
      runId,
      taskId: options?.taskId ?? state.taskId,
      stepId: options?.stepId ?? state.stepId,
      stateType,
      stateData: shouldSnapshot
        ? JSON.stringify({ ref: snapshotPath, hash: snapshotHash })
        : stateJson,
      isSnapshot,
      snapshotPath,
      snapshotSize,
      snapshotHash,
      createdAt: now(),
    };

    this.db.insertCheckpoint(record);
    return record;
  }

  async loadLatestCheckpoint(runId: string): Promise<CheckpointResult | null> {
    const record = this.db.getLatestCheckpoint(runId);
    if (!record) return null;

    if (record.isSnapshot && record.snapshotPath) {
      const exists = await fileExists(record.snapshotPath);
      if (!exists) return null;
      const content = await readTextFile(record.snapshotPath);
      const state = JSON.parse(content) as CheckpointState;
      return { checkpoint: record, state, fromSnapshot: true };
    }

    const state = JSON.parse(record.stateData) as CheckpointState;
    return { checkpoint: record, state, fromSnapshot: false };
  }

  getCheckpoints(runId: string): CheckpointRecord[] {
    return this.db.getCheckpointsByRun(runId);
  }

  cleanOldCheckpoints(runId: string, keepCount = 5): void {
    const records = this.db.getCheckpointsByRun(runId);
    if (records.length <= keepCount) return;

    const toRemove = records.slice(keepCount);
    for (const rec of toRemove) {
      if (rec.snapshotPath) {
        try {
          fs.unlinkSync(rec.snapshotPath);
        } catch {
          // ignore
        }
      }
    }

    this.db.cleanCheckpoints(runId, true, true);
  }

  private generateCheckpointId(): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z/, "");
    const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    return `chk_${timestamp}_${hex}`;
  }
}
