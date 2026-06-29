import { ProjectManager } from "../../core/project-manager.js";
import { InteractiveController } from "../../executor/interactive-controller.js";
import picocolors from "picocolors";

export async function watchCommand(
  runId: string,
  options: { follow?: boolean; pollInterval?: string },
): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const session = InteractiveController.getSessionByRunId(runId);

  if (!session) {
    console.log(picocolors.yellow(`No active interactive session found for run: ${runId}`));
    console.log(
      picocolors.dim("The process may have already completed or was not started interactively."),
    );
    process.exit(1);
  }

  if (options.follow) {
    return followSession(session.id, options.pollInterval);
  }

  printSessionStatus(session.id, 0);
}

async function followSession(sessionId: string, pollIntervalStr?: string): Promise<void> {
  const pollIntervalMs = parseInt(pollIntervalStr ?? "2000", 10) || 2000;
  let lastLineCount = 0;
  let lastStatus: string | undefined;

  console.log(picocolors.cyan("\n  Following interactive session (Ctrl+C to stop)...\n"));

  return new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const session = InteractiveController.getSession(sessionId);
      if (!session) {
        console.log(picocolors.yellow("\n  Session ended."));
        clearInterval(interval);
        resolve();
        return;
      }

      if (session.status !== lastStatus) {
        lastStatus = session.status;
        const statusColor =
          session.status === "running"
            ? picocolors.green
            : session.status === "waiting_input" || session.status === "waiting_approval"
              ? picocolors.yellow
              : session.status === "stuck" || session.status === "killed"
                ? picocolors.red
                : picocolors.dim;
        console.log(`  Status: ${statusColor(session.status)}`);
      }

      const visibleLines = session.stdoutLines.slice(-3);
      if (visibleLines.length > lastLineCount) {
        const newLines = visibleLines.slice(
          lastLineCount - (session.stdoutLines.length - visibleLines.length),
        );
        for (const line of newLines) {
          if (line.trim()) {
            process.stdout.write(`    ${picocolors.dim(line)}\n`);
          }
        }
        lastLineCount = session.stdoutLines.length;
      }

      if (session.detectedPrompt) {
        console.log(
          picocolors.yellow(`\n  ⚠ Detected prompt: "${session.detectedPrompt.matchedText}"`),
        );
        console.log(picocolors.dim(`  Type: ${session.detectedPrompt.type}`));
        console.log(
          picocolors.dim(
            `  Use: flowtask input ${session.runId} <text>  |  flowtask approve ${session.runId}  |  flowtask kill ${session.runId}`,
          ),
        );
      }

      if (session.status === "exited" || session.status === "killed") {
        clearInterval(interval);
        console.log(picocolors.dim(`\n  Session ${session.status}.`));
        resolve();
      }
    }, pollIntervalMs);

    process.on("SIGINT", () => {
      clearInterval(interval);
      console.log(picocolors.dim("\n  Stopped following session."));
      resolve();
    });
  });
}

function printSessionStatus(sessionId: string, _pollIntervalMs?: number): void {
  const session = InteractiveController.getSession(sessionId);
  if (!session) {
    console.log(picocolors.yellow("Session no longer active."));
    return;
  }

  console.log(picocolors.cyan(`\nInteractive Session: ${session.id}`));
  console.log(picocolors.dim(`  Run: ${session.runId}`));
  console.log(picocolors.dim(`  Task: ${session.taskId}`));
  console.log(picocolors.dim(`  Status: ${session.status}`));
  console.log(
    picocolors.dim(`  Duration: ${Math.floor((Date.now() - session.createdAt) / 1000)}s`),
  );
  console.log(picocolors.dim(`  Input count: ${session.inputCount}`));

  if (session.detectedPrompt) {
    console.log(picocolors.yellow(`\n  Detected prompt: "${session.detectedPrompt.matchedText}"`));
    console.log(picocolors.yellow(`  Type: ${session.detectedPrompt.type}`));
    console.log(
      picocolors.yellow(`  Confidence: ${Math.round(session.detectedPrompt.confidence * 100)}%`),
    );
  }

  if (session.stdoutLines.length > 0) {
    const lastLines = session.stdoutLines.slice(-10);
    console.log(picocolors.dim(`\n  Recent output (last ${lastLines.length} lines):`));
    for (const line of lastLines) {
      console.log(`    ${picocolors.dim(line)}`);
    }
  }

  if (session.status === "running") {
    console.log(picocolors.green("\n  Process is running normally."));
  } else if (session.status === "waiting_input" || session.status === "waiting_approval") {
    console.log(picocolors.yellow("\n  Process is waiting for input."));
    console.log(picocolors.dim("  Use: flowtask input <runId> <text>"));
    console.log(picocolors.dim("  Use: flowtask approve <runId>"));
    console.log(picocolors.dim("  Use: flowtask kill <runId>"));
  } else if (session.status === "stuck") {
    console.log(picocolors.red("\n  Process appears stuck (no output for a while)."));
    console.log(picocolors.dim("  Use: flowtask kill <runId>"));
  } else if (
    session.status === "completed" ||
    session.status === "killed" ||
    session.status === "exited"
  ) {
    console.log(picocolors.dim(`\n  Process ${session.status}.`));
  }

  console.log("");
}
