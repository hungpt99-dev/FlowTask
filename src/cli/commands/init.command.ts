import { ProjectManager } from "../../core/project-manager.js";
import { fileExists } from "../../utils/fs.js";
import { FLOWTASK_DIR } from "../../utils/paths.js";
import picocolors from "picocolors";
import path from "node:path";

export async function initCommand(options: { name?: string; force?: boolean }): Promise<void> {
  const rootPath = process.cwd();

  const flowtaskDir = path.join(rootPath, FLOWTASK_DIR);
  const alreadyInit = await fileExists(path.join(flowtaskDir, "project.json"));

  if (alreadyInit && !options.force) {
    console.log(picocolors.yellow("FlowTask already initialized in this directory."));
    console.log(picocolors.dim("Use --force to reinitialize."));
    process.exit(0);
  }

  const manager = new ProjectManager();
  const project = await manager.init(rootPath, options.name);

  const projectFile = path.join(flowtaskDir, "project.json");
  if (await fileExists(projectFile)) {
    console.log(picocolors.green(`\n✓ FlowTask initialized: ${project.name}`));
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
  console.log(picocolors.cyan("  flowtask rules scan"));
  console.log(picocolors.cyan("  flowtask doctor"));
}
