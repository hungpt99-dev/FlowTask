export const PROMPT_PATTERNS = [
  {
    type: "approval" as const,
    pattern: /\[y\/n\]|\[Y\/n\]|\[y\/N\]|\(y\/n\)|\(Y\/N\)|\(y\/N\)/i,
    confidence: 0.95,
  },
  {
    type: "approval" as const,
    pattern: /^(continue|proceed|confirm|approve)\??/im,
    confidence: 0.85,
  },
  {
    type: "approval" as const,
    pattern: /^(are you sure|do you want to continue|would you like to|is this correct)/i,
    confidence: 0.85,
  },
  {
    type: "approval" as const,
    pattern: /(should i (proceed|continue|apply)|confirm (changes|action)|approve changes)/i,
    confidence: 0.8,
  },
  {
    type: "approval" as const,
    pattern: /^\[confirm\].*|^\[proceed\].*/im,
    confidence: 0.75,
  },
  { type: "approval" as const, pattern: /^(allow|deny)/i, confidence: 0.6 },
  { type: "input" as const, pattern: /press\s+(enter|return|any\s+key)/i, confidence: 0.9 },
  {
    type: "input" as const,
    pattern: /^(enter\s+(your\s+)?|type\s+(your\s+)?|provide\s+(your\s+)?).*[:：]/i,
    confidence: 0.75,
  },
  { type: "input" as const, pattern: /^[#>]\s*$/, confidence: 0.4 },
  { type: "input" as const, pattern: /^select\s+(an option|a choice|from)/i, confidence: 0.7 },
  {
    type: "input" as const,
    pattern: /^enter\s+(to\s+)?(continue|proceed|cancel|abort)/i,
    confidence: 0.8,
  },
  { type: "password" as const, pattern: /password\s*[:：]/i, confidence: 0.95, secure: true },
  { type: "sudo" as const, pattern: /\[sudo\]|sudo\s+password/i, confidence: 0.95, secure: true },
  { type: "login" as const, pattern: /(login|username|user\s*name)\s*[:：]/i, confidence: 0.85 },
  {
    type: "api_key" as const,
    pattern: /(api[-\s]?key|api[-\s]?token|secret\s+key|access\s+key)\s*[:：]/i,
    confidence: 0.85,
    secure: true,
  },
  {
    type: "oauth" as const,
    pattern: /oauth|authorize\s+(app|application|device)/i,
    confidence: 0.7,
  },
  { type: "input" as const, pattern: /^enter\s+value/i, confidence: 0.6 },
  { type: "approval" as const, pattern: /\([Yy]\/[Nn]\)/i, confidence: 0.85 },
  {
    type: "approval" as const,
    pattern: /^\[.\]\s+(continue|proceed|approve|confirm|do it)/i,
    confidence: 0.7,
  },
  {
    type: "permission" as const,
    pattern: /permission\s+(denied|required|needed)/i,
    confidence: 0.8,
  },
  {
    type: "login" as const,
    pattern: /token\s*(expired|invalid|required)/i,
    confidence: 0.75,
  },
  {
    type: "input" as const,
    pattern: /^>\s+$/m,
    confidence: 0.35,
  },
];

export const MULTI_LINE_PATTERNS = [
  {
    type: "approval" as const,
    patterns: [/do you want to/i, /would you like to/i, /are you sure/i],
    endPattern: /\[\s*[YyNn?]+\s*\]|\([YyNn?]+\)|\[y\/n\]|\(y\/n\)/,
    confidence: 0.9,
  },
  {
    type: "input" as const,
    patterns: [/please enter/i, /provide (your|a)/i, /what (is|would|should)/i],
    endPattern: /[:：]\s*$/,
    confidence: 0.7,
  },
  {
    type: "approval" as const,
    patterns: [/review the (changes|diff|summary)/i, /check the (above|following)/i],
    endPattern: /(proceed|continue|apply|confirm)\??$/i,
    confidence: 0.7,
  },
];

export interface DetectedPrompt {
  type:
    | "approval"
    | "input"
    | "password"
    | "sudo"
    | "login"
    | "api_key"
    | "oauth"
    | "permission"
    | "generic_input";
  confidence: number;
  matchedText: string;
  pattern: string;
  requiresSecureInput: boolean;
  suggestedDefault?: string;
}

export interface PromptDetectionResult {
  prompts: DetectedPrompt[];
  isWaiting: boolean;
  bestPrompt: DetectedPrompt | null;
}

export class PromptDetector {
  private lastOutputTime: number;
  private readonly silenceThresholdMs: number;
  private readonly stuckThresholdMs: number;
  private recentLines: string[] = [];
  private readonly maxRecentLines: number;
  private multiLineBuffer: string[] = [];

  constructor(silenceThresholdMs = 15000, stuckThresholdMs = 60000, maxRecentLines = 20) {
    this.lastOutputTime = Date.now();
    this.silenceThresholdMs = silenceThresholdMs;
    this.stuckThresholdMs = stuckThresholdMs;
    this.maxRecentLines = maxRecentLines;
  }

  recordOutput(): void {
    this.lastOutputTime = Date.now();
  }

  analyzeText(text: string): PromptDetectionResult {
    this.recentLines.push(text);
    if (this.recentLines.length > this.maxRecentLines) {
      this.recentLines.shift();
    }

    const multiLineResult = this.checkMultiLine(buildRecentWindow(this.recentLines));
    if (multiLineResult) return multiLineResult;

    const singleLineResult = this.analyzeSingleLine(text);
    if (singleLineResult.isWaiting) return singleLineResult;

    return singleLineResult;
  }

  analyzeRecentWindow(): PromptDetectionResult {
    const window = buildRecentWindow(this.recentLines);
    const multiLine = this.checkMultiLine(window);
    if (multiLine) return multiLine;

    for (const line of this.recentLines) {
      const result = this.analyzeSingleLine(line);
      if (result.isWaiting) return result;
    }

    return { prompts: [], isWaiting: false, bestPrompt: null };
  }

  private analyzeSingleLine(text: string): PromptDetectionResult {
    const prompts: DetectedPrompt[] = [];
    for (const entry of PROMPT_PATTERNS) {
      const match = text.match(entry.pattern);
      if (match) {
        prompts.push({
          type: entry.type,
          confidence: entry.confidence,
          matchedText: match[0],
          pattern: entry.pattern.source,
          requiresSecureInput: "secure" in entry ? (entry as { secure: boolean }).secure : false,
          suggestedDefault: this.getSuggestedDefault(entry.type),
        });
      }
    }

    prompts.sort((a, b) => b.confidence - a.confidence);

    return {
      prompts,
      isWaiting: prompts.length > 0 && prompts[0]!.confidence >= 0.6,
      bestPrompt: prompts.length > 0 ? prompts[0]! : null,
    };
  }

  private checkMultiLine(context: string): PromptDetectionResult | null {
    for (const multi of MULTI_LINE_PATTERNS) {
      const matched = multi.patterns.some((p) => p.test(context));
      if (!matched) continue;
      if (multi.endPattern.test(context)) {
        return {
          prompts: [
            {
              type: multi.type,
              confidence: multi.confidence,
              matchedText: context.slice(-200),
              pattern: multi.patterns.map((p) => p.source).join("|"),
              requiresSecureInput: false,
              suggestedDefault: this.getSuggestedDefault(multi.type),
            },
          ],
          isWaiting: true,
          bestPrompt: {
            type: multi.type,
            confidence: multi.confidence,
            matchedText: context.slice(-200),
            pattern: multi.patterns.map((p) => p.source).join("|"),
            requiresSecureInput: false,
            suggestedDefault: this.getSuggestedDefault(multi.type),
          },
        };
      }
    }
    return null;
  }

  checkSilence(currentTime: number): DetectedPrompt | null {
    const elapsed = currentTime - this.lastOutputTime;
    if (elapsed >= this.stuckThresholdMs) {
      return {
        type: "generic_input",
        confidence: 0.3,
        matchedText: `No output for ${Math.floor(elapsed / 1000)}s`,
        pattern: "silence_timeout",
        requiresSecureInput: false,
        suggestedDefault: "",
      };
    }
    return null;
  }

  isSilent(currentTime: number): boolean {
    return currentTime - this.lastOutputTime >= this.silenceThresholdMs;
  }

  isStuck(currentTime: number): boolean {
    return currentTime - this.lastOutputTime >= this.stuckThresholdMs;
  }

  silenceElapsed(currentTime: number): number {
    return currentTime - this.lastOutputTime;
  }

  getRecentLines(): string[] {
    return [...this.recentLines];
  }

  private getSuggestedDefault(type: DetectedPrompt["type"]): string | undefined {
    switch (type) {
      case "approval":
        return "y";
      case "input":
        return undefined;
      case "password":
        return undefined;
      case "sudo":
        return undefined;
      case "login":
        return undefined;
      case "api_key":
        return undefined;
      case "oauth":
        return undefined;
      case "permission":
        return undefined;
      case "generic_input":
        return undefined;
    }
  }
}

function buildRecentWindow(lines: string[]): string {
  return lines.join("\n");
}
