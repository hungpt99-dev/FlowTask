import { ProjectManager } from "../../core/project-manager.js";
import { fileExists } from "../../utils/fs.js";
import { FLOWTASK_DIR } from "../../utils/paths.js";
import picocolors from "picocolors";
import path from "node:path";
import {
  type ProjectMode,
  VALID_PROJECT_MODES,
  MODE_DEFINITIONS,
} from "../../config/project-modes.js";

export async function initCommand(options: {
  name?: string;
  force?: boolean;
  mode?: string;
  showModes?: boolean;
}): Promise<void> {
  const rootPath = process.cwd();

  if (options.showModes) {
    console.log(picocolors.cyan("\nAvailable init modes:"));
    console.log("");
    for (const def of MODE_DEFINITIONS) {
      console.log(`  ${picocolors.bold(def.mode.padEnd(14))} ${def.label}`);
      console.log(`  ${"".padEnd(16)}${picocolors.dim(def.description)}`);
      console.log("");
    }
    return;
  }

  const flowtaskDir = path.join(rootPath, FLOWTASK_DIR);
  const alreadyInit = await fileExists(path.join(flowtaskDir, "project.json"));

  if (alreadyInit && !options.force) {
    console.log(picocolors.yellow("FlowTask already initialized in this directory."));
    console.log(picocolors.dim("Use --force to reinitialize."));
    process.exit(0);
  }

  let mode: ProjectMode;

  if (options.mode) {
    const lower = options.mode.toLowerCase();
    if (!VALID_PROJECT_MODES.includes(lower as ProjectMode)) {
      console.log(picocolors.red(`\nUnknown init mode: ${options.mode}\n`));
      console.log(picocolors.cyan("Available modes:"));
      for (const m of VALID_PROJECT_MODES) {
        console.log(`  ${m}`);
      }
      console.log("");
      process.exit(1);
    }
    mode = lower as ProjectMode;
  } else if (process.stdin.isTTY) {
    const m = await import("enquirer");
    const Enquirer = m.default ?? m;
    const enquirer = new (Enquirer as unknown as new () => {
      prompt: (opts: unknown) => Promise<Record<string, unknown>>;
    })();
    const response = await enquirer.prompt({
      type: "select",
      name: "mode",
      message: "What type of FlowTask project is this?",
      choices: MODE_DEFINITIONS.map((d) => ({
        name: d.mode,
        message: `${d.label} — ${d.description}`,
      })),
    });
    mode = response.mode as ProjectMode;
  } else {
    mode = "development";
  }

  const manager = new ProjectManager();
  const project = await manager.init(rootPath, options.name, mode);

  const projectFile = path.join(flowtaskDir, "project.json");
  if (await fileExists(projectFile)) {
    console.log(picocolors.green(`\n✓ FlowTask initialized: ${project.name}`));
    console.log(picocolors.dim(`  Project mode: ${mode}`));
  } else {
    console.log(picocolors.red("\n✗ Initialization failed — could not create project files."));
    process.exit(1);
  }

  console.log(picocolors.dim(`  Project ID: ${project.projectId}`));
  console.log(picocolors.dim(`  Location: ${project.rootPath}`));
  console.log(picocolors.dim(`  Created: ${new Date(project.createdAt).toLocaleString()}`));
  console.log("");
  console.log(picocolors.cyan("Next steps:"));
  console.log(picocolors.cyan('  flowtask run "<your prompt>"'));
  console.log(picocolors.cyan("  flowtask doctor"));
}
