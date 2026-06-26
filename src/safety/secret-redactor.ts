const SENSITIVE_PATTERNS = [
  /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|DATABASE_URL|ACCESS_KEY|SECRET_KEY)=.+$/gim,
  /(?:--password|-p)\s+\S+/g,
  /(?:Bearer\s+)[\w.-]+\b/g,
];

export class SecretRedactor {
  redact(text: string): string {
    let result = text;
    for (const pattern of SENSITIVE_PATTERNS) {
      result = result.replace(pattern, (match) => {
        const eqIndex = match.indexOf("=");
        if (eqIndex > 0) {
          return `${match.slice(0, eqIndex + 1)}****`;
        }
        return match.replace(/\S+$/, "****");
      });
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
