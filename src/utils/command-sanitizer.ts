const INJECTION_PATTERNS = /\$\(|`|;(?=\s)/;
const MAX_COMMAND_LENGTH = 32_768;

export interface SanitizeResult {
  valid: boolean;
  sanitized: string;
  reason?: string;
}

export function sanitizeCommand(cmd: string): SanitizeResult {
  if (!cmd || cmd.trim().length === 0) {
    return { valid: false, sanitized: cmd, reason: "Command is empty" };
  }

  if (cmd.length > MAX_COMMAND_LENGTH) {
    return {
      valid: false,
      sanitized: cmd,
      reason: `Command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters`,
    };
  }

  if (INJECTION_PATTERNS.test(cmd)) {
    return { valid: false, sanitized: cmd, reason: "Command contains shell injection patterns" };
  }

  return { valid: true, sanitized: cmd.trim() };
}

export function isSafeCommand(cmd: string): boolean {
  if (!cmd || cmd.trim().length === 0) return false;
  if (cmd.length > MAX_COMMAND_LENGTH) return false;
  return !INJECTION_PATTERNS.test(cmd);
}

export function buildChildEnv(
  extra?: Record<string, string | undefined>,
  allowlist?: string[],
): Record<string, string> {
  const env: Record<string, string> = {};

  const allowedVars = allowlist ?? [
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "NODE_ENV",
    "NODE_PATH",
    "TMPDIR",
    "TMP",
    "LANG",
    "LC_ALL",
  ];

  for (const key of allowedVars) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]!;
    }
  }

  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      if (val !== undefined) {
        env[key] = val;
      }
    }
  }

  return env;
}
