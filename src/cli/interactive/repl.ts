import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseReplInput } from "./repl-parser.js";
import { routeReplCommand } from "./repl-router.js";
import { showWelcome, showPrompt } from "./repl-help.js";
import { ProjectManager } from "../../core/project-manager.js";
import { ReplHistory } from "./repl-history.js";
import picocolors from "picocolors";

export async function startInteractiveMode(): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();
  let projectName: string | undefined;

  try {
    const initialized = await manager.isInitialized(rootPath);
    if (initialized) {
      const project = await manager.load(rootPath);
      projectName = project?.name;
    }
  } catch {
    // not initialized, show generic welcome
  }

  const history = new ReplHistory({ projectRoot: rootPath });
  const savedHistory = await history.load();

  showWelcome(projectName);

  const rl = readline.createInterface({
    input,
    output,
    prompt: "",
    terminal: true,
    history: savedHistory,
    historySize: 500,
    removeHistoryDuplicates: true,
  });

  rl.on("SIGINT", () => {
    console.log(picocolors.dim("\n  Use /exit to quit."));
    showPrompt();
  });

  const loop = async (): Promise<void> => {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        showPrompt();
        continue;
      }

      const command = parseReplInput(trimmed);

      if (command.name === "exit" || command.name === "quit") {
        console.log(picocolors.dim("  Goodbye."));
        rl.close();
        return;
      }

      await routeReplCommand(command);

      await history.append(trimmed);

      showPrompt();
    }
  };

  showPrompt();
  await loop();
}
