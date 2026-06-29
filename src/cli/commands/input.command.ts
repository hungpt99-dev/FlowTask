import { RunManager } from "../../core/run-manager.js";
import { ProjectManager } from "../../core/project-manager.js";
import { InteractiveController } from "../../executor/interactive-controller.js";
import { ProcessManager } from "../../core/process-manager.js";
import { EventStore } from "../../core/event-store.js";
import { createRunEvent } from "../../utils/event-factory.js";
import picocolors from "picocolors";

export async function inputCommand(
  runIdOrSessionId: string,
  input: string,
  options: { run?: string; secure?: boolean },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const runId = options.run ?? runIdOrSessionId;

  const processManager = new ProcessManager();
  const sent = processManager.sendInput(runId, input);
  if (sent) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("prompt_input_provided", {
        runId,
        message: `User input provided`,
      }),
    );
    await store.appendAudit(
      runId,
      "process.input",
      `User input sent to process`,
      {
        mode: options.secure ? "secure" : "plain",
      },
      "user",
      runId,
      "info",
    );

    console.log(picocolors.green("✓ Input sent to process"));
    return;
  }

  const interactiveSent = InteractiveController.sendInputByRunId(runId, input);
  if (interactiveSent) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("prompt_input_provided", {
        runId,
        message: "User input provided via interactive session",
      }),
    );
    await store.appendAudit(
      runId,
      "process.input",
      "User input sent to interactive session",
      {
        mode: options.secure ? "secure" : "plain",
      },
      "user",
      runId,
      "info",
    );

    console.log(picocolors.green("✓ Input sent to interactive session"));
    return;
  }

  const runManager = new RunManager(rootPath);
  const tasks = await runManager.loadTasks(runId);
  const waitingTasks = tasks.filter(
    (t) => t.status === "waiting_input" || t.status === "waiting_approval",
  );

  if (waitingTasks.length === 0) {
    console.log(
      picocolors.yellow("No waiting tasks found. Use --run <runId> to specify a running run."),
    );
    console.log(picocolors.dim("Active interactive sessions:"));
    const activeSessions = Object.values(
      InteractiveController as unknown as Record<string, unknown>,
    ).filter((v) => typeof v === "object" && v !== null && "status" in v);
    if (activeSessions.length === 0) {
      console.log(picocolors.dim("  (none)"));
    }
    process.exit(1);
  }

  for (const task of waitingTasks) {
    await runManager.updateTaskStatus(runId, task.id, "pending");
    console.log(picocolors.green(`✓ Task ${task.id} set to pending after receiving input`));
  }
}
