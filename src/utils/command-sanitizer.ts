const INJECTION_PATTERNS = /\$\(|`/;
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

const API_CREDENTIAL_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "REPLICATE_API_TOKEN",
  "TOGETHER_API_KEY",
  "PERPLEXITY_API_KEY",
  "COHERE_API_KEY",
  "AI21_API_KEY",
  "HUGGINGFACE_API_KEY",
  "FIREWORKS_API_KEY",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
];

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
    ...API_CREDENTIAL_ENV_VARS,
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
