import picocolors from "picocolors";
import type { ReplCommand } from "./repl-parser.js";
import { statusCommand } from "../commands/status.command.js";
import { runsCommand } from "../commands/runs.command.js";
import { tasksCommand } from "../commands/tasks.command.js";
import { logsCommand } from "../commands/logs.command.js";
import { resumeCommand } from "../commands/resume.command.js";
import { retryCommand } from "../commands/retry.command.js";
import { inspectCommand } from "../commands/inspect.command.js";
import { stopCommand } from "../commands/stop.command.js";
import { cancelCommand } from "../commands/cancel.command.js";
import { doctorCommand } from "../commands/doctor.command.js";
import { rulesCommand } from "../commands/rules.command.js";
import { runCommand } from "../commands/run.command.js";
import { confirmAction, selectRun, selectFailedTask } from "./repl-selectors.js";
import { getEventBus } from "../../ui/event-bus.js";
import type { UiEvent } from "../../ui/event-bus.js";

export async function routeReplCommand(command: ReplCommand): Promise<void> {
  const { name, args, isNaturalPrompt } = command;

  try {
    switch (name) {
      case "run":
        await handleRun(args, isNaturalPrompt);
        break;

      case "status":
        await statusCommand();
        break;

      case "runs":
        await runsCommand({ status: undefined, limit: "20" });
        break;

      case "tasks":
        await tasksCommand({ run: undefined, all: undefined, status: undefined });
        break;

      case "logs":
        await handleLogs(args);
        break;

      case "actions":
        await handleActions();
        break;

      case "resume":
        await handleResume(args);
        break;

      case "retry":
        await handleRetry(args);
        break;

      case "inspect":
        await handleInspect(args);
        break;

      case "stop":
        await handleStop();
        break;

      case "cancel":
        await handleCancel(args);
        break;

      case "doctor":
        await doctorCommand();
        break;

      case "rules":
        await handleRules(args);
        break;

      case "clear":
        process.stdout.write("\x1b[2J\x1b[H");
        break;

      case "help":
        const { showHelp } = await import("./repl-help.js");
        showHelp();
        break;

      case "exit":
      case "quit":
        process.exit(0);

      default:
        console.log(picocolors.yellow(`  Unknown command: ${name}`));
        console.log(picocolors.dim("  Type /help for available commands."));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(picocolors.red(`\n  Error: ${message}\n`));
    console.log(picocolors.dim("  Type /help for commands.\n"));
  }
}

async function handleRun(args: string[], isNaturalPrompt: boolean): Promise<void> {
  if (args.length === 0 || !args[0]) {
    console.log(picocolors.yellow("  Usage: run <prompt>"));
    console.log(picocolors.yellow('  Or type a prompt directly, e.g. "update readme"'));
    return;
  }

  if (isNaturalPrompt) {
    console.log("");
    console.log(picocolors.dim(`  ${"─".repeat(50)}`));
    console.log(`  ${picocolors.cyan("Start new run?")}`);
    console.log(picocolors.dim(`  ${"─".repeat(50)}`));
    console.log(`  ${picocolors.dim("Prompt:")}  ${args[0]}`);
    console.log("");

    const confirmed = await confirmAction("Continue?", true);
    if (!confirmed) {
      console.log(picocolors.dim("  Run cancelled."));
      return;
    }
  }

  // Subscribe to EventBus for live executor output
  const eventBus = getEventBus();
  const unsubscribe = eventBus.subscribe((event: UiEvent) => {
    if (event.type === "executor_output") {
      const prefix = picocolors.dim(`[${event.executor}][${event.stream}]`);
      process.stdout.write(`  ${prefix} ${event.text}\n`);
    } else if (event.type === "executor_started") {
      process.stdout.write(`  ${picocolors.dim(`[${event.executor}] started`)}\n`);
    } else if (event.type === "executor_exited") {
      const status = event.exitCode === 0 ? picocolors.green("exited") : picocolors.red("exited");
      process.stdout.write(
        `  ${picocolors.dim(`[${event.executor}]`)} ${status} (code ${event.exitCode})\n`,
      );
    } else if (event.type === "executor_failed") {
      process.stdout.write(`  ${picocolors.red(`[${event.executor}] failed: ${event.reason}`)}\n`);
    }
  });

  try {
    await runCommand(args[0], {});
  } finally {
    unsubscribe();
  }
}

async function handleResume(args: string[]): Promise<void> {
  if (args[0]) {
    await resumeCommand(args[0], {});
    return;
  }

  const rootPath = process.cwd();
  const selected = await selectRun(rootPath, "to resume");
  if (selected) {
    await resumeCommand(selected.runId, {});
  }
}

async function handleRetry(args: string[]): Promise<void> {
  const continueFlag = args.includes("--continue");
  const forceFlag = args.includes("--force");

  if (args[0] && !args[0].startsWith("-")) {
    if (forceFlag) {
      const confirmed = await confirmAction("Force retry? This bypasses maxRetries.", false);
      if (!confirmed) {
        console.log(picocolors.dim("  Retry cancelled."));
        return;
      }
    }
    await retryCommand(args[0]!, { continue: continueFlag, force: forceFlag });
    return;
  }

  const rootPath = process.cwd();
  const selected = await selectFailedTask(rootPath);
  if (selected) {
    await retryCommand(selected.taskId, {});
  }
}

async function handleInspect(args: string[]): Promise<void> {
  if (args[0]) {
    await inspectCommand(args[0]!);
    return;
  }

  const rootPath = process.cwd();
  const selected = await selectRun(rootPath, "to inspect");
  if (selected) {
    await inspectCommand(selected.runId);
  }
}

async function handleStop(): Promise<void> {
  const confirmed = await confirmAction("Stop the current running task?", false);
  if (!confirmed) {
    console.log(picocolors.dim("  Stop cancelled."));
    return;
  }
  await stopCommand();
}

async function handleCancel(args: string[]): Promise<void> {
  let runId = args[0];
  if (!runId) {
    const rootPath = process.cwd();
    const selected = await selectRun(rootPath, "to cancel");
    if (!selected) return;
    runId = selected.runId;
  }

  const confirmed = await confirmAction(
    `Cancel run ${runId}? This will mark pending tasks as cancelled.`,
    false,
  );
  if (!confirmed) {
    console.log(picocolors.dim("  Cancel cancelled."));
    return;
  }
  await cancelCommand(runId);
}

async function handleLogs(args: string[]): Promise<void> {
  const follow = args.includes("--follow") || args.includes("-f");
  const validation = args.includes("--validation");
  const runtime = args.includes("--runtime");
  let task: string | undefined;
  let run: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--task" && i + 1 < args.length) {
      task = args[i + 1]!;
    }
    if (args[i] === "--run" && i + 1 < args.length) {
      run = args[i + 1]!;
    }
  }

  await logsCommand({
    follow,
    task,
    run,
    validation,
    runtime,
    tail: "80",
  });
}

async function handleActions(): Promise<void> {
  const { showCommandPalette } = await import("./repl-actions.js");
  const rootPath = process.cwd();
  const result = await showCommandPalette(rootPath);
  if (result === "run") {
    console.log(picocolors.dim('  Type "run <prompt>" or just a natural prompt.'));
  }
}

async function handleRules(args: string[]): Promise<void> {
  const action = args[0] ?? "list";
  const rulePath = args[1];
  await rulesCommand(action, rulePath);
}
