import { ProjectManager } from "../../core/project-manager.js";
import { InteractiveController } from "../../executor/interactive-controller.js";
import { ProcessManager } from "../../core/process-manager.js";
import { EventStore } from "../../core/event-store.js";
import { createRunEvent } from "../../utils/event-factory.js";
import picocolors from "picocolors";

export async function approveCommand(
  runId: string,
  _options: Record<string, unknown>,
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  // Try interactive session first
  const interactiveSent = InteractiveController.sendInputByRunId(runId, "y");
  if (interactiveSent) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("prompt_input_provided", {
        runId,
        message: "Approval sent to process",
      }),
    );
    await store.appendTimeline(
      runId,
      "approval_accepted",
      "User approved interactive prompt",
      undefined,
      runId,
      undefined,
      "approved",
    );
    await store.appendAudit(
      runId,
      "process.input",
      "Approval sent to interactive session",
      { action: "approve" },
      "user",
      runId,
      "info",
    );

    console.log(picocolors.green("✓ Approval sent to process"));
    return;
  }

  // Try process manager
  const processManager = new ProcessManager();
  const sent = processManager.sendInput(runId, "y");
  if (sent) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("prompt_input_provided", {
        runId,
        message: "Approval sent to process",
      }),
    );
    await store.appendTimeline(
      runId,
      "approval_accepted",
      "User approved process prompt",
      undefined,
      runId,
      undefined,
      "approved",
    );
    console.log(picocolors.green("✓ Approval sent to process"));
    return;
  }

  console.log(picocolors.yellow(`No waiting process found for run: ${runId}`));
  console.log(
    picocolors.dim("The process may have already completed or there is no active session."),
  );
}

export async function rejectCommand(
  runId: string,
  _options: Record<string, unknown>,
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const interactiveSent = InteractiveController.sendInputByRunId(runId, "n");
  if (interactiveSent) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("prompt_input_provided", {
        runId,
        message: "Rejection sent to process",
      }),
    );
    await store.appendTimeline(
      runId,
      "approval_rejected",
      "User rejected interactive prompt",
      undefined,
      runId,
      undefined,
      "rejected",
    );
    await store.appendAudit(
      runId,
      "process.input",
      "Rejection sent to interactive session",
      { action: "reject" },
      "user",
      runId,
      "warn",
    );

    console.log(picocolors.yellow("✗ Rejection sent to process"));
    return;
  }

  const processManager = new ProcessManager();
  const sent = processManager.sendInput(runId, "n");
  if (sent) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("prompt_input_provided", {
        runId,
        message: "Rejection sent to process",
      }),
    );
    await store.appendTimeline(
      runId,
      "approval_rejected",
      "User rejected process prompt",
      undefined,
      runId,
      undefined,
      "rejected",
    );
    console.log(picocolors.yellow("✗ Rejection sent to process"));
    return;
  }

  console.log(picocolors.yellow(`No waiting process found for run: ${runId}`));
  console.log(
    picocolors.dim("The process may have already completed or there is no active session."),
  );
}

export async function continueCommand(
  runId: string,
  _options: Record<string, unknown>,
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const interactiveSent = InteractiveController.sendInputByRunId(runId, "");
  if (interactiveSent) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("prompt_input_provided", {
        runId,
        message: "Continue sent to process (empty input)",
      }),
    );
    await store.appendTimeline(
      runId,
      "approval_accepted",
      "User continued interactive prompt",
      undefined,
      runId,
      undefined,
      "running",
    );

    console.log(picocolors.green("✓ Continue sent to process"));
    return;
  }

  console.log(picocolors.yellow(`No waiting process found for run: ${runId}`));
  console.log(
    picocolors.dim("The process may have already completed or there is no active session."),
  );
}

export async function overrideCommand(
  runId: string,
  _options: Record<string, unknown>,
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const interactiveSent = InteractiveController.sendInputByRunId(runId, "override");
  if (interactiveSent) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("prompt_input_provided", {
        runId,
        message: "Override sent to process",
      }),
    );
    await store.appendTimeline(
      runId,
      "approval_accepted",
      "User overrode approval gate",
      undefined,
      runId,
      undefined,
      "running",
    );
    await store.appendAudit(
      runId,
      "user.decision",
      "User overrode approval gate",
      { action: "override" },
      "user",
      runId,
      "warn",
    );

    console.log(picocolors.yellow("⚠ Override sent to process"));
    return;
  }

  const processManager = new ProcessManager();
  const sent = processManager.sendInput(runId, "override");
  if (sent) {
    const store = new EventStore(rootPath);
    await store.appendToRun(
      runId,
      createRunEvent("prompt_input_provided", {
        runId,
        message: "Override sent to process",
      }),
    );
    await store.appendTimeline(
      runId,
      "approval_accepted",
      "User overrode approval gate",
      undefined,
      runId,
      undefined,
      "running",
    );
    await store.appendAudit(
      runId,
      "user.decision",
      "User overrode approval gate",
      { action: "override" },
      "user",
      runId,
      "warn",
    );

    console.log(picocolors.yellow("⚠ Override sent to process"));
    return;
  }

  console.log(picocolors.yellow(`No waiting process found for run: ${runId}`));
  console.log(
    picocolors.dim("The process may have already completed or there is no active session."),
  );
}
