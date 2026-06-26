import type { ExecutorEntry } from "../schemas/config.schema.js";

export const DEFAULT_EXECUTORS: Record<string, ExecutorEntry> = {
  opencode: {
    type: "command",
    command: "opencode",
    args: ["run"],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  claude: {
    type: "command",
    command: "claude",
    args: [],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  codex: {
    type: "command",
    command: "codex",
    args: [],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  gemini: {
    type: "command",
    command: "gemini",
    args: [],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  aider: {
    type: "command",
    command: "aider",
    args: ["--message"],
    inputMode: "argument",
    timeoutMs: 1800000,
  },
  "mock-ai": {
    type: "command",
    command: "node",
    args: ["tests/fixtures/mock-ai-executor.mjs"],
    inputMode: "stdin",
    timeoutMs: 30000,
  },
};

export function mergeExecutorConfigs(
  userConfig: Record<string, ExecutorEntry> | undefined,
): Record<string, ExecutorEntry> {
  const merged: Record<string, ExecutorEntry> = { ...DEFAULT_EXECUTORS };
  if (userConfig) {
    for (const [key, val] of Object.entries(userConfig)) {
      merged[key] = { ...merged[key], ...val };
    }
  }
  return merged;
}
