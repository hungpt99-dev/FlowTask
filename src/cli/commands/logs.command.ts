import { ProjectManager } from "../../core/project-manager.js";
import { LogManager } from "../../core/log-manager.js";
import picocolors from "picocolors";
import fs from "node:fs";
import {
  runtimeLogPath,
  validationLogPath,
  taskLogPath,
  eventsJsonlPath,
} from "../../utils/paths.js";
import { getEventBus } from "../../ui/event-bus.js";
import type { UiEvent } from "../../ui/event-bus.js";

export async function logsCommand(options: {
  follow?: boolean;
  run?: string;
  task?: string;
  validation?: boolean;
  runtime?: boolean;
  tail?: string;
}): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  let runId = options.run;
  if (!runId) {
    const state = await manager.loadState(rootPath);
    runId = state?.activeRunId ?? state?.lastRunId;
    if (!runId) {
      console.log(picocolors.yellow("No run specified and no recent run found."));
      process.exit(0);
    }
  }

  const logManager = new LogManager(rootPath);
  const tailLines = parseInt(options.tail ?? "80", 10);

  const resolveLogPath = (): string | null => {
    if (options.task) return taskLogPath(rootPath, runId, options.task);
    if (options.validation) return validationLogPath(rootPath, runId);
    if (options.runtime) return runtimeLogPath(rootPath, runId);
    return null;
  };

  const logPath = resolveLogPath();

  if (logPath) {
    if (options.follow) {
      await followFile(runId, logPath, tailLines, options.task);
    } else {
      const content = await readLastLines(logPath, tailLines);
      if (!content) {
        console.log(picocolors.yellow(`No log content found.`));
        process.exit(0);
      }
      console.log(
        picocolors.cyan(
          `\nLogs for ${options.task ? `task ${options.task}` : options.validation ? "validation" : options.runtime ? "runtime" : ""} in run ${runId}:`,
        ),
      );
      console.log(picocolors.dim("─".repeat(60)));
      console.log(content);
    }
    return;
  }

  if (options.follow) {
    await followEventsJsonl(rootPath, runId, tailLines);
    return;
  }

  const logFiles = await logManager.listLogFiles(runId);
  if (logFiles.length === 0) {
    console.log(picocolors.yellow(`No log files found for run ${runId}`));
    process.exit(0);
  }

  console.log(picocolors.cyan(`\nLog files for run ${runId}:`));
  console.log(picocolors.dim("─".repeat(60)));
  for (const file of logFiles) {
    console.log(`  ${picocolors.dim("•")} ${file}`);
  }
  console.log("");
  console.log(picocolors.dim("  Use these options to view logs:"));
  console.log(picocolors.dim(`  --task <taskId>    View specific task logs`));
  console.log(picocolors.dim(`  --validation       View validation logs`));
  console.log(picocolors.dim(`  --runtime          View runtime logs`));
  console.log(picocolors.dim(`  --follow           Stream logs in real time`));
  console.log(picocolors.dim(`  --tail <N>         Show last N lines (default: 80)`));

  if (logFiles.includes("runtime.log")) {
    const runtime = await logManager.readRuntime(runId);
    if (runtime) {
      const lines = runtime.trim().split("\n").slice(-10);
      console.log(picocolors.cyan("\nRecent runtime log entries:"));
      console.log(picocolors.dim("─".repeat(60)));
      for (const line of lines) {
        const match = line.match(/\[([^\]]+)\]\s*(.+)/);
        if (match) {
          console.log(`  ${picocolors.dim(match[1]!)} ${match[2]}`);
        } else {
          console.log(`  ${line}`);
        }
      }
    }
  }
  console.log("");
}

