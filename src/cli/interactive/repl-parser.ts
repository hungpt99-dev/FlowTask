export interface ReplCommand {
  name: string;
  args: string[];
  raw: string;
  isNaturalPrompt: boolean;
}

const KNOWN_COMMANDS = new Set([
  "run",
  "status",
  "runs",
  "tasks",
  "logs",
  "resume",
  "retry",
  "inspect",
  "stop",
  "cancel",
  "doctor",
  "rules",
  "help",
  "exit",
  "quit",
  "clear",
]);

export function parseReplInput(input: string): ReplCommand {
  const trimmed = input.trim();
  const raw = trimmed;

  if (!trimmed) {
    return { name: "", args: [], raw, isNaturalPrompt: false };
  }

  if (trimmed.startsWith("/")) {
    const withoutSlash = trimmed.slice(1);
    return { name: withoutSlash, args: [], raw, isNaturalPrompt: false };
  }

  const parts = tokenize(trimmed);
  const first = parts[0]?.toLowerCase() ?? "";

  if (KNOWN_COMMANDS.has(first)) {
    const rest = parts.slice(1).join(" ");
    if (first === "run" && rest) {
      return { name: "run", args: [rest], raw, isNaturalPrompt: false };
    }
    if (first === "retry" && parts.length >= 2) {
      return { name: "retry", args: [parts[1]!, ...parts.slice(2)], raw, isNaturalPrompt: false };
    }
    if (first === "inspect" && parts.length >= 2) {
      return { name: "inspect", args: [parts[1]!], raw, isNaturalPrompt: false };
    }
    if (first === "cancel" && parts.length >= 2) {
      return { name: "cancel", args: [parts[1]!], raw, isNaturalPrompt: false };
    }
    if (first === "resume" && parts.length >= 2) {
      return { name: "resume", args: [parts.slice(1).join(" ")], raw, isNaturalPrompt: false };
    }
    if (first === "rules" && parts.length >= 2) {
      return { name: "rules", args: parts.slice(1), raw, isNaturalPrompt: false };
    }
    if (first === "logs") {
      return { name: "logs", args: rest ? [rest] : [], raw, isNaturalPrompt: false };
    }
    if (first === "run") {
      return { name: "run", args: [], raw, isNaturalPrompt: false };
    }
    return { name: first, args: parts.slice(1), raw, isNaturalPrompt: false };
  }

  return { name: "run", args: [trimmed], raw, isNaturalPrompt: true };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}
