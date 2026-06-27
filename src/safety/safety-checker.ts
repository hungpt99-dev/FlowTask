export type RiskLevel = "safe" | "risky" | "dangerous" | "blocked";

export interface SafetyResult {
  riskLevel: RiskLevel;
  reason?: string;
}

function normalizeCommand(cmd: string): string {
  return cmd
    .toLowerCase()
    .replace(/\$HOME/g, "")
    .replace(/\.\//g, "")
    .replace(/['"]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BLOCKED_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\brm\s+-rf\s+\//, reason: "Blocked: destructive command (rm -rf /)" },
  {
    regex: /\brm\s+-rf\s+--no-preserve-root\s+\//,
    reason: "Blocked: destructive command (rm -rf /)",
  },
  { regex: /\brm\s+-rf\s+\$?HOME/i, reason: "Blocked: destructive command (rm -rf)" },
  { regex: /\brm\s+-rf\s+\.git\b/, reason: "Blocked: would delete .git directory" },
  { regex: /\bprintenv\b/, reason: "Blocked: would expose environment variables" },
  { regex: /\b(?:env|set|declare)\b/, reason: "Blocked: would expose environment variables" },
  { regex: /(?:^|\|)\s*env\s*$/, reason: "Blocked: would expose environment variables" },
  { regex: /\bcat\s+\.env\b/, reason: "Blocked: would read .env secrets" },
  {
    regex: /\b(?:nl|head|tail|less|more|base64|strings)\s+\.env\b/,
    reason: "Blocked: would read .env secrets via alternative tool",
  },
  { regex: /\bcat\s+id_rsa\b/, reason: "Blocked: would read SSH private key" },
  { regex: /\bupload\b/, reason: "Blocked: potential data exfiltration" },
  { regex: /\bdisable\s+test\b/, reason: "Blocked: cannot disable tests" },
  { regex: /echo\s+\$[A-Z_]+/, reason: "Blocked: would expose environment variables via echo" },
];

const RISKY_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\bpnpm\s+add\b/, reason: "Adding dependency" },
  { regex: /\bpnpm\s+install\b/, reason: "Installing dependencies" },
  { regex: /\bnpm\s+install\b/, reason: "Installing dependencies" },
  { regex: /\bnpm\s+add\b/, reason: "Adding dependency" },
  { regex: /\brm\s+/, reason: "Deleting files" },
  { regex: /\bgit\s+push\b/, reason: "Pushing to remote" },
  { regex: /\bgit\s+reset\b/, reason: "Resetting git history" },
  { regex: /\bdeploy\b/, reason: "Deploying application" },
];

export class SafetyChecker {
  check(command: string): SafetyResult {
    const normalized = normalizeCommand(command);

    for (const { regex, reason } of BLOCKED_PATTERNS) {
      if (regex.test(normalized)) {
        return { riskLevel: "blocked", reason };
      }
    }

    for (const { regex, reason } of RISKY_PATTERNS) {
      if (regex.test(normalized)) {
        return { riskLevel: "risky", reason: `Risky: ${reason}` };
      }
    }

    return { riskLevel: "safe" };
  }
}
