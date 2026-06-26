import picocolors from "picocolors";
import { ConfigLoader } from "../../config/config-loader.js";
import { ProviderRegistry } from "../../ai/provider-registry.js";

export async function listProvidersCommand(): Promise<void> {
  const rootPath = process.cwd();
  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);
  const registry = new ProviderRegistry(config);
  const providers = registry.listProviders();

  console.log(picocolors.cyan("\nConfigured AI Providers"));
  console.log(picocolors.dim("─".repeat(60)));

  if (providers.length === 0) {
    console.log(picocolors.yellow("  No AI providers configured."));
    return;
  }

  for (const p of providers) {
    const status = p.apiKeyAvailable ? picocolors.green("✓") : picocolors.yellow("!");
    const keyStatus = p.apiKeyAvailable
      ? picocolors.dim("key found")
      : picocolors.yellow(`${p.apiKeyEnv ?? "no key"} missing`);
    console.log(
      `  ${status} ${picocolors.bold(p.name.padEnd(20))} ${p.type.padEnd(18)} ${keyStatus}`,
    );
  }

  console.log("");
  console.log(picocolors.dim("  Run `flowtask doctor --providers` for health checks."));
}
