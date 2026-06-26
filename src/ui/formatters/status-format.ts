import picocolors from "picocolors";

export function statusSymbol(status: string): string {
  switch (status) {
    case "done":
    case "completed":
    case "passed":
      return "✓";
    case "running":
    case "in_progress":
      return "●";
    case "failed":
      return "✗";
    case "pending":
    case "created":
    case "planning":
      return "○";
    case "skipped":
      return "−";
    case "cancelled":
      return "−";
    case "blocked":
      return "⊘";
    case "interrupted":
    case "paused":
      return "⏸";
    case "retrying":
      return "↻";
    case "warning":
      return "!";
    default:
      return "·";
  }
}

export function statusColor(status: string): (s: string) => string {
  switch (status) {
    case "done":
    case "completed":
    case "passed":
      return picocolors.green;
    case "running":
    case "in_progress":
    case "planning":
      return picocolors.cyan;
    case "failed":
      return picocolors.red;
    case "pending":
    case "created":
      return picocolors.dim;
    case "skipped":
    case "cancelled":
      return picocolors.yellow;
    case "interrupted":
    case "paused":
      return picocolors.yellow;
    case "blocked":
      return picocolors.red;
    default:
      return picocolors.dim;
  }
}

export function coloredSymbol(status: string): string {
  const color = statusColor(status);
  return color(statusSymbol(status));
}

export function coloredStatus(status: string): string {
  const color = statusColor(status);
  return color(status);
}

export function projectStatusLabel(status: string): string {
  switch (status) {
    case "idle":
      return picocolors.green("idle");
    case "has_running_run":
      return picocolors.cyan("running");
    case "has_failed_run":
      return picocolors.red("failed");
    case "has_interrupted_run":
      return picocolors.yellow("interrupted");
    default:
      return picocolors.dim(status);
  }
}
