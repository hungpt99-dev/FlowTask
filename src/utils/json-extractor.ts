export interface JsonExtractionResult {
  jsonText: string;
  source: "full_output" | "fenced_json" | "first_object";
}

export class JsonExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonExtractionError";
  }
}

export function extractJsonObject(output: string): JsonExtractionResult {
  const trimmed = output.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    tryParse(trimmed);
    return { jsonText: trimmed, source: "full_output" };
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    const fenced = fenceMatch[1]!.trim();
    if (fenced.startsWith("{") && fenced.endsWith("}")) {
      tryParse(fenced);
      return { jsonText: fenced, source: "fenced_json" };
    }
  }

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace >= 0) {
    const extracted = extractBalancedBrace(trimmed, firstBrace);
    if (extracted) {
      tryParse(extracted);
      return { jsonText: extracted, source: "first_object" };
    }
  }

  throw new JsonExtractionError(
    "No valid JSON object found in output. The AI response does not contain a JSON object.",
  );
}

function extractBalancedBrace(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = startIndex;

  for (let i = start; i < text.length; i++) {
    const char = text[i]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\" && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

function tryParse(text: string): void {
  try {
    JSON.parse(text);
  } catch (err) {
    throw new JsonExtractionError(
      `Extracted text is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
