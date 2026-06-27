import { ConfigLoader } from "../config/config-loader.js";
import { getSecretStore, credentialRef } from "../config/secret-store.js";
import { ProviderRegistry } from "./provider-registry.js";
import type { AiProviderConfig } from "./ai.schema.js";
import type { ProviderDefinition } from "./provider-definitions.js";
import picocolors from "picocolors";

export async function saveProviderConfig(
  rootPath: string,
  providerName: string,
  providerDef: ProviderDefinition,
  opts: { apiKey?: string; baseUrl?: string; model?: string; apiKeyEnv?: string },
): Promise<void> {
  const configLoader = new ConfigLoader();
  const config = await configLoader.load(rootPath);

  const secretStore = getSecretStore();

  if (opts.apiKey && !process.env[providerDef.apiKeyEnv ?? ""]) {
    const ref = credentialRef(providerName);
    await secretStore.set(ref, opts.apiKey);
    console.log(
      picocolors.dim(`  API key saved to local store (plaintext, file permission restricted).`),
    );
  }

  if (!config.ai) config.ai = { providers: {} };
  if (!config.ai.providers) config.ai.providers = {};

  const providerConfig: AiProviderConfig = {
    type: providerDef.type,
    apiKeyRef: opts.apiKey ? credentialRef(providerName) : undefined,
    apiKeyEnv: opts.apiKeyEnv ?? providerDef.apiKeyEnv,
    baseUrl: opts.baseUrl ?? providerDef.defaultBaseUrl,
    allowNoApiKey: providerDef.allowNoApiKey,
  };

  if (opts.model) {
    config.planner = {
      ...(config.planner ?? {}),
      provider: providerName,
      model: opts.model,
    } as typeof config.planner;
  }

  config.ai.providers[providerName] = providerConfig;
  await configLoader.save(rootPath, config);

  console.log(picocolors.green(`\n\u2713 ${providerDef.label} configured.`));
}

export async function testProvider(
  providerName?: string,
  rootPath?: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const loader = new ConfigLoader();
    const config = await loader.load(rootPath ?? process.cwd());
    const registry = new ProviderRegistry(config);

    const provider = registry.getProvider(providerName);

    if (provider.healthCheck) {
      const result = await provider.healthCheck({
        model: config.planner?.model,
        timeoutMs: 10000,
      });

      if (result.ok) {
        console.log(picocolors.green(`  \u2713 ${result.message}`));
      } else {
        console.log(picocolors.red(`  \u2717 ${result.message}`));
        if (result.suggestion) {
          console.log(picocolors.yellow(`  ${result.suggestion}`));
        }
      }

      return { ok: result.ok, message: result.message };
    }

    console.log(picocolors.yellow("  Provider does not support health checks."));
    return { ok: true, message: "no health check available" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(picocolors.red(`  \u2717 ${msg}`));
    return { ok: false, message: msg };
  }
}
