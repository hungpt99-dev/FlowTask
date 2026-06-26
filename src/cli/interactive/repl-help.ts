import picocolors from "picocolors";

export function showWelcome(projectName?: string): void {
  console.log("");
  console.log(picocolors.cyan("  FlowTask"));
  console.log(picocolors.dim("  Local-first AI task runtime CLI"));
  if (projectName) {
    console.log(picocolors.dim(`  Project: ${projectName}`));
  }
  console.log("");
  console.log(picocolors.dim("  Type /help for commands. Type /exit to quit."));
  console.log("");
}

export function showHelp(): void {
  const lines = [
    "",
    `  ${picocolors.bold("FlowTask Interactive Mode")}`,
    "",
    `  ${picocolors.cyan("Commands:")}`,
    `    ${picocolors.dim("run <prompt>")}          Start a new FlowTask run`,
    `    ${picocolors.dim("status")}                Show current project status`,
    `    ${picocolors.dim("runs")}                  List runs`,
    `    ${picocolors.dim("tasks")}                 List tasks`,
    `    ${picocolors.dim("logs")}                  Show logs`,
    `    ${picocolors.dim("logs --follow")}         Follow logs`,
    `    ${picocolors.dim("resume [runId]")}        Resume interrupted run`,
    `    ${picocolors.dim("retry <taskId>")}        Retry failed task`,
    `    ${picocolors.dim("inspect <runId>")}       Inspect run details`,
    `    ${picocolors.dim("stop")}                  Stop active run`,
    `    ${picocolors.dim("cancel <runId>")}        Cancel run`,
    `    ${picocolors.dim("doctor")}                Check environment`,
    `    ${picocolors.dim("rules list")}            List rules`,
    `    ${picocolors.dim("rules scan")}            Scan rule files`,
    `    ${picocolors.dim("rules validate")}        Validate rules`,
    `    ${picocolors.dim("clear")}                 Clear screen`,
    `    ${picocolors.dim("exit")}                  Exit interactive mode`,
    "",
    `  ${picocolors.cyan("Slash commands:")}`,
    `    ${picocolors.dim("/actions")}              Show action palette`,
    `    ${picocolors.dim("/help")}                 Show this help`,
    `    ${picocolors.dim("/exit")}                 Exit interactive mode`,
    `    ${picocolors.dim("/quit")}                 Exit interactive mode`,
    `    ${picocolors.dim("/clear")}                Clear screen`,
    `    ${picocolors.dim("/status")}               Show status`,
    `    ${picocolors.dim("/doctor")}               Run doctor`,
    `    ${picocolors.dim("/runs")}                 List runs`,
    `    ${picocolors.dim("/tasks")}                List tasks`,
    `    ${picocolors.dim("/logs")}                 Show logs`,
    "",
    `  ${picocolors.cyan("Shortcut:")}`,
    `  Type any normal text to start a run.`,
    `  Example: "update readme" runs \`flowtask run "update readme"\` `,
    "",
  ];
  console.log(lines.join("\n"));
}

export function showPrompt(): void {
  process.stdout.write(`\n${picocolors.cyan("FlowTask")} ${picocolors.dim("> ")}`);
}
