import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { ArtifactManager } from "../../core/artifact-manager.js";
import { DatabaseManager } from "../../core/database-manager.js";
import { dbPath } from "../../utils/paths.js";

export async function artifactsCommand(
  runId: string,
  options: {
    task?: string;
    type?: string;
    json?: boolean;
    full?: boolean;
  },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  let resolvedRunId = runId;
  if (!resolvedRunId) {
    const state = await manager.loadState(rootPath);
    resolvedRunId = state?.activeRunId ?? state?.lastRunId ?? "";
    if (!resolvedRunId) {
      console.log(picocolors.yellow("No run specified and no recent run found."));
      process.exit(0);
    }
  }

  const db = await DatabaseManager.create(dbPath(rootPath));

  try {
    const artifactManager = new ArtifactManager();
    artifactManager.setDatabase(db);

    const artifacts = artifactManager.getArtifactsByRunFiltered(rootPath, resolvedRunId, {
      taskId: options.task,
      type: options.type,
    });

    if (options.json) {
      console.log(JSON.stringify(artifacts, null, 2));
      return;
    }

    if (artifacts.length === 0) {
      console.log(picocolors.yellow(`No artifacts found for run ${resolvedRunId}`));
      if (!runId) {
        console.log(picocolors.dim(`  Specify a run: flowtask artifacts <runId>`));
      }
      return;
    }

    console.log(picocolors.cyan(`\nArtifacts for run ${resolvedRunId}`));
    console.log(picocolors.dim("  " + "─".repeat(60)));

    const grouped = new Map<string, typeof artifacts>();
    for (const a of artifacts) {
      const key = a.taskId ?? "unknown";
      const group = grouped.get(key) ?? [];
      group.push(a);
      grouped.set(key, group);
    }

    for (const [taskId, items] of grouped) {
      console.log(picocolors.dim(`\n  Task: ${taskId}`));
      for (const a of items) {
        const vs =
          a.validationStatus === "passed"
            ? picocolors.green("\u2713")
            : a.validationStatus === "failed"
              ? picocolors.red("\u2717")
              : a.validationStatus === "pending"
                ? picocolors.dim("\u25CB")
                : picocolors.yellow("?");
        const originLabel = a.origin === "unexpected" ? picocolors.yellow(" [unexpected]") : "";
        console.log(`    ${vs} ${picocolors.dim(a.title)}${originLabel}`);
        console.log(`       ${picocolors.dim("Type:")} ${a.type}`);
        if (options.full) {
          console.log(`       ${picocolors.dim("Path:")} ${picocolors.dim(a.path)}`);
          console.log(`       ${picocolors.dim("Size:")} ${a.fileSize}B`);
          if (a.summary)
            console.log(`       ${picocolors.dim("Summary:")} ${a.summary.slice(0, 100)}`);
          if (a.diffStat) console.log(`       ${picocolors.dim("Diff:")} ${a.diffStat}`);
        }
      }
    }

    console.log(picocolors.dim(`\n  Total: ${artifacts.length} artifacts`));
    if (!options.full) {
      console.log(picocolors.dim("  Use --full to see paths and details."));
    }
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}
