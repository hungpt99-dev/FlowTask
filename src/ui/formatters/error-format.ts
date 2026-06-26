import picocolors from "picocolors";

export interface ErrorSuggestion {
  label: string;
  command: string;
}

export function formatErrorBlock(
  title: string,
  reason: string,
  suggestions?: ErrorSuggestion[],
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${picocolors.red("✗")} ${picocolors.bold(title)}`);
  lines.push("");
  lines.push(`  ${picocolors.dim("Reason:")}`);
  lines.push(`  ${reason}`);
  lines.push("");

  if (suggestions && suggestions.length > 0) {
    lines.push(`  ${picocolors.dim("Next steps:")}`);
    for (const s of suggestions) {
      lines.push(`  ${picocolors.cyan(`  ${s.label}:`)} ${s.command}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatStopMessage(runId: string): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${picocolors.yellow("⏸ Stopping FlowTask gracefully...")}`);
  lines.push(`  ${picocolors.dim("  Task marked as interrupted.")}`);
  lines.push(`  ${picocolors.dim("  Run state saved.")}`);
  lines.push("");
  lines.push(`  ${picocolors.dim("Resume later:")}`);
  lines.push(`  ${picocolors.cyan("  flowtask resume")} ${runId ?? "<runId>"}`);
  lines.push("");
  return lines.join("\n");
}
