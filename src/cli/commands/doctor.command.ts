import picocolors from "picocolors";
import ora from "ora";
import { ProjectManager } from "../../core/project-manager.js";
import path from "node:path";

export async function doctorCommand(): Promise<void> {
  const rootPath = process.cwd();
  console.log(picocolors.cyan("\nFlowTask Doctor"));
  console.log(picocolors.dim("─".repeat(40)));
  console.log("");

  const checks: Array<{ name: string; run: () => Promise<{ ok: boolean; message: string }> }> = [
    {
      name: "Node.js version",
      run: async () => {
        const major = parseInt(process.version.slice(1), 10);
        return { ok: major >= 22, message: process.version };
      },
    },
    {
      name: "Project initialized",
      run: async () => {
        const manager = new ProjectManager();
        const init = await manager.isInitialized(rootPath);
        return init
          ? { ok: true, message: "found" }
          : { ok: false, message: "not initialized (run: flowtask init)" };
      },
    },
    {
      name: "Git available",
      run: async () => {
        const { spawnWithPromise } = await import("../../utils/process.js");
        try {
          const result = await spawnWithPromise("git", ["--version"]);
          return { ok: true, message: result.stdout.trim() };
        } catch {
          return { ok: false, message: "not found" };
        }
      },
    },
    {
      name: "Config valid",
      run: async () => {
        const manager = new ProjectManager();
        try {
          const config = await manager.loadConfig(rootPath);
          return { ok: true, message: `v${config.version}, executor: ${config.defaultExecutor}` };
        } catch {
          return { ok: false, message: "invalid config" };
        }
      },
    },
    {
      name: "Rule paths accessible",
      run: async () => {
        const manager = new ProjectManager();
        try {
          const config = await manager.loadConfig(rootPath);
          const { RuleSourceResolver } = await import("../../rules/rule-source-resolver.js");
          const resolver = new RuleSourceResolver();
          const files = await resolver.resolvePaths(config.rules.paths, rootPath);
          return { ok: true, message: `${files.length} rule files found` };
        } catch {
          return { ok: false, message: "rule paths not accessible" };
        }
      },
    },
    {
      name: ".flowtask structure",
      run: async () => {
        const { fileExists } = await import("../../utils/fs.js");
        const required = [
          "project.json",
          "config.json",
          "state.json",
          "run-index.json",
          "task-index.json",
        ];
        const results = await Promise.all(
          required.map((f) => fileExists(path.join(rootPath, ".flowtask", f))),
        );
        const missing = required.filter((_, i) => !results[i]);
        return missing.length === 0
          ? { ok: true, message: "all files present" }
          : { ok: false, message: `missing: ${missing.join(", ")}` };
      },
    },
  ];

  let allOk = true;
  for (const check of checks) {
    const spinner = ora({ text: check.name, color: "blue" }).start();
    const result = await check.run();
    if (result.ok) {
      spinner.succeed(`${check.name}: ${picocolors.dim(result.message)}`);
    } else {
      spinner.fail(`${check.name}: ${picocolors.red(result.message)}`);
      allOk = false;
    }
  }

  console.log("");
  if (allOk) {
    console.log(picocolors.green("✓ All checks passed. System is healthy."));
  } else {
    console.log(picocolors.yellow("Some checks failed. Review the issues above."));
    process.exit(1);
  }
}
