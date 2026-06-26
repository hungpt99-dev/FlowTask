export type RiskLevel = "safe" | "risky" | "dangerous" | "blocked";

export interface SafetyResult {
  riskLevel: RiskLevel;
  reason?: string;
}

export class SafetyChecker {
  check(command: string): SafetyResult {
    const lower = command.toLowerCase().trim();

    const blockedPatterns = [
      { pattern: "rm -rf /", reason: "Blocked: destructive command (rm -rf /)" },
      { pattern: "rm -rf .git", reason: "Blocked: would delete .git directory" },
      { pattern: "printenv", reason: "Blocked: would expose environment variables" },
      { pattern: "cat .env", reason: "Blocked: would read .env secrets" },
      { pattern: "cat id_rsa", reason: "Blocked: would read SSH private key" },
      { pattern: "upload", reason: "Blocked: potential data exfiltration" },
      { pattern: "disable test", reason: "Blocked: cannot disable tests" },
    ];

    for (const { pattern, reason } of blockedPatterns) {
      if (lower.includes(pattern)) {
        return { riskLevel: "blocked", reason };
      }
    }

    const riskyPatterns = [
      { pattern: "pnpm add", reason: "Adding dependency" },
      { pattern: "pnpm install", reason: "Installing dependencies" },
      { pattern: "npm install", reason: "Installing dependencies" },
      { pattern: "npm add", reason: "Adding dependency" },
      { pattern: "rm ", reason: "Deleting files" },
      { pattern: "git push", reason: "Pushing to remote" },
      { pattern: "git reset", reason: "Resetting git history" },
      { pattern: "deploy", reason: "Deploying application" },
    ];

    for (const { pattern, reason } of riskyPatterns) {
      if (lower.startsWith(pattern) || lower.includes(pattern)) {
        return { riskLevel: "risky", reason: `Risky: ${reason}` };
      }
    }

    return { riskLevel: "safe" };
  }
}
