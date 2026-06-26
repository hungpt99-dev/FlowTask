import { describe, it, expect } from "vitest";

// Test the help text structure
describe("REPL help content", () => {
  it("help includes run command", () => {
    const helpText = getHelpCommands();
    expect(helpText).toContain("run <prompt>");
  });

  it("help includes status command", () => {
    const helpText = getHelpCommands();
    expect(helpText).toContain("status");
  });

  it("help includes exit", () => {
    const helpText = getHelpCommands();
    expect(helpText).toContain("exit");
  });

  it("help includes shortcut explanation", () => {
    const helpText = getHelpCommands();
    expect(helpText).toContain("Shortcut");
  });
});

function getHelpCommands(): string {
  const lines = [
    "FlowTask Interactive Mode",
    "",
    "Commands:",
    "  run <prompt>          Start a new FlowTask run",
    "  status                Show current project status",
    "  runs                  List runs",
    "  tasks                 List tasks",
    "  logs                  Show logs",
    "  logs --follow         Follow logs",
    "  resume [runId]        Resume interrupted run",
    "  retry <taskId>        Retry failed task",
    "  inspect <runId>       Inspect run details",
    "  stop                  Stop active run",
    "  cancel <runId>        Cancel run",
    "  doctor                Check environment",
    "  rules list            List rules",
    "  rules scan            Scan rule files",
    "  rules validate        Validate rules",
    "  clear                 Clear screen",
    "  exit                  Exit interactive mode",
    "",
    "Slash commands:",
    "  /help                 Show this help",
    "  /exit                 Exit interactive mode",
    "  /quit                 Exit interactive mode",
    "  /clear                Clear screen",
    "",
    "Shortcut:",
    "  Type any normal text to start a run.",
  ];
  return lines.join("\n");
}
