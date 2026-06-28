import type { ValidationCheck } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import { fileExists, readTextFile } from "../utils/fs.js";
import path from "node:path";

const FILE_KEYWORDS =
  /\b(report|document|file|output|artifact|result|created|written|saved|exist)\b/i;
const TEST_KEYWORDS = /\b(test|validation|lint|typecheck|quality|check|verify|pass|fail|exit)\b/i;
const CONTENT_KEYWORDS =
  /\b(documented|reviewed|analyzed|defined|described|outline|plan|section|structure)\b/i;
const COMMAND_KEYWORDS = /\b(command|run|execute|process)\b/i;
const OUTPUT_PATH_PATTERN = /[`"']?([\w./-]+\.\w+)[`"']?/g;

interface EvidenceGatherer {
  output: string;
  processPassed: boolean;
  artifacts: string[];
}

function classifyExpectedResult(text: string): "file" | "test" | "content" | "command" | "mixed" {
  const hasFile = FILE_KEYWORDS.test(text);
  const hasTest = TEST_KEYWORDS.test(text);
  const hasContent = CONTENT_KEYWORDS.test(text);
  const hasCommand = COMMAND_KEYWORDS.test(text);

  const matches = [hasFile, hasTest, hasContent, hasCommand].filter(Boolean).length;
  if (matches > 1) return "mixed";

  if (hasFile) return "file";
  if (hasTest) return "test";
  if (hasContent) return "content";
  if (hasCommand) return "command";
  return "mixed";
}

function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  const cloned = new RegExp(OUTPUT_PATH_PATTERN.source, OUTPUT_PATH_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = cloned.exec(text)) !== null) {
    const p = match[1]!;
    if (/\.\w{1,6}$/.test(p) && !p.startsWith("http")) {
      paths.push(p);
    }
  }
  return paths;
}

async function checkFileEvidence(
  filePaths: string[],
  projectRoot: string,
): Promise<{ evidence: string[]; successCount: number; totalCount: number }> {
  const evidence: string[] = [];
  let successCount = 0;
  const resolvedRoot = path.resolve(projectRoot);

  for (const fp of filePaths) {
    const fullPath = path.isAbsolute(fp) ? fp : path.resolve(projectRoot, fp);
    const relative = path.relative(resolvedRoot, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      continue;
    }
    const exists = await fileExists(fullPath);
    if (exists) {
      const content = await readTextFile(fullPath).catch(() => "");
      if (content.trim().length > 0) {
        evidence.push(`Expected file exists with content: ${fp}`);
        successCount++;
      } else {
        evidence.push(`Expected file exists (empty): ${fp}`);
        successCount++;
      }
    } else {
      evidence.push(`Expected file not found: ${fp}`);
    }
  }

  return { evidence, successCount, totalCount: filePaths.length };
}

const STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "were",
  "they",
  "them",
  "their",
  "will",
  "would",
  "could",
  "should",
  "into",
  "over",
  "such",
  "each",
  "than",
  "then",
  "also",
  "just",
  "more",
  "after",
  "before",
  "about",
  "other",
  "which",
  "what",
  "when",
  "where",
  "there",
  "these",
  "those",
  "being",
  "done",
  "some",
  "make",
  "made",
  "take",
  "took",
  "very",
  "well",
  "even",
  "still",
  "already",
  "much",
  "many",
  "both",
  "each",
  "does",
  "used",
  "using",
  "like",
  "just",
  "than",
  "then",
  "here",
  "your",
  "their",
  "come",
  "came",
  "must",
  "might",
  "shall",
]);

function checkOutputEvidence(
  expectedResult: string,
  gatherer: EvidenceGatherer,
): { evidence: string[]; matched: boolean } {
  const evidence: string[] = [];
  const output = gatherer.output;
  const lowerExpected = expectedResult.toLowerCase();
  const lowerOutput = output.toLowerCase();

  const textMatch = lowerOutput.includes(lowerExpected);
  if (textMatch) {
    evidence.push("Expected outcome mentioned in executor output");
    return { evidence, matched: true };
  }

  const keywords = expectedResult
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()));
  if (keywords.length === 0) return { evidence, matched: false };

  const matchedKeywords = keywords.filter((kw) => lowerOutput.includes(kw.toLowerCase()));
  const threshold = Math.max(1, Math.ceil(keywords.length * 0.4));
  if (matchedKeywords.length >= threshold) {
    evidence.push("Key terms from expected outcome found in executor output");
    return { evidence, matched: true };
  }

  return { evidence, matched: false };
}

