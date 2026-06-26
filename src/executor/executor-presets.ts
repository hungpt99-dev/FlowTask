import type { ExecutorEntry } from "../schemas/config.schema.js";

export const DEFAULT_EXECUTORS: Record<string, ExecutorEntry> = {
  shell: { type: "shell", args: [], inputMode: "argument", timeoutMs: 1800000 },
  manual: { type: "manual", args: [], inputMode: "argument", timeoutMs: 1800000 } as ExecutorEntry,
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
  "cursor-agent": {
    type: "command",
    command: "cursor-agent",
    args: [],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  "qwen-code": {
    type: "command",
    command: "qwen",
    args: [],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  amp: {
    type: "command",
    command: "amp",
    args: [],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
  goose: {
    type: "command",
    command: "goose",
    args: ["session"],
    inputMode: "stdin",
    timeoutMs: 1800000,
  },
};

export function mergeExecutorConfigs(
  userConfig: Record<string, ExecutorEntry> | undefined,
): Record<string, ExecutorEntry> {
  const merged: Record<string, ExecutorEntry> = { ...DEFAULT_EXECUTORS };
  if (userConfig) {
    for (const [key, val] of Object.entries(userConfig)) {
      merged[key] = val;
    }
  }
  return merged;
}
