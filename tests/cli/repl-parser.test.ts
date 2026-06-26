import { describe, it, expect } from "vitest";
import { parseReplInput } from "../../src/cli/interactive/repl-parser.js";

describe("parseReplInput", () => {
  it("parses run command", () => {
    const result = parseReplInput("run update readme");
    expect(result.name).toBe("run");
    expect(result.args).toEqual(["update readme"]);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses status command", () => {
    const result = parseReplInput("status");
    expect(result.name).toBe("status");
    expect(result.args).toEqual([]);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses doctor command", () => {
    const result = parseReplInput("doctor");
    expect(result.name).toBe("doctor");
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses slash commands", () => {
    const result = parseReplInput("/help");
    expect(result.name).toBe("help");
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses /exit", () => {
    const result = parseReplInput("/exit");
    expect(result.name).toBe("exit");
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses /quit", () => {
    const result = parseReplInput("/quit");
    expect(result.name).toBe("quit");
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses /clear", () => {
    const result = parseReplInput("/clear");
    expect(result.name).toBe("clear");
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("treats unknown text as natural prompt (run)", () => {
    const result = parseReplInput("update readme");
    expect(result.name).toBe("run");
    expect(result.args).toEqual(["update readme"]);
    expect(result.isNaturalPrompt).toBe(true);
  });

  it("treats arbitrary text as natural prompt", () => {
    const result = parseReplInput("fix the login bug");
    expect(result.name).toBe("run");
    expect(result.args).toEqual(["fix the login bug"]);
    expect(result.isNaturalPrompt).toBe(true);
  });

  it("handles quoted prompts", () => {
    const result = parseReplInput('run "update readme" --executor opencode');
    expect(result.name).toBe("run");
    expect(result.args).toEqual(["update readme --executor opencode"]);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("handles single-quoted prompts", () => {
    const result = parseReplInput("run 'update readme'");
    expect(result.name).toBe("run");
    expect(result.args).toEqual(["update readme"]);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses retry command", () => {
    const result = parseReplInput("retry task_002");
    expect(result.name).toBe("retry");
    expect(result.args).toEqual(["task_002"]);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses inspect command", () => {
    const result = parseReplInput("inspect run_123");
    expect(result.name).toBe("inspect");
    expect(result.args).toEqual(["run_123"]);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses logs command", () => {
    const result = parseReplInput("logs --follow");
    expect(result.name).toBe("logs");
    expect(result.args).toEqual(["--follow"]);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses resume with runId", () => {
    const result = parseReplInput("resume run_123");
    expect(result.name).toBe("resume");
    expect(result.args.length).toBeGreaterThan(0);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses cancel command", () => {
    const result = parseReplInput("cancel run_123");
    expect(result.name).toBe("cancel");
    expect(result.args).toEqual(["run_123"]);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses stop command", () => {
    const result = parseReplInput("stop");
    expect(result.name).toBe("stop");
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("parses rules list", () => {
    const result = parseReplInput("rules list");
    expect(result.name).toBe("rules");
    expect(result.args).toEqual(["list"]);
    expect(result.isNaturalPrompt).toBe(false);
  });

  it("returns empty for blank input", () => {
    const result = parseReplInput("");
    expect(result.name).toBe("");
    expect(result.args).toEqual([]);
  });
});