function checkArtifactEvidence(
  expectedResult: string,
  gatherer: EvidenceGatherer,
): { evidence: string[]; matched: boolean } {
  const evidence: string[] = [];
  const lowerExpected = expectedResult.toLowerCase();

  for (const artifact of gatherer.artifacts) {
    const lowerArtifact = artifact.toLowerCase();
    if (lowerExpected.includes(lowerArtifact) || lowerArtifact.includes(lowerExpected)) {
      evidence.push(`Artifact matches expected outcome: ${artifact}`);
      return { evidence, matched: true };
    }
  }

  if (gatherer.artifacts.length > 0 && gatherer.processPassed) {
    evidence.push(`Artifacts produced (${gatherer.artifacts.length}) with successful process`);
    return { evidence, matched: true };
  }

  return { evidence, matched: false };
}

function determineVerdict(
  processPassed: boolean,
  outputMatched: boolean,
  fileEvidenceCount: number,
  fileTotalCount: number,
  artifactMatched: boolean,
  resultType: string,
): { status: ValidationCheck["status"]; message: string } {
  const hasFileEvidence = fileTotalCount > 0 && fileEvidenceCount > 0;
  const allFilesPresent = fileTotalCount > 0 && fileEvidenceCount === fileTotalCount;

  if (resultType === "test") {
    if (processPassed) {
      return {
        status: "passed",
        message: "Process completed successfully — expected test outcome achieved",
      };
    }
    return { status: "failed", message: "Process failed — expected test outcome not achieved" };
  }

  if (outputMatched && processPassed) {
    return {
      status: "passed",
      message: "Expected outcome achieved — evidence found in output and process",
    };
  }

  if (allFilesPresent) {
    return { status: "passed", message: "All expected files exist with content" };
  }

  if (artifactMatched && processPassed) {
    return { status: "passed", message: "Expected outcome achieved — artifacts match expectation" };
  }

  if (processPassed && hasFileEvidence) {
    return { status: "passed", message: "Expected outcome achieved — file evidence found" };
  }

  if (outputMatched) {
    return {
      status: "warning",
      message: "Expected outcome mentioned in output but process issues",
    };
  }

  if (hasFileEvidence) {
    return { status: "warning", message: "Some expected files found, but process had issues" };
  }

  if (processPassed) {
    return {
      status: "warning",
      message: "Process completed but expected outcome not verifiable from available evidence",
    };
  }

  return {
    status: "failed",
    message: "Expected outcome not achieved — no matching evidence found",
  };
}

export class OutcomeComparisonValidator {
  async validate(
    expectedResult: string,
    executorResult: ExecutorResult,
    projectRoot: string,
  ): Promise<ValidationCheck> {
    const output = executorResult.output ?? "";
    const processPassed = executorResult.exitCode === 0;
    const artifacts = executorResult.artifacts ?? [];
    const gatherer: EvidenceGatherer = { output, processPassed, artifacts };

    const resultType = classifyExpectedResult(expectedResult);
    const evidence: string[] = [];

    const outputResult = checkOutputEvidence(expectedResult, gatherer);
    evidence.push(...outputResult.evidence);

    const artifactResult = checkArtifactEvidence(expectedResult, gatherer);
    evidence.push(...artifactResult.evidence);

    const filePaths = extractFilePaths(expectedResult);
    let fileEvidenceCount = 0;
    let fileTotalCount = 0;
    if (filePaths.length > 0) {
      const fileResult = await checkFileEvidence(filePaths, projectRoot);
      evidence.push(...fileResult.evidence);
      fileEvidenceCount = fileResult.successCount;
      fileTotalCount = fileResult.totalCount;
    }

    if (processPassed) {
      evidence.push("Process completed successfully");
    } else {
      evidence.push(`Process failed with exit code ${executorResult.exitCode ?? "unknown"}`);
    }

    const verdict = determineVerdict(
      processPassed,
      outputResult.matched,
      fileEvidenceCount,
      fileTotalCount,
      artifactResult.matched,
      resultType,
    );

    const combinedEvidence =
      evidence.length > 0 ? evidence.join("; ") : "No automated evidence available";

    return {
      type: "outcome_comparison",
      status: verdict.status,
      message: verdict.message,
      evidence: combinedEvidence,
      details: {
        expectedResult,
        resultType,
        processPassed,
        outputMatched: outputResult.matched,
        artifactMatched: artifactResult.matched,
        filesFound: fileEvidenceCount,
        filesExpected: fileTotalCount,
      },
    };
  }
}
