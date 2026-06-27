type RedactMatch = (match: string) => string;

interface SensitivePattern {
  regex: RegExp;
  redact: RedactMatch;
}

const redactValueAfterEquals: RedactMatch = (match) => {
  const eqIndex = match.indexOf("=");
  if (eqIndex > 0) {
    return `${match.slice(0, eqIndex + 1)}****`;
  }
  return match.replace(/\S+$/, "****");
};

const redactEntireValue: RedactMatch = () => "****";

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // Existing env-var patterns
  {
    regex:
      /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|DATABASE_URL|ACCESS_KEY|SECRET_KEY)=.+$/gim,
    redact: redactValueAfterEquals,
  },

  // OpenAI keys (sk-proj, sk-org, sk-live, sk-sess)
  { regex: /\b(sk-(?:proj|org|live|sess)-[a-zA-Z0-9]{20,})\b/g, redact: redactEntireValue },

  // GitHub tokens
  { regex: /\b(ghp_[a-zA-Z0-9]{36,})\b/g, redact: redactEntireValue },
  { regex: /\b(ghs_[a-zA-Z0-9]{36,})\b/g, redact: redactEntireValue },
  { regex: /\b(ghr_[a-zA-Z0-9]{36,})\b/g, redact: redactEntireValue },

  // Slack tokens
  { regex: /\b(xox[baprs]-[a-zA-Z0-9]{10,})\b/g, redact: redactEntireValue },

  // AWS access keys
  { regex: /\b(AKIA[0-9A-Z]{16})\b/g, redact: redactEntireValue },

  // PEM private key blocks
  {
    regex: /-----BEGIN\s(?:RSA\s)?PRIVATE\sKEY-----[\s\S]*?-----END\s(?:RSA\s)?PRIVATE\sKEY-----/g,
    redact: redactEntireValue,
  },

  // Credentials in URLs (https://user:pass@host)
  {
    regex: /https?:\/\/[^@\/\s]+:[^@\s]+@/g,
    redact: (_) => _.replace(/:\/\/[^@]+@/, "://****:****@"),
  },

  // Bearer tokens (JWT / base64)
  { regex: /(?:Bearer\s+)[a-zA-Z0-9._\-\+\/=]+/g, redact: redactEntireValue },
];

export class SecretRedactor {
  redact(text: string): string {
    let result = text;
    for (const { regex, redact } of SENSITIVE_PATTERNS) {
      result = result.replace(regex, redact);
    }
    return result;
  }

  isSensitiveFilePath(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return (
      lower.includes(".env") ||
      lower.includes("id_rsa") ||
      lower.includes("id_ed25519") ||
      lower.endsWith(".pem") ||
      lower.endsWith(".key")
    );
  }
}
