import { describe, it, expect } from "vitest";
import { CommandExecutor } from "../../src/executor/command-executor.js";
import { buildCommandArgs } from "../../src/executor/build-command-args.js";
import { now } from "../../src/utils/time.js";

const projectRoot = process.cwd();

const TEST_TIMEOUT = 10000;

describe("buildCommandArgs", () => {
  it("should pass args unchanged for stdin mode", () => {
    const result = buildCommandArgs({
      args: ["run"],
      inputMode: "stdin",
      contextPackContent: "# Hello\n\nREADME.md\n",
      contextPackPath: "/tmp/ctx.md",
    });
    expect(result.args).toEqual(["run"]);
    expect(result.stdin).toBe("# Hello\n\nREADME.md\n");
  });

  it("should append context to args for argument mode", () => {
    const result = buildCommandArgs({
      args: ["--message"],
      inputMode: "argument",
      contextPackContent: "# Hello",
      contextPackPath: "/tmp/ctx.md",
    });
    expect(result.args).toEqual(["--message", "# Hello"]);
    expect(result.stdin).toBeUndefined();
  });

  it("should append fileArg and path for file mode", () => {
    const result = buildCommandArgs({
      args: ["run"],
      inputMode: "file",
      contextPackContent: "# Hello",
      contextPackPath: "/tmp/ctx.md",
      fileArg: "--file",
    });
    expect(result.args).toEqual(["run", "--file", "/tmp/ctx.md"]);
    expect(result.stdin).toBeUndefined();
  });

  it("should use default fileArg when not provided", () => {
    const result = buildCommandArgs({
      args: [],
      inputMode: "file",
      contextPackContent: "# Hello",
      contextPackPath: "/tmp/ctx.md",
    });
    expect(result.args).toEqual(["--file", "/tmp/ctx.md"]);
  });
});

describe("CommandExecutor", () => {
  describe("regression: does not execute markdown context as shell commands", () => {
    it("should pass context via stdin without shell interpretation (stdin mode)", async () => {
      const executor = new CommandExecutor({
        type: "command",
        command: "node",
        args: ["tests/fixtures/mock-ai-echo-stdin.mjs"],
        inputMode: "stdin",
        timeoutMs: TEST_TIMEOUT,
      });

      const dangerousContext = [
        "docs/IDEA.MD",
        "docs/TECHNICAL.MD",
        "README.md",
        "zod",
        "spawn",
        "path.join",
        "path.isAbsolute",
        'startsWith("/")',
        "/tmp",
      ].join("\n");

      const result = await executor.execute({
        projectRoot,
        runId: "test-regression-stdin",
        task: {
          id: "task_regression_stdin",
          runId: "test-regression-stdin",
          title: "regression test stdin",
          status: "running",
          executor: "mock-ai",
          dependsOn: [],
          acceptanceCriteria: [],
          validation: {},
          retryCount: 0,
          maxRetries: 0,
          createdAt: now(),
          updatedAt: now(),
        },
        contextPackPath: "/dev/null",
        contextPackContent: dangerousContext,
      });

      expect(result.status).toBe("done");
      expect(result.exitCode).toBe(0);

      expect(result.output).toContain("[mock-ai-echo] Received");
      expect(result.output).toContain("Content preview:");
      expect(result.output).toContain("docs/IDEA.MD");

      expect(result.error).toBeFalsy();
    });

    it("should pass context via argument without shell interpretation (argument mode)", async () => {
      const executor = new CommandExecutor({
        type: "command",
        command: "node",
        args: ["tests/fixtures/mock-ai-executor.mjs"],
        inputMode: "argument",
        timeoutMs: TEST_TIMEOUT,
      });

      const dangerousContext = ["docs/IDEA.MD", "docs/TECHNICAL.MD", "README.md"].join("\n");

      const result = await executor.execute({
        projectRoot,
        runId: "test-regression-arg",
        task: {
          id: "task_regression_arg",
          runId: "test-regression-arg",
          title: "regression test argument",
          status: "running",
          executor: "mock-ai",
          dependsOn: [],
          acceptanceCriteria: [],
          validation: {},
          retryCount: 0,
          maxRetries: 0,
          createdAt: now(),
          updatedAt: now(),
        },
        contextPackPath: "/dev/null",
        contextPackContent: dangerousContext,
      });

      expect(result.status).toBe("done");
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("[mock-ai]");
    });

    it("should not produce shell errors with markdown-like context pack (stdin mode)", async () => {
      const executor = new CommandExecutor({
        type: "command",
        command: "node",
        args: ["tests/fixtures/mock-ai-executor.mjs"],
        inputMode: "stdin",
        timeoutMs: TEST_TIMEOUT,
      });

      const contextPack = [
        "# FlowTask Context Pack",
        "",
        "docs/IDEA.MD",
        "docs/TECHNICAL.MD",
        "README.md",
        "zod",
        "spawn",
        "path.join",
        "path.isAbsolute",
        'startsWith("/")',
        "/tmp",
        "",
        "```bash",
        "pnpm test",
        "pnpm lint",
        "pnpm typecheck",
        "```",
      ].join("\n");

      const result = await executor.execute({
        projectRoot: projectRoot,
        runId: "test-regression-context",
        task: {
          id: "task_regression_context",
          runId: "test-regression-context",
          title: "regression test context",
          status: "running",
          executor: "mock-ai",
          dependsOn: [],
          acceptanceCriteria: [],
          validation: {},
          retryCount: 0,
          maxRetries: 0,
          createdAt: now(),
          updatedAt: now(),
        },
        contextPackPath: "/dev/null",
        contextPackContent: contextPack,
      });

      expect(result.status).toBe("done");
      expect(result.output).toContain("[mock-ai]");
      expect(result.output).not.toContain("command not found");
      expect(result.output).not.toContain("Permission denied");
    });
  });
});
