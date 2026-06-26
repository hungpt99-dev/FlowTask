import picocolors from "picocolors";
import { ConfigLoader } from "../../config/config-loader.js";
import { ProviderRegistry } from "../../ai/provider-registry.js";
import { getSecretStore } from "../../config/secret-store.js";
import { setupAiCommand, testProvider, listSetupProviders } from "./setup.command.js";
import { fileExists } from "../../utils/fs.js";
import { FLOWTASK_DIR } from "../../utils/paths.js";
import path from "node:path";

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

export async function currentProviderCommand(): Promise<void> {
  const rootPath = process.cwd();
  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);
  const registry = new ProviderRegistry(config);

  const providerName = config.planner?.provider ?? "openai";
  const model = config.planner?.model ?? "default";

  console.log(picocolors.cyan("\nCurrent AI Provider"));
  console.log(picocolors.dim("─".repeat(60)));

  try {
    const provider = registry.getProvider(providerName);
    console.log(`  Provider: ${picocolors.bold(providerName)}`);
    console.log(`  Type: ${picocolors.dim(provider.type ?? "unknown")}`);
    console.log(`  Model: ${picocolors.bold(model)}`);
    const keyOk = registry.isApiKeyAvailable(providerName);
    console.log(
      `  Credential: ${keyOk ? picocolors.green("available") : picocolors.yellow("missing")}`,
    );
  } catch {
    console.log(picocolors.yellow(`  No provider configured.`));
    console.log(picocolors.dim("  Run: flowtask setup ai"));
  }
  console.log("");
}

export async function testProviderCommand(): Promise<void> {
  const rootPath = process.cwd();
  console.log(picocolors.cyan("\nTesting AI Provider\n"));
  const result = await testProvider(undefined, rootPath);
  console.log("");
  if (result.ok) {
    console.log(picocolors.green("✓ Provider is working."));
  } else {
    console.log(picocolors.yellow("! Provider test failed."));
    console.log(picocolors.dim("  Run: flowtask setup ai"));
  }
}

export async function removeProviderCommand(providerName?: string): Promise<void> {
  const rootPath = process.cwd();
  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);

  const name = providerName ?? config.planner?.provider ?? "openai";

  if (config.ai?.providers?.[name]) {
    delete config.ai.providers[name];
    await loader.save(rootPath, config);
  }

  const store = getSecretStore();
  await store.remove(`flowtask:${name}`);

  console.log(picocolors.green(`\n✓ Provider "${name}" removed.`));
}

export async function configureProviderCommand(): Promise<void> {
  await setupAiCommand();
}
