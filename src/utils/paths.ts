import path from "node:path";

export const FLOWTASK_DIR = ".flowtask";
export const RULES_DIR = ".flowtask/rules";
export const STEPS_DIR = ".flowtask/steps";
export const RUNS_DIR = ".flowtask/runs";

export function projectJsonPath(rootPath: string): string {
  return path.join(rootPath, FLOWTASK_DIR, "project.json");
}

export function configJsonPath(rootPath: string): string {
  return path.join(rootPath, FLOWTASK_DIR, "config.json");
}

export function stateJsonPath(rootPath: string): string {
  return path.join(rootPath, FLOWTASK_DIR, "state.json");
}

export function runIndexPath(rootPath: string): string {
  return path.join(rootPath, FLOWTASK_DIR, "run-index.json");
}

export function taskIndexPath(rootPath: string): string {
  return path.join(rootPath, FLOWTASK_DIR, "task-index.json");
}

export function getRunDir(rootPath: string, runId: string): string {
  return path.join(rootPath, RUNS_DIR, runId);
}

export function runJsonPath(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "run.json");
}

export function promptMdPath(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "prompt.md");
}

export function rulesContextPath(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "rules-context.md");
}

export function planMdPath(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "plan.md");
}

export function tasksJsonPath(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "tasks.json");
}

export function runStateJsonPath(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "state.json");
}

export function eventsJsonlPath(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "events.jsonl");
}

export function finalReportPath(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "final-report.md");
}

export function getLogsDir(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "logs");
}

export function runtimeLogPath(rootPath: string, runId: string): string {
  return path.join(getLogsDir(rootPath, runId), "runtime.log");
}

export function validationLogPath(rootPath: string, runId: string): string {
  return path.join(getLogsDir(rootPath, runId), "validation.log");
}

export function taskLogPath(rootPath: string, runId: string, taskId: string): string {
  return path.join(getLogsDir(rootPath, runId), `${taskId}.log`);
}

export function getArtifactsDir(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "artifacts");
}

export function getContextDir(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "context");
}

export function getOutputsDir(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "outputs");
}

export function getSnapshotsDir(rootPath: string, runId: string): string {
  return path.join(getRunDir(rootPath, runId), "snapshots");
}

export function validationResultsPath(rootPath: string, runId: string): string {
  return path.join(getOutputsDir(rootPath, runId), "validation-results.json");
}

export function commandResultsPath(rootPath: string, runId: string): string {
  return path.join(getOutputsDir(rootPath, runId), "command-results.json");
}

export function gitBeforePath(rootPath: string, runId: string): string {
  return path.join(getOutputsDir(rootPath, runId), "git-before.txt");
}

export function gitAfterPath(rootPath: string, runId: string): string {
  return path.join(getOutputsDir(rootPath, runId), "git-after.txt");
}

export function gitDiffStatPath(rootPath: string, runId: string): string {
  return path.join(getOutputsDir(rootPath, runId), "git-diff-stat.txt");
}
