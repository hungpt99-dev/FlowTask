import picocolors from "picocolors";
import { ProjectManager } from "../../core/project-manager.js";
import { SETUP_PROVIDERS, SKIP_OPTION } from "../../ai/provider-definitions.js";
import { saveProviderConfig } from "../../ai/provider-service.js";
import { ConfigLoader } from "../../config/config-loader.js";
import { projectNotInitializedError } from "../errors.js";

function maskKey(key: string): string {
  if (key.length <= 8) return key.slice(0, 4) + "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

export async function configureAiCommand(): Promise<void> {
  const rootPath = process.cwd();

  const manager = new ProjectManager();
  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(projectNotInitializedError(rootPath));
    process.exit(0);
  }

  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);

  const m = await import("enquirer");
  const Enquirer = m.default ?? m;
  const enquirer = new (Enquirer as unknown as new () => {
    prompt: (opts: unknown) => Promise<Record<string, unknown>>;
  })();

  console.log(picocolors.cyan("\nFlowTask AI Provider Configuration\n"));

  const providerStatuses = new Map<
    string,
    { envSet: boolean; envValue?: string; configured: boolean }
  >();

  for (const p of SETUP_PROVIDERS) {
    const envValue = p.apiKeyEnv ? process.env[p.apiKeyEnv] : undefined;
    const envSet = !!envValue;
    const configured = !!config.ai?.providers?.[p.name];
    providerStatuses.set(p.name, { envSet, envValue, configured });
  }

  const providerChoices = SETUP_PROVIDERS.map((p) => {
    const status = providerStatuses.get(p.name)!;
    let indicator: string;
    if (status.configured) {
      indicator = picocolors.green("✓");
    } else if (!p.needsApiKey) {
      indicator = picocolors.dim("~");
    } else if (status.envSet) {
      indicator = picocolors.cyan("●");
    } else {
      indicator = picocolors.yellow("!");
    }

    let detail = "";
    if (status.configured) {
      detail = picocolors.dim(" configured");
    } else if (status.envSet && p.apiKeyEnv) {
      detail = picocolors.dim(` ${p.apiKeyEnv}=${maskKey(status.envValue!)}`);
    } else if (!p.needsApiKey) {
      detail = picocolors.dim(" no API key needed");
    } else if (p.apiKeyEnv) {
      detail = picocolors.dim(` ${p.apiKeyEnv} not set`);
    }

    return {
      name: p.name,
      message: `${indicator} ${p.label}${detail}`,
    };
  });

  const skipChoice = { name: SKIP_OPTION.name, message: picocolors.dim("Done — save and exit") };

  const selected = (await enquirer.prompt({
    type: "multiselect",
    name: "providers",
    message: "Select AI providers to configure:",
    choices: [...providerChoices, skipChoice],
    result(this: { selected: Record<string, string> }, names: string) {
      return this.selected ?? names;
    },
  })) as unknown as { providers: string[] };

  const selectedNames = selected.providers ?? [];
  const toConfigure = selectedNames.filter((n: string) => n !== SKIP_OPTION.name);

  if (toConfigure.length === 0) {
    console.log(picocolors.yellow("\n  No providers selected. Configuration unchanged.\n"));
    return;
  }

  for (const providerName of toConfigure) {
    console.log("");
    console.log(picocolors.cyan(`Configuring ${picocolors.bold(providerName)}...`));

    const providerDef = SETUP_PROVIDERS.find((p) => p.name === providerName);
    if (!providerDef) continue;

    const status = providerStatuses.get(providerName)!;

    let apiKey: string | undefined;
    if (providerDef.needsApiKey) {
      if (status.envSet && providerDef.apiKeyEnv) {
        apiKey = process.env[providerDef.apiKeyEnv];
        console.log(picocolors.dim(`  Using ${providerDef.apiKeyEnv} from environment.`));
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
    const existingConfig = config.ai?.providers?.[providerName];
    if (providerDef.needsBaseUrl) {
      const initial = existingConfig?.baseUrl ?? providerDef.defaultBaseUrl ?? "";
      const response = await enquirer.prompt({
        type: "input",
        name: "baseUrl",
        message: `Base URL for ${providerDef.label}:`,
        initial,
      });
      baseUrl = response.baseUrl as string;
    }

    let model = providerDef.defaultModel;
    const currentModel =
      providerDef.name === config.planner?.provider ? config.planner?.model : undefined;
    if (model) {
      const response = await enquirer.prompt({
        type: "input",
        name: "model",
        message: `Default model for ${providerDef.label}:`,
        initial: currentModel ?? model,
      });
      model = response.model as string;
    }

    await saveProviderConfig(rootPath, providerName, providerDef, { apiKey, baseUrl, model });
  }

  console.log(picocolors.green("\n\u2713 AI provider configuration complete.\n"));
  console.log(picocolors.cyan("Run `flowtask doctor` to validate your setup.\n"));
}
