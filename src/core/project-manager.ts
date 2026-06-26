import path from "node:path";
import { type Project, ProjectSchema } from "../schemas/project.schema.js";
import { type FlowTaskConfig } from "../schemas/config.schema.js";
import { type ProjectState, ProjectStateSchema } from "../schemas/state.schema.js";
import { fileExists, atomicWriteJsonFile, readJsonFile, ensureDir } from "../utils/fs.js";
import {
  projectJsonPath,
  configJsonPath,
  stateJsonPath,
  runIndexPath,
  taskIndexPath,
  RULES_DIR,
  FLOWTASK_DIR,
} from "../utils/paths.js";
import { now } from "../utils/time.js";
import { generateProjectId } from "../utils/ids.js";
import { generateDefaultConfig } from "../config/default-config.js";
import { ConfigLoader } from "../config/config-loader.js";

export class ProjectManager {
  async init(rootPath: string, name?: string): Promise<Project> {
    const projectId = generateProjectId(name ?? "FlowTask Project");
    const timestamp = now();
    const project: Project = {
      projectId,
      name: name ?? "FlowTask Project",
      rootPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await ensureDir(path.join(rootPath, FLOWTASK_DIR));
    await ensureDir(path.join(rootPath, RULES_DIR));
    await ensureDir(path.join(rootPath, ".flowtask", "runs"));

    await atomicWriteJsonFile(projectJsonPath(rootPath), project);
    await atomicWriteJsonFile(configJsonPath(rootPath), generateDefaultConfig());
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
      "coding.md": "# Coding Rules\n\nFollow existing project structure. TypeScript strict mode.",
      "testing.md": "# Testing Rules\n\nWrite tests for all new code.",
      "security.md": "# Security Rules\n\nNever print secrets. Block dangerous commands.",
      "output.md": "# Output Rules\n\nEvery run must generate a final report.",
    };

    for (const [fileName, content] of Object.entries(defaultRules)) {
      const rulePath = path.join(rulesDir, fileName);
      if (!(await fileExists(rulePath))) {
        const { writeTextFile } = await import("../utils/fs.js");
        await writeTextFile(rulePath, content);
      }
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
