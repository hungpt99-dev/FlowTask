import picocolors from "picocolors";
import ora from "ora";
import { ProjectManager } from "../../core/project-manager.js";
import { ConfigLoader } from "../../config/config-loader.js";
import { spawnWithPromise } from "../../utils/process.js";
import { ProviderRegistry } from "../../ai/provider-registry.js";
import path from "node:path";

export async function doctorCommand(options?: { providers?: boolean }): Promise<void> {
  const rootPath = process.cwd();
  console.log(picocolors.cyan("\nFlowTask Doctor"));
  console.log(picocolors.dim("─".repeat(60)));
  console.log("");

  const runProviderChecksOnly = options?.providers ?? false;

  if (!runProviderChecksOnly) {
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

    for (const check of systemChecks) {
      const spinner = ora({ text: check.name, color: "blue" }).start();
      const result = await check.run();
      if (result.ok) {
        spinner.succeed(`${check.name}: ${picocolors.dim(result.message)}`);
      } else {
        spinner.fail(`${check.name}: ${picocolors.red(result.message)}`);
      }
    }

    const loader = new ConfigLoader();
    const config = await loader.load(rootPath);

    console.log(picocolors.cyan("\nPlanner"));
    console.log(picocolors.dim("─".repeat(60)));
    const plannerConfig = config.planner!;
    console.log(`  Mode: ${picocolors.bold(plannerConfig.default)}`);
    console.log(`  Type: ${picocolors.bold(plannerConfig.type ?? "internal-ai")}`);

    if (plannerConfig.type === "internal-ai") {
      console.log(`  Provider: ${picocolors.bold(plannerConfig.provider)}`);
      console.log(`  Model: ${picocolors.bold(plannerConfig.model)}`);

      const providers = new ProviderRegistry(config);
      const apiKeyEnv = providers.getApiKeyEnv();
      if (apiKeyEnv) {
        console.log(`  API key env: ${apiKeyEnv}`);
        if (process.env[apiKeyEnv]) {
          console.log(`  API key available: ${picocolors.green("yes")}`);
        } else {
          console.log(
            `  API key available: ${picocolors.red("no")} — ${picocolors.yellow("AI planner will fallback to simple planner")}`,
          );
          console.log(
            `  ${picocolors.dim(`    Set ${apiKeyEnv}=your-api-key or run with --planner simple`)}`,
          );
        }
      }
    }
  }

  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);
  const providerRegistry = new ProviderRegistry(config);
  const allProviders = providerRegistry.listProviders();

  console.log(picocolors.cyan("\nAI Providers"));
  console.log(picocolors.dim("─".repeat(60)));

  for (const p of allProviders) {
    const spinner = ora({
      text: `${p.name} (${p.type})`,
      color: "blue",
    }).start();

    try {
      const provider = providerRegistry.getProvider(p.name);

      if (provider.healthCheck) {
        const healthResult = await provider.healthCheck({
          model: config.planner?.model,
          timeoutMs: 5000,
        });

        if (healthResult.ok) {
          spinner.succeed(
            `${picocolors.green("✓")} ${picocolors.bold(p.name.padEnd(16))} ${picocolors.dim(healthResult.message)}`,
          );
        } else {
          const icon =
            healthResult.kind === "missing_api_key" ? picocolors.yellow("!") : picocolors.red("✗");
          spinner.fail(
            `${icon} ${picocolors.bold(p.name.padEnd(16))} ${picocolors.yellow(healthResult.message)}`,
          );
          if (healthResult.suggestion) {
            console.log(`  ${"".padEnd(18)}${picocolors.dim(healthResult.suggestion)}`);
          }
        }
      } else {
        const status = p.apiKeyAvailable ? picocolors.green("✓") : picocolors.yellow("!");
        const keyStatus = p.apiKeyAvailable
          ? picocolors.dim("key found")
          : picocolors.yellow(`${p.apiKeyEnv ?? "no key"} missing`);
        spinner.succeed(
          `${status} ${picocolors.bold(p.name.padEnd(16))} ${p.type.padEnd(18)} ${keyStatus}`,
        );
      }
    } catch (err) {
      spinner.fail(
        `${picocolors.red("✗")} ${picocolors.bold(p.name.padEnd(16))} ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!runProviderChecksOnly) {
    const executorNames = Object.keys(config.executors ?? {});

    console.log(picocolors.cyan("\nAI CLI Executors"));
    console.log(picocolors.dim("─".repeat(60)));

    const header = `${"Name".padEnd(12)}${"Type".padEnd(8)}${"Available".padEnd(10)}${"Input Mode".padEnd(12)}${"Args".padEnd(20)}${"Timeout"}`;
    console.log(`  ${picocolors.bold(header)}`);
    console.log(picocolors.dim(`  ${"─".repeat(72)}`));

    for (const name of executorNames) {
      const entry = config.executors[name]!;
      const inputMode = entry.inputMode ?? "stdin";
      const timeout = entry.timeoutMs ? `${entry.timeoutMs}ms` : "-";
      const argsDisplay = (entry.args ?? []).join(" ") || "-";

      if (entry.type === "shell") {
        const avail = picocolors.green("yes");
        console.log(
          `  ${name.padEnd(12)}${"shell".padEnd(8)}${avail.padEnd(10)}${"-".padEnd(12)}${"-".padEnd(20)}${timeout}`,
        );
        continue;
      }

      const cmdName = entry.command ?? "?";
      try {
        await spawnWithPromise("which", [cmdName], { timeout: 3000 });
        const avail = picocolors.green("yes");
        console.log(
          `  ${name.padEnd(12)}${"command".padEnd(8)}${avail.padEnd(10)}${inputMode.padEnd(12)}${argsDisplay.padEnd(20)}${timeout}`,
        );
      } catch {
        const avail = picocolors.red("no");
        console.log(
          `  ${name.padEnd(12)}${"command".padEnd(8)}${avail.padEnd(10)}${inputMode.padEnd(12)}${argsDisplay.padEnd(20)}${timeout}`,
        );
        const cmdDisplay = entry.command ?? "?";
        console.log(
          `  ${"".padEnd(12)}${picocolors.dim(`Command: ${cmdDisplay} — not found. Install or update config.`)}`,
        );
      }
    }
  }

  console.log("");
}

export async function doctorProvidersCommand(): Promise<void> {
  return doctorCommand({ providers: true });
}
