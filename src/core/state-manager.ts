import {
  type ProjectState,
  type RunState,
  ProjectStateSchema,
  RunStateSchema,
} from "../schemas/state.schema.js";
import { fileExists, readJsonFile, atomicWriteJsonFile } from "../utils/fs.js";
import { stateJsonPath, runStateJsonPath } from "../utils/paths.js";
import { now } from "../utils/time.js";

export class StateManager {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
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
  }
}
