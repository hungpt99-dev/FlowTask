import {
  type ProjectState,
  type RunState,
  ProjectStateSchema,
  RunStateSchema,
} from "../schemas/state.schema.js";
import { fileExists, readJsonFile, atomicWriteJsonFile } from "../utils/fs.js";
import { stateJsonPath, runStateJsonPath } from "../utils/paths.js";
import { now } from "../utils/time.js";
import type { DatabaseManager } from "./database-manager.js";
import { CheckpointService } from "./checkpoint-service.js";
import type { CheckpointResult } from "./checkpoint-service.js";

export class StateManager {
  private rootPath: string;
  private db: DatabaseManager | null = null;
  private checkpointService: CheckpointService | null = null;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  setDatabase(db: DatabaseManager): void {
    this.db = db;
    this.checkpointService = new CheckpointService(db, this.rootPath);
  }

  async loadProjectState(): Promise<ProjectState | null> {
    const sPath = stateJsonPath(this.rootPath);
    const exists = await fileExists(sPath);
    if (!exists) return null;
    try {
      const raw = await readJsonFile<Record<string, unknown>>(sPath);
      const result = ProjectStateSchema.safeParse(raw);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  async saveProjectState(state: ProjectState): Promise<void> {
    await atomicWriteJsonFile(stateJsonPath(this.rootPath), {
      ...state,
      updatedAt: now(),
    });
  }

  async loadRunState(runId: string): Promise<RunState | null> {
    const rPath = runStateJsonPath(this.rootPath, runId);
    const exists = await fileExists(rPath);
    if (!exists) return null;
    try {
      const raw = await readJsonFile<Record<string, unknown>>(rPath);
      const result = RunStateSchema.safeParse(raw);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  async saveRunState(runId: string, state: RunState): Promise<void> {
    await atomicWriteJsonFile(runStateJsonPath(this.rootPath, runId), {
      ...state,
      updatedAt: now(),
    });

    if (this.checkpointService) {
      try {
        await this.checkpointService.saveCheckpoint(
          runId,
          {
            runId: state.runId,
            taskId: state.currentTaskId,
            status: state.status,
            progress: state.progress,
          },
          { stateType: "run_state" },
        );
      } catch {
        // Checkpoint is secondary
      }
    }
  }

  async loadResumableState(runId: string): Promise<CheckpointResult | null> {
    if (!this.checkpointService) return null;
    return this.checkpointService.loadLatestCheckpoint(runId);
  }

  async getLatestCheckpoint(runId: string): Promise<CheckpointResult | null> {
    if (!this.checkpointService) return null;
    return this.checkpointService.loadLatestCheckpoint(runId);
  }

  getCheckpointService(): CheckpointService | null {
    return this.checkpointService;
  }
}
