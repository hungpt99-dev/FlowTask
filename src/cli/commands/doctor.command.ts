import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { ConfigLoader } from "../../config/config-loader.js";
import { spawnWithPromise } from "../../utils/process.js";
import { ProviderRegistry } from "../../ai/provider-registry.js";
import { ResourceGuard } from "../../validation/resource-guard.js";
import { readJsonFile } from "../../utils/fs.js";
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
      process.stdout.write(`  ${picocolors.blue("⋯")} ${check.name}... `);
      const result = await check.run();
      if (result.ok) {
        process.stdout.write(`${picocolors.green("✓")} ${picocolors.dim(result.message)}\n`);
      } else {
        process.stdout.write(`${picocolors.red("✗")} ${picocolors.red(result.message)}\n`);
      }
    }

    const loader = new ConfigLoader();
    const config = await loader.load(rootPath);

    console.log(picocolors.cyan("\nProject Mode"));
    console.log(picocolors.dim("─".repeat(60)));
    const mode = config.projectMode ?? "development";
    console.log(`  Mode: ${picocolors.bold(mode)}`);

    const { fileExists: fe } = await import("../../utils/fs.js");
    const rulesDir = path.join(rootPath, ".flowtask", "rules");
    const stepsDir = path.join(rootPath, ".flowtask", "steps");
    const modeRuleExists = await fe(path.join(rulesDir, "mode.md"));
    const stepsExist = await fe(path.join(stepsDir, "default.md"));
    if (modeRuleExists) {
      console.log(
        `  ${picocolors.green("✓")} Mode rules: ${picocolors.dim(".flowtask/rules/mode.md")}`,
      );
    } else {
      console.log(
        `  ${picocolors.yellow("!")} Mode rules: ${picocolors.dim(".flowtask/rules/mode.md — not found")}`,
      );
    }
    if (stepsExist) {
      console.log(
        `  ${picocolors.green("✓")} Steps: ${picocolors.dim(".flowtask/steps/default.md")}`,
      );
    } else {
      console.log(
        `  ${picocolors.yellow("!")} Steps: ${picocolors.dim(".flowtask/steps/default.md — not found")}`,
      );
    }
    console.log("");

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
    try {
      const provider = providerRegistry.getProvider(p.name);

      if (provider.healthCheck) {
        process.stdout.write(`  ${picocolors.blue("⋯")} ${p.name} (${p.type})... `);
        const healthResult = await provider.healthCheck({
          model: config.planner?.model,
          timeoutMs: 5000,
        });

        if (healthResult.ok) {
          process.stdout.write(
            `${picocolors.green("✓")} ${picocolors.dim(healthResult.message)}\n`,
          );
        } else {
          const icon =
            healthResult.kind === "missing_api_key" ? picocolors.yellow("!") : picocolors.red("✗");
          process.stdout.write(`${icon} ${picocolors.yellow(healthResult.message)}\n`);
          if (healthResult.suggestion) {
            console.log(`  ${"".padEnd(18)}${picocolors.dim(healthResult.suggestion)}`);
          }
        }
      } else {
        const status = p.apiKeyAvailable ? picocolors.green("✓") : picocolors.yellow("!");
        const keyStatus = p.apiKeyAvailable
          ? picocolors.dim("key found")
          : picocolors.yellow(`${p.apiKeyEnv ?? "no key"} missing`);
        console.log(
          `  ${status} ${picocolors.bold(p.name.padEnd(16))} ${p.type.padEnd(18)} ${keyStatus}`,
        );
      }
    } catch (err) {
      console.log(
        `${picocolors.red("✗")} ${picocolors.bold(p.name.padEnd(16))} ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(picocolors.cyan("\nValidation"));
  console.log(picocolors.dim("─".repeat(60)));
  const vc = config.validation ?? {};
  const profile = vc.profile ?? "safe";
  console.log(`  Profile: ${picocolors.bold(profile)}`);
  console.log(`  Concurrency: ${vc.concurrency ?? 1}`);
  console.log(`  Timeout: ${(vc.timeoutMs ?? 300000) / 1000}s`);
  console.log(
    `  ${vc.dedupeCommands !== false ? picocolors.green("✓") : picocolors.yellow("!")} Command deduplication: ${vc.dedupeCommands !== false ? "enabled" : "disabled"}`,
  );
  console.log(
    `  ${vc.resourceGuard !== false ? picocolors.green("✓") : picocolors.yellow("!")} Resource guard: ${vc.resourceGuard !== false ? "enabled" : "disabled"}`,
  );
  console.log(`  ${picocolors.green("✓")} Process tree kill: enabled`);

  const qualityCommands = config.quality?.commands ?? [];
  const resourceGuardCheck = new ResourceGuard(config);
  for (const cmd of qualityCommands) {
    const warnings = resourceGuardCheck.inspect(cmd);
    if (warnings.length > 0) {
      for (const w of warnings) {
        const icon =
          w.severity === "error"
            ? picocolors.red("✗")
            : w.severity === "warning"
              ? picocolors.yellow("!")
              : picocolors.dim("i");
        console.log(`  ${icon} ${w.message}`);
        if (w.suggestion) {
          console.log(`    ${picocolors.dim(`suggestion: ${w.suggestion}`)}`);
        }
      }
    } else {
      console.log(`  ${picocolors.green("✓")} ${cmd}`);
    }
  }

  const vitestConfig = vc.vitest ?? {};
  console.log(picocolors.cyan("\nVitest"));
  console.log(picocolors.dim("─".repeat(60)));

  const hasVitest = await detectVitest(rootPath);
  if (hasVitest) {
    console.log(`  ${picocolors.green("✓")} detected`);
    const maxWorkers = vitestConfig.maxWorkers ?? 1;
    if (maxWorkers <= 1) {
      console.log(`  ${picocolors.green("✓")} safe worker limit configured: ${maxWorkers}`);
    } else {
      console.log(
        `  ${picocolors.yellow("!")} worker limit: ${maxWorkers} — consider reducing to 1`,
      );
    }
  } else {
    console.log(`  ${picocolors.dim("i")} vitest not detected in this project`);
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

export async function doctorValidationCommand(): Promise<void> {
  const rootPath = process.cwd();
  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);
  const resourceGuard = new ResourceGuard(config);

  console.log(picocolors.cyan("\nFlowTask Doctor — Validation"));
  console.log(picocolors.dim("─".repeat(60)));
  console.log("");

  const vc = config.validation ?? {};
  const profile = vc.profile ?? "safe";

  console.log(`  Profile: ${picocolors.bold(profile)}`);
  console.log(
    `  ${vc.dedupeCommands !== false ? picocolors.green("✓") : picocolors.yellow("!")} Deduplication: ${vc.dedupeCommands !== false ? "enabled" : "disabled"}`,
  );
  console.log(
    `  ${vc.resourceGuard !== false ? picocolors.green("✓") : picocolors.yellow("!")} Resource guard: ${vc.resourceGuard !== false ? "enabled" : "disabled"}`,
  );
  console.log(`  ${picocolors.green("✓")} Process tree kill: enabled`);
  console.log(`  Concurrency: ${vc.concurrency ?? 1}`);
  console.log(`  Timeout: ${(vc.timeoutMs ?? 300000) / 1000}s`);

  const qualityCommands = config.quality?.commands ?? [];
  if (qualityCommands.length > 0) {
    console.log(picocolors.cyan("\nQuality Commands"));
    console.log(picocolors.dim("─".repeat(60)));
    for (const cmd of qualityCommands) {
      const warnings = resourceGuard.inspect(cmd);
      if (warnings.length > 0) {
        for (const w of warnings) {
          const icon = w.severity === "warning" ? picocolors.yellow("!") : picocolors.dim("i");
          console.log(
            `  ${icon} ${w.severity === "warning" ? "unconstrained" : "safe"} — ${picocolors.dim(cmd)}`,
          );
          if (w.suggestion) {
            console.log(`    ${picocolors.dim(`suggestion: ${w.suggestion}`)}`);
          }
        }
      } else {
        console.log(`  ${picocolors.green("✓")} ${picocolors.dim(cmd)}`);
      }
    }
  }

  const hasVitest = await detectVitest(rootPath);
  if (hasVitest) {
    const maxWorkers = vc.vitest?.maxWorkers ?? 1;
    console.log(picocolors.cyan("\nVitest"));
    console.log(picocolors.dim("─".repeat(60)));
    console.log(`  ${picocolors.green("✓")} detected`);
    if (maxWorkers <= 1) {
      console.log(`  ${picocolors.green("✓")} safe worker limit: ${maxWorkers}`);
    } else {
      console.log(`  ${picocolors.yellow("!")} worker limit: ${maxWorkers} — consider 1`);
    }
  }

  console.log("");
}

async function detectVitest(rootPath: string): Promise<boolean> {
  try {
    const pkgPath = path.join(rootPath, "package.json");
    const pkg = await readJsonFile<Record<string, unknown>>(pkgPath);
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    return deps?.vitest !== undefined;
  } catch {
    return false;
  }
}

export async function doctorProvidersCommand(): Promise<void> {
  return doctorCommand({ providers: true });
}
