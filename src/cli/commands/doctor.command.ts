import picocolors from "picocolors";
import ora from "ora";
import { ProjectManager } from "../../core/project-manager.js";
import { ConfigLoader } from "../../config/config-loader.js";
import { spawnWithPromise } from "../../utils/process.js";
import path from "node:path";

export async function doctorCommand(): Promise<void> {
  const rootPath = process.cwd();
  console.log(picocolors.cyan("\nFlowTask Doctor"));
  console.log(picocolors.dim("─".repeat(60)));
  console.log("");

  const systemChecks: Array<{
    name: string;
    run: () => Promise<{ ok: boolean; message: string }>;
  }> = [
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
        try {
          const result = await spawnWithPromise("git", ["--version"]);
          return { ok: true, message: result.stdout.trim() };
        } catch {
          return { ok: false, message: "not found" };
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
  for (const check of systemChecks) {
    const spinner = ora({ text: check.name, color: "blue" }).start();
    const result = await check.run();
    if (result.ok) {
      spinner.succeed(`${check.name}: ${picocolors.dim(result.message)}`);
    } else {
      spinner.fail(`${check.name}: ${picocolors.red(result.message)}`);
      allOk = false;
    }
  }

  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);
  const executorNames = Object.keys(config.executors ?? {});

  console.log(picocolors.cyan("\nConfigured Executors"));
  console.log(picocolors.dim("─".repeat(60)));

  const header = `${"Name".padEnd(14)}${"Type".padEnd(10)}${"Available".padEnd(12)}${"Input Mode".padEnd(14)}${"Timeout"}`;
  console.log(`  ${picocolors.bold(header)}`);
  console.log(picocolors.dim(`  ${"─".repeat(60)}`));

  for (const name of executorNames) {
    const entry = config.executors[name]!;
    const inputMode = entry.inputMode ?? "argument";
    const timeout = entry.timeoutMs ? `${entry.timeoutMs}ms` : "-";

    if (entry.type === "shell") {
      const avail = picocolors.green("yes");
      console.log(
        `  ${name.padEnd(14)}${"shell".padEnd(10)}${avail.padEnd(12)}${"-".padEnd(14)}${timeout}`,
      );
      continue;
    }

    const cmdName = entry.command?.split(/\s+/)[0] ?? "?";
    try {
      await spawnWithPromise("which", [cmdName], { timeout: 3000 });
      const avail = picocolors.green("yes");
      console.log(
        `  ${name.padEnd(14)}${"command".padEnd(10)}${avail.padEnd(12)}${inputMode.padEnd(14)}${timeout}`,
      );
    } catch {
      const avail = picocolors.red("no");
      console.log(
        `  ${name.padEnd(14)}${"command".padEnd(10)}${avail.padEnd(12)}${inputMode.padEnd(14)}${timeout}`,
      );
      const cmdDisplay = entry.command ?? "?";
      console.log(
        `  ${"".padEnd(14)}${picocolors.dim(`Command: ${cmdDisplay} — not found. Install or update config.`)}`,
      );
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
