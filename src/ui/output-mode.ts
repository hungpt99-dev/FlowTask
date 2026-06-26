export type OutputMode = "rich" | "plain" | "json";

export interface OutputOptions {
  mode: OutputMode;
  verbose: boolean;
  quiet: boolean;
  debug: boolean;
}

export function detectOutputMode(
  forceUi?: boolean,
  forceNoUi?: boolean,
  forceJson?: boolean,
): OutputMode {
  if (forceJson) return "json";
  if (forceUi) return "rich";
  if (forceNoUi) return "plain";
  if (process.env.CI === "true" || process.env.CI === "1") return "plain";
  if (!process.stdout.isTTY) return "plain";
  return "rich";
}

export function createOutputOptions(options: {
  ui?: boolean;
  noUi?: boolean;
  json?: boolean;
  verbose?: boolean;
  debug?: boolean;
  quiet?: boolean;
}): OutputOptions {
  return {
    mode: detectOutputMode(options.ui, options.noUi, options.json),
    verbose: options.verbose ?? false,
    quiet: options.quiet ?? false,
    debug: options.debug ?? false,
  };
}
