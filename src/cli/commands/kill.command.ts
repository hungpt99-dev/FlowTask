import { ProjectManager } from "../../core/project-manager.js";
import { InteractiveController } from "../../executor/interactive-controller.js";
import { ProcessManager } from "../../core/process-manager.js";
import { EventStore } from "../../core/event-store.js";
import { createRunEvent } from "../../utils/event-factory.js";
import picocolors from "picocolors";

export async function killCommand(runId: string, _options: Record<string, unknown>): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const processManager = new ProcessManager();
  const stopped = await processManager.stop(rootPath, runId);
  if (stopped.success) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("process_signal_sent", {
        runId,
        message: `Process ${stopped.finalStatus}`,
      }),
    );
    await store.appendAudit(
      runId,
      "process.kill",
      `Process killed: ${stopped.finalStatus}`,
      {
        signal: "SIGTERM",
      },
      "user",
      runId,
      "warn",
    );

    console.log(picocolors.green(`✓ Process ${stopped.finalStatus}`));
    return;
  }

  const killed = InteractiveController.killSessionByRunId(runId);
  if (killed) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("process_signal_sent", {
        runId,
        message: "Interactive session killed",
      }),
    );
    await store.appendAudit(
      runId,
      "process.kill",
      "Interactive session killed",
      {},
      "user",
      runId,
      "warn",
    );

    console.log(picocolors.yellow("✗ Interactive session killed"));
    return;
  }

  console.log(picocolors.yellow(`No running process found for run: ${runId}`));
  console.log(picocolors.dim("The process may have already completed."));
}
