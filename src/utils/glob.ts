import fg from "fast-glob";

export interface GlobOptions {
  cwd?: string;
  absolute?: boolean;
  onlyFiles?: boolean;
}

export async function expandGlob(
  patterns: string | string[],
  options: GlobOptions = {},
): Promise<string[]> {
  const pats = Array.isArray(patterns) ? patterns : [patterns];
  return fg(pats, {
    dot: true,
    cwd: options.cwd,
    absolute: options.absolute ?? false,
    onlyFiles: options.onlyFiles ?? true,
    suppressErrors: true,
  });
}

export async function resolveRuleFiles(patterns: string[], cwd: string): Promise<string[]> {
  const files = await expandGlob(patterns, { cwd, absolute: true });
  return [...new Set(files)];
}
