import { RunLifecycle } from "../../core/run-lifecycle.js";
import { ProjectManager } from "../../core/project-manager.js";
import { EventStore } from "../../core/event-store.js";
import picocolors from "picocolors";
import type { Run } from "../../schemas/run.schema.js";

export async function runCommand(
  prompt: string,
  options: {
    executor?: string;
    mode?: string;
    quality?: boolean;
    planOnly?: boolean;
    dryRun?: boolean;
    debug?: boolean;
    template?: string;
  },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.red("FlowTask project not initialized."));
    console.log(picocolors.yellow("Run: flowtask init"));
    process.exit(1);
  }

  const project = (await manager.load(rootPath))!;
  const config = await manager.loadConfig(rootPath);

  const eventStore = new EventStore(rootPath);
  await eventStore.appendGlobal({
    type: "run_created",
    runId: "",
    message: `Prompt: ${prompt.slice(0, 100)}`,
  });

  let resolvedMode: Run["mode"] = (options.mode as Run["mode"]) ?? "auto";
  if (options.planOnly) resolvedMode = "plan-only";
  if (options.dryRun) resolvedMode = "dry-run";
  if (options.debug) resolvedMode = "debug";

  const lifecycle = new RunLifecycle(rootPath, project.projectId, config);

  if (options.executor && options.executor !== "shell") {
    const configExecutors = config.executors;
    if (configExecutors && configExecutors[options.executor]) {
      const executorConfig = configExecutors[options.executor]!;
      if (executorConfig.type === "command" && executorConfig.command) {
        const { ExecutorRegistry } = await import("../../executor/executor-registry.js");
        const reg = new ExecutorRegistry();
        reg.registerCommandExecutor(options.executor, executorConfig.command);
      }
    }
  }

  try {
    const result = await lifecycle.executeRun(prompt, {
      mode: resolvedMode,
      template: options.template,
      debug: options.debug,
    });

    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    console.error(
      picocolors.red(`\n✗ Run error:`),
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}
