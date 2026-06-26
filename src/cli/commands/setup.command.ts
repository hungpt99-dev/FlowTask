import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { ConfigLoader } from "../../config/config-loader.js";
import { getSecretStore, credentialRef } from "../../config/secret-store.js";
import { ProviderRegistry } from "../../ai/provider-registry.js";
import { mergeProviderConfigs } from "../../ai/provider-presets.js";
import type { AiProviderConfig } from "../../ai/ai.schema.js";
import { fileExists } from "../../utils/fs.js";
import { FLOWTASK_DIR } from "../../utils/paths.js";
import path from "node:path";

const SETUP_PROVIDERS: Array<{
  name: string;
  type: string;
  label: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  allowNoApiKey: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
  apiKeyEnv?: string;
}> = [
  {
    name: "openai",
    type: "openai",
    label: "OpenAI",
    needsApiKey: true,
    needsBaseUrl: false,
    allowNoApiKey: false,
    defaultModel: "gpt-4.1-mini",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    name: "anthropic",
    type: "anthropic",
    label: "Anthropic",
    needsApiKey: true,
    needsBaseUrl: false,
    allowNoApiKey: false,
    defaultModel: "claude-3-5-sonnet-latest",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    name: "gemini",
    type: "gemini",
    label: "Gemini",
    needsApiKey: true,
    needsBaseUrl: false,
    allowNoApiKey: false,
    defaultModel: "gemini-1.5-pro",
    apiKeyEnv: "GEMINI_API_KEY",
  },
  {
    name: "openrouter",
    type: "openai-compatible",
    label: "OpenRouter",
    needsApiKey: true,
    needsBaseUrl: true,
    allowNoApiKey: false,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  {
    name: "deepseek",
    type: "openai-compatible",
    label: "DeepSeek",
    needsApiKey: true,
    needsBaseUrl: true,
    allowNoApiKey: false,
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  {
    name: "groq",
    type: "openai-compatible",
    label: "Groq",
    needsApiKey: true,
    needsBaseUrl: true,
    allowNoApiKey: false,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
  },
  {
    name: "ollama",
    type: "ollama",
    label: "Local Ollama",
    needsApiKey: false,
    needsBaseUrl: false,
    allowNoApiKey: true,
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
  },
  {
    name: "lmstudio",
    type: "openai-compatible",
    label: "LM Studio local",
    needsApiKey: false,
    needsBaseUrl: false,
    allowNoApiKey: true,
    defaultBaseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
  },
];

const SKIP_OPTION = { name: "__skip__", label: "Skip for now" };

export async function setupAiCommand(options?: {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}): Promise<void> {
  const rootPath = process.cwd();

  if (options?.provider) {
    await nonInteractiveSetup(rootPath, {
      provider: options.provider,
      model: options.model,
      baseUrl: options.baseUrl,
      apiKeyEnv: options.apiKeyEnv,
    });
    return;
  }

  await interactiveSetup(rootPath);
}

async function interactiveSetup(rootPath: string): Promise<void> {
  const Enquirer = await import("enquirer").then((m) => m.default ?? m);
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
      console.log(`  ${p.name} — ${p.label}`);
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
}

async function saveProviderConfig(
  rootPath: string,
  providerName: string,
  providerDef: (typeof SETUP_PROVIDERS)[number],
  opts: { apiKey?: string; baseUrl?: string; model?: string; apiKeyEnv?: string },
): Promise<void> {
  const configLoader = new ConfigLoader();
  const config = await configLoader.load(rootPath);

  const secretStore = getSecretStore();

  if (opts.apiKey && !process.env[providerDef.apiKeyEnv ?? ""]) {
    const ref = credentialRef(providerName);
    await secretStore.set(ref, opts.apiKey);
    console.log(picocolors.dim(`  API key saved to secure store.`));
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

  console.log(picocolors.green(`\n✓ ${providerDef.label} configured.`));

  // Test the provider
  console.log(picocolors.cyan(`\nTesting ${providerDef.label}...`));
  await testProvider(providerName);

  console.log(picocolors.green(`\n✓ Provider ready.`));
  console.log(picocolors.dim(`  Provider: ${providerName}`));
  console.log(picocolors.dim(`  Model: ${opts.model ?? providerDef.defaultModel ?? "default"}`));
  console.log("");
  console.log(picocolors.cyan("Try:"));
  console.log(picocolors.cyan('  flowtask run "your prompt"'));
  console.log(picocolors.cyan("  flowtask doctor"));
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
        console.log(picocolors.green(`  ✓ ${result.message}`));
      } else {
        console.log(picocolors.red(`  ✗ ${result.message}`));
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
    console.log(picocolors.red(`  ✗ ${msg}`));
    return { ok: false, message: msg };
  }
}

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
