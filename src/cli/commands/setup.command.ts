import picocolors from "picocolors";
import { SETUP_PROVIDERS, SKIP_OPTION } from "../../ai/provider-definitions.js";
import { saveProviderConfig } from "../../ai/provider-service.js";

export async function setupAiCommand(options?: {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}): Promise<void> {
  const rootPath = process.cwd();

  if (options?.provider) {
    await nonInteractiveSetup(
      rootPath,
      options as { provider: string; model?: string; baseUrl?: string; apiKeyEnv?: string },
    );
    return;
  }

  await interactiveSetup(rootPath);
}

async function interactiveSetup(rootPath: string): Promise<void> {
  const m = await import("enquirer");
  const Enquirer = m.default ?? m;
  const enquirer = new (Enquirer as unknown as new () => {
    prompt: (opts: unknown) => Promise<Record<string, unknown>>;
  })();

  console.log(picocolors.cyan("\nFlowTask AI Provider Setup\n"));

  const providerChoice = await enquirer.prompt({
    type: "select",
    name: "provider",
    message: "Choose an AI provider:",
    choices: [
      ...SETUP_PROVIDERS.map((p) => ({
        name: p.name,
        message: p.label,
      })),
      { name: SKIP_OPTION.name, message: SKIP_OPTION.label },
    ],
  });

  const providerName = providerChoice.provider as string;

  if (providerName === SKIP_OPTION.name) {
    console.log(picocolors.yellow("\n  Skipped AI provider setup."));
    console.log(picocolors.dim("  You can configure AI later: flowtask setup ai\n"));
    return;
  }

  const providerDef = SETUP_PROVIDERS.find((p) => p.name === providerName)!;

  let apiKey: string | undefined;
  if (providerDef.needsApiKey) {
    const existingEnv = process.env[providerDef.apiKeyEnv ?? ""];
    if (existingEnv) {
      console.log(picocolors.dim(`  Using ${providerDef.apiKeyEnv} from environment.`));
      apiKey = existingEnv;
    } else {
      const response = await enquirer.prompt({
        type: "password",
        name: "apiKey",
        message: `Enter your ${providerDef.label} API key:`,
      });
      apiKey = response.apiKey as string;
    }
  }

  let baseUrl = providerDef.defaultBaseUrl;
  if (providerDef.needsBaseUrl && !baseUrl) {
    const response = await enquirer.prompt({
      type: "input",
      name: "baseUrl",
      message: "Enter base URL:",
      initial: providerDef.defaultBaseUrl,
    });
    baseUrl = response.baseUrl as string;
  }

  let model = providerDef.defaultModel;
  if (model) {
    const response = await enquirer.prompt({
      type: "input",
      name: "model",
      message: "Default model:",
      initial: model,
    });
    model = response.model as string;
  }

  await saveProviderConfig(rootPath, providerName, providerDef, { apiKey, baseUrl, model });

  console.log(picocolors.green(`\n\u2713 Provider ready.`));
  console.log(picocolors.dim(`  Provider: ${providerName}`));
  console.log(picocolors.dim(`  Model: ${model ?? providerDef.defaultModel ?? "default"}`));
  console.log("");
  console.log(picocolors.cyan("Try:"));
  console.log(picocolors.cyan('  flowtask run "your prompt"'));
  console.log(picocolors.cyan("  flowtask doctor"));
}

async function nonInteractiveSetup(
  rootPath: string,
  options: { provider: string; model?: string; baseUrl?: string; apiKeyEnv?: string },
): Promise<void> {
  const providerDef = SETUP_PROVIDERS.find((p) => p.name === options.provider);
  if (!providerDef) {
    console.log(picocolors.red(`\nUnknown provider: ${options.provider}`));
    console.log(picocolors.cyan("Available providers:"));
    for (const p of SETUP_PROVIDERS) {
      console.log(`  ${p.name} \u2014 ${p.label}`);
    }
    console.log("");
    process.exit(1);
    return;
  }

  let apiKey: string | undefined;
  if (providerDef.needsApiKey && options.apiKeyEnv) {
    apiKey = process.env[options.apiKeyEnv];
    if (apiKey) {
      console.log(picocolors.dim(`  Using ${options.apiKeyEnv} from environment.`));
    } else {
      console.log(picocolors.yellow(`  ${options.apiKeyEnv} not set in environment.`));
    }
  }

  const baseUrl = options.baseUrl ?? providerDef.defaultBaseUrl;
  const model = options.model ?? providerDef.defaultModel;

  await saveProviderConfig(rootPath, options.provider, providerDef, {
    apiKey,
    baseUrl,
    model,
    apiKeyEnv: options.apiKeyEnv,
  });

  console.log(picocolors.green(`\n\u2713 Provider ready.`));
  console.log(picocolors.dim(`  Provider: ${options.provider}`));
  console.log(picocolors.dim(`  Model: ${model ?? providerDef.defaultModel ?? "default"}`));
  console.log("");
  console.log(picocolors.cyan("Try:"));
  console.log(picocolors.cyan('  flowtask run "your prompt"'));
  console.log(picocolors.cyan("  flowtask doctor"));
}

export { SETUP_PROVIDERS } from "../../ai/provider-definitions.js";
export { testProvider, saveProviderConfig } from "../../ai/provider-service.js";

export function listSetupProviders(): void {
  console.log(picocolors.cyan("\nAvailable AI providers:"));
  console.log("");
  for (const p of SETUP_PROVIDERS) {
    const keyReq = p.needsApiKey ? "API key required" : "No API key needed";
    console.log(
      `  ${picocolors.bold(p.name.padEnd(16))} ${p.label.padEnd(20)} ${picocolors.dim(keyReq)}`,
    );
  }
  console.log("");
}
