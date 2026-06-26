import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { RuleSourceResolver } from "../../rules/rule-source-resolver.js";
import { ConfigLoader } from "../../config/config-loader.js";
import path from "node:path";

export async function rulesCommand(action?: string, rulePath?: string): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();
  const initialized = await manager.isInitialized(rootPath);

  if (!initialized) {
    console.log(picocolors.yellow("FlowTask not initialized. Run: flowtask init"));
    process.exit(0);
  }

  const config = await manager.loadConfig(rootPath);
  const resolver = new RuleSourceResolver();

  switch (action) {
    case "list": {
      console.log(picocolors.cyan("\nConfigured Rule Sources"));
      console.log(picocolors.dim("─".repeat(60)));
      console.log(
        `  Enabled: ${config.rules.enabled ? picocolors.green("yes") : picocolors.red("no")}`,
      );
      console.log(`  Required: ${config.rules.required ? "yes" : "no"}`);
      console.log(`  Max file size: ${config.rules.maxFileSizeKb} KB`);
      console.log("");

      for (const rulePath of config.rules.paths) {
        const icon = rulePath.includes("*") ? "🔍" : "📄";
        console.log(`  ${picocolors.cyan(icon)} ${rulePath}`);
      }
      console.log(picocolors.dim("\n  Use: flowtask rules scan — to find existing rule files"));
      console.log(picocolors.dim("  Use: flowtask rules add <path> — to add a rule path"));
      break;
    }

    case "scan": {
      console.log(picocolors.cyan("\nScanning for common rule files..."));
      console.log(picocolors.dim("─".repeat(60)));

      const found = await resolver.scanCommonFiles(rootPath);
      if (found.length === 0) {
        console.log(picocolors.yellow("  No common rule files found."));
        console.log(
          picocolors.dim(
            "  Create rule files in .flowtask/rules/ or use existing project rule files.",
          ),
        );
      } else {
        console.log(picocolors.green(`  Found ${found.length} rule file(s):\n`));
        for (const file of found) {
          const relativePath = path.relative(rootPath, file);
          const isConfigured = config.rules.paths.some((p) => {
            if (p.includes("*")) {
              const base = p.replace(/\/\*\.\w+$/, "");
              return relativePath.startsWith(base);
            }
            return p === relativePath;
          });
          const status = isConfigured
            ? picocolors.green("✓ configured")
            : picocolors.yellow("○ not configured");
          console.log(`  ${status} ${relativePath}`);
        }
      }
      break;
    }

    case "add": {
      if (!rulePath) {
        console.log(picocolors.red("Usage: flowtask rules add <path>"));
        console.log(picocolors.dim("Example: flowtask rules add docs/MY_RULES.md"));
        process.exit(1);
      }

      const absolutePath = path.isAbsolute(rulePath) ? rulePath : path.join(rootPath, rulePath);
      const validation = await resolver.validatePath(absolutePath);
      if (!validation.valid) {
        console.log(picocolors.yellow(`Warning: ${validation.error}`));
        console.log(picocolors.dim("Adding to config anyway..."));
      }

      const loader = new ConfigLoader();
      const existingPaths = config.rules.paths;
      if (existingPaths.includes(rulePath)) {
        console.log(picocolors.yellow(`Rule path already configured: ${rulePath}`));
        process.exit(0);
      }

      config.rules.paths = [...existingPaths, rulePath];
      await loader.save(rootPath, config);
      console.log(picocolors.green(`✓ Added rule path: ${rulePath}`));
      break;
    }

    case "validate": {
      console.log(picocolors.cyan("\nValidating rule paths..."));
      console.log(picocolors.dim("─".repeat(60)));
      let allValid = true;

      for (const rulePath of config.rules.paths) {
        if (rulePath.includes("*")) {
          const files = await resolver.resolvePaths([rulePath], rootPath);
          if (files.length === 0) {
            console.log(
              `  ${picocolors.yellow("⚠")} ${rulePath} — ${picocolors.yellow("no files matched")}`,
            );
            if (config.rules.required) allValid = false;
          } else {
            console.log(`  ${picocolors.green("✓")} ${rulePath} — ${files.length} file(s) matched`);
          }
        } else {
          const fullPath = path.isAbsolute(rulePath) ? rulePath : path.join(rootPath, rulePath);
          const valid = await resolver.validatePath(fullPath);
          if (valid.valid) {
            console.log(`  ${picocolors.green("✓")} ${rulePath}`);
          } else {
            console.log(`  ${picocolors.red("✗")} ${rulePath} — ${picocolors.red(valid.error!)}`);
            if (config.rules.required) allValid = false;
          }
        }
      }

      if (allValid) {
        console.log(picocolors.green("\n✓ All rule paths validated."));
      } else {
        console.log(picocolors.yellow("\n⚠ Some required rule paths have issues."));
      }
      break;
    }

    default: {
      console.log(picocolors.yellow(`Unknown action: ${action}`));
      console.log(picocolors.cyan("Available actions: list, scan, add <path>, validate"));
    }
  }
}
