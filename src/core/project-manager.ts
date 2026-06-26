import path from "node:path";
import { type Project, ProjectSchema } from "../schemas/project.schema.js";
import { type FlowTaskConfig, ProjectModeSchema } from "../schemas/config.schema.js";
import { type ProjectState, ProjectStateSchema } from "../schemas/state.schema.js";
import { fileExists, atomicWriteJsonFile, readJsonFile, ensureDir } from "../utils/fs.js";
import {
  projectJsonPath,
  configJsonPath,
  stateJsonPath,
  runIndexPath,
  taskIndexPath,
  RULES_DIR,
  STEPS_DIR,
  FLOWTASK_DIR,
} from "../utils/paths.js";
import { now } from "../utils/time.js";
import { generateProjectId } from "../utils/ids.js";
import { generateDefaultConfig } from "../config/default-config.js";
import { ConfigLoader } from "../config/config-loader.js";
import { type ProjectMode, VALID_PROJECT_MODES } from "../config/project-modes.js";
import { generateModeRules } from "../config/mode-rules.js";
import { generateModeSteps } from "../config/mode-steps.js";

export class ProjectManager {
  async init(rootPath: string, name?: string, mode?: ProjectMode): Promise<Project> {
    const projectId = generateProjectId(name ?? "FlowTask Project");
    const timestamp = now();
    const project: Project = {
      projectId,
      name: name ?? "FlowTask Project",
      rootPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const resolvedMode = mode ?? "development";

    await ensureDir(path.join(rootPath, FLOWTASK_DIR));
    await ensureDir(path.join(rootPath, RULES_DIR));
    await ensureDir(path.join(rootPath, STEPS_DIR));
    await ensureDir(path.join(rootPath, ".flowtask", "runs"));

    await atomicWriteJsonFile(projectJsonPath(rootPath), project);

    const config = generateDefaultConfig();
    config.projectMode = resolvedMode;
    await atomicWriteJsonFile(configJsonPath(rootPath), config);

    await atomicWriteJsonFile(stateJsonPath(rootPath), {
      projectId,
      status: "idle",
      updatedAt: timestamp,
    } satisfies ProjectState);
    await atomicWriteJsonFile(runIndexPath(rootPath), { projectId, runs: [] });
    await atomicWriteJsonFile(taskIndexPath(rootPath), { projectId, tasks: [] });

    const rulesDir = path.join(rootPath, RULES_DIR);
    const defaultRules = {
      "project.md": "# Project Rules\n\nFlowTask manages one project at a time.",
      "workflow.md": "# Workflow Rules\n\nTasks execute sequentially by default.",
    };

    for (const [fileName, content] of Object.entries(defaultRules)) {
      const rulePath = path.join(rulesDir, fileName);
      if (!(await fileExists(rulePath))) {
        const { writeTextFile } = await import("../utils/fs.js");
        await writeTextFile(rulePath, content);
      }
    }

    const modeRulePath = path.join(rulesDir, "mode.md");
    if (!(await fileExists(modeRulePath))) {
      const { writeTextFile } = await import("../utils/fs.js");
      await writeTextFile(modeRulePath, generateModeRules(resolvedMode));
    }

    const stepsDir = path.join(rootPath, STEPS_DIR);
    const stepsPath = path.join(stepsDir, "default.md");
    if (!(await fileExists(stepsPath))) {
      const { writeTextFile } = await import("../utils/fs.js");
      await writeTextFile(stepsPath, generateModeSteps(resolvedMode));
    }

    return project;
  }

  async load(rootPath: string): Promise<Project | null> {
    const pPath = projectJsonPath(rootPath);
    const exists = await fileExists(pPath);
    if (!exists) return null;
    try {
      const raw = await readJsonFile<Record<string, unknown>>(pPath);
      const result = ProjectSchema.safeParse(raw);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  async loadState(rootPath: string): Promise<ProjectState | null> {
    const sPath = stateJsonPath(rootPath);
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

  async saveState(rootPath: string, state: ProjectState): Promise<void> {
    await atomicWriteJsonFile(stateJsonPath(rootPath), {
      ...state,
      updatedAt: now(),
    });
  }

  async loadConfig(rootPath: string): Promise<FlowTaskConfig> {
    const loader = new ConfigLoader();
    return loader.load(rootPath);
  }

  async isInitialized(rootPath: string): Promise<boolean> {
    const project = await this.load(rootPath);
    return project !== null;
  }
}

export async function requireProject(
  rootPath: string,
): Promise<{ project: Project; config: FlowTaskConfig }> {
  const manager = new ProjectManager();
  const project = await manager.load(rootPath);
  if (!project) {
    const { ProjectNotInitializedError } = await import("../utils/errors.js");
    throw new ProjectNotInitializedError(rootPath);
  }
  const config = await manager.loadConfig(rootPath);
  return { project, config };
}
