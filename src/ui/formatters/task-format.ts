import picocolors from "picocolors";
import { coloredSymbol, coloredStatus } from "./status-format.js";

export function formatTaskLine(
  task: { id: string; title: string; status: string; executor?: string; description?: string },
  index?: number,
  total?: number,
): string {
  const symbol = coloredSymbol(task.status);
  const status = coloredStatus(task.status);
  const prefix = index !== undefined && total ? `[${index}/${total}] ` : "";
  const executor = task.executor ? picocolors.dim(` (${task.executor})`) : "";
  return `  ${symbol} ${prefix}${picocolors.cyan(task.title)}${executor} — ${status}`;
}

export function formatTaskCompact(task: {
  id: string;
  title: string;
  status: string;
  executor?: string;
}): string {
  const symbol = coloredSymbol(task.status);
  return `  ${symbol} ${task.title.padEnd(40)} ${coloredStatus(task.status.padEnd(10))} ${picocolors.dim(task.executor ?? "shell")}`;
}