async function followEventsJsonl(
  rootPath: string,
  runId: string,
  tailLines: number,
): Promise<void> {
  const eventsPath = eventsJsonlPath(rootPath, runId);

  // Try EventBus for active run first
  const eventBus = getEventBus();
  const unsubscribe = eventBus.subscribe((event: UiEvent) => {
    if ("runId" in event && event.runId !== runId) return;
    if (event.type === "executor_output") {
      process.stdout.write(
        `  [${event.taskId}][${event.executor}][${event.stream}] ${event.text}\n`,
      );
    } else if (event.type === "executor_started") {
      process.stdout.write(`  [${event.taskId}][${event.executor}] started\n`);
    } else if (event.type === "executor_exited") {
      process.stdout.write(
        `  [${event.taskId}][${event.executor}] exited (code ${event.exitCode})\n`,
      );
    } else if (event.type === "executor_failed") {
      process.stdout.write(`  [${event.taskId}][${event.executor}] failed: ${event.reason}\n`);
    }
  });

  // Also tail events.jsonl for persistence
  try {
    const content = await fs.promises.readFile(eventsPath, "utf-8");
    const lines = content.trim().split("\n");
    const tail = lines.slice(-tailLines);
    for (const line of tail) {
      try {
        const event = JSON.parse(line) as UiEvent;
        if (event.type === "executor_output") {
          process.stdout.write(
            `  [${event.taskId!}][${event.executor!}][${event.stream!}] ${event.text}\n`,
          );
        }
      } catch {
        process.stdout.write(`  ${line}\n`);
      }
    }
  } catch {
    // file doesn't exist yet
  }

  let currentSize = 0;
  try {
    const stat = await fs.promises.stat(eventsPath);
    currentSize = stat.size;
  } catch {
    currentSize = 0;
  }

  console.log(picocolors.dim(`\n  Following logs for run ${runId}... (Ctrl+C to stop)\n`));

  const timer = setInterval(async () => {
    try {
      const newStat = await fs.promises.stat(eventsPath);
      if (newStat.size > currentSize) {
        const fd = await fs.promises.open(eventsPath, "r");
        const buf = Buffer.alloc(newStat.size - currentSize);
        await fd.read(buf, 0, buf.length, currentSize);
        await fd.close();
        const content = buf.toString();
        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as UiEvent;
            if (event.type === "executor_output") {
              process.stdout.write(
                `  [${event.taskId!}][${event.executor!}][${event.stream!}] ${event.text}\n`,
              );
            }
          } catch {
            process.stdout.write(`  ${line}\n`);
          }
        }
        currentSize = newStat.size;
      }
    } catch {
      clearInterval(timer);
      unsubscribe();
    }
  }, 500);

  process.on("SIGINT", () => {
    clearInterval(timer);
    unsubscribe();
    console.log(picocolors.dim("\n  Log follow stopped."));
  });
}

async function readLastLines(filePath: string, count: number): Promise<string> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    return lines.slice(-count).join("\n");
  } catch {
    return "";
  }
}

async function followFile(
  runId: string,
  filePath: string,
  tailLines: number,
  taskId?: string,
): Promise<void> {
  const prefix = taskId ? `[${taskId}] ` : `[${runId}] `;

  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const tail = lines.slice(-tailLines).join("\n");
    if (tail) {
      for (const line of tail.split("\n")) {
        if (line.trim()) {
          console.log(`${picocolors.dim(prefix)}${line}`);
        }
      }
    }

    let currentSize = content.length;
    const pollInterval = 500;

    console.log(picocolors.dim(`\n  Watching for new log entries... (Ctrl+C to stop)\n`));

    return new Promise((resolve) => {
      const timer = setInterval(async () => {
        try {
          const newStats = await fs.promises.stat(filePath);
          if (newStats.size > currentSize) {
            const fd = await fs.promises.open(filePath, "r");
            const buf = Buffer.alloc(newStats.size - currentSize);
            await fd.read(buf, 0, buf.length, currentSize);
            await fd.close();
            const newContent = buf.toString();
            for (const line of newContent.split("\n")) {
              if (line.trim()) {
                console.log(`${picocolors.dim(prefix)}${line}`);
              }
            }
            currentSize = newStats.size;
          }
        } catch {
          clearInterval(timer);
          resolve();
        }
      }, pollInterval);

      process.on("SIGINT", () => {
        clearInterval(timer);
        console.log(picocolors.dim("\n  Log follow stopped."));
        resolve();
      });
    });
  } catch {
    console.log(picocolors.yellow(`  Log file not yet available: ${filePath}`));
    console.log(picocolors.dim("  Waiting for log file to appear... (Ctrl+C to stop)"));

    return new Promise((resolve) => {
      const timer = setInterval(async () => {
        try {
          await fs.promises.stat(filePath);
          clearInterval(timer);
          await followFile(runId, filePath, tailLines, taskId);
          resolve();
        } catch {
          // file not available yet
        }
      }, 1000);

      process.on("SIGINT", () => {
        clearInterval(timer);
        console.log(picocolors.dim("\n  Log follow stopped."));
        resolve();
      });
    });
  }
}
