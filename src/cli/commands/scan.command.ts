import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { WorkspaceScanner } from "../../core/scanner.js";

export async function scanCommand(options: {
  prompt?: string;
  output?: string;
  json?: boolean;
}): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const scanner = new WorkspaceScanner({
    cacheDir: options.output,
  });

  console.log(picocolors.cyan("\nScanning workspace..."));
  console.log(picocolors.dim("  Scanning files and building compact context..."));

  const context = await scanner.scan(rootPath, options.prompt);

  if (options.json) {
    console.log(JSON.stringify(context, null, 2));
    return;
  }

  console.log(picocolors.cyan(`\nScan Results`));
  console.log(picocolors.dim("  " + "─".repeat(50)));
  console.log(`  ${picocolors.dim("Total files:")}  ${context.totalFiles}`);
  console.log(`  ${picocolors.dim("Total size:")}   ${formatScanSize(context.totalSize)}`);
  console.log(`  ${picocolors.dim("Token est:")}    ${context.tokenEstimate}`);
  console.log(
    `  ${picocolors.dim("Scanned at:")}   ${new Date(context.scannedAt).toLocaleString()}`,
  );

  const categories = Object.entries(context.categories).filter(([, count]) => count > 0);
  if (categories.length > 0) {
    console.log(picocolors.dim("\n  Categories:"));
    for (const [cat, count] of categories) {
      console.log(`    ${picocolors.dim("•")} ${cat}: ${count}`);
    }
  }

  if (context.items.length > 0) {
    console.log(picocolors.dim("\n  Files:"));
    for (const item of context.items.slice(0, 30)) {
      const markers: string[] = [];
      if (item.isNew) markers.push(picocolors.green("NEW"));
      if (item.isModified) markers.push(picocolors.yellow("MOD"));
      const markerStr = markers.length > 0 ? ` [${markers.join(",")}]` : "";
      const icon = typeIcon(item.type);
      console.log(`    ${icon} ${picocolors.dim(item.relativePath)}${markerStr}`);
    }
    if (context.items.length > 30) {
      console.log(picocolors.dim(`    ... and ${context.items.length - 30} more files`));
    }
  }

  if (options.output) {
    console.log(picocolors.dim(`\n  Output written to: ${options.output}`));
  }
  console.log("");
}

function formatScanSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function typeIcon(type: string): string {
  switch (type) {
    case "CODE":
      return picocolors.blue("\u2261");
    case "MARKDOWN":
      return picocolors.magenta("#");
    case "DOCUMENT":
      return picocolors.cyan("\u2630");
    case "CONFIG":
      return picocolors.yellow("\u2699");
    case "DATA":
      return picocolors.green("\u25A3");
    case "IMAGE":
      return picocolors.yellow("\u263C");
    case "NOTE":
      return picocolors.magenta("\u270E");
    default:
      return picocolors.dim("\u2022");
  }
}
