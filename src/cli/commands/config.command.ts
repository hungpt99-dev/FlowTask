import { ProjectManager } from "../../core/project-manager.js";
import { ConfigLoader } from "../../config/config-loader.js";
import picocolors from "picocolors";
import { projectNotInitializedError } from "../errors.js";

const VALID_PATHS = ["approval.autoApprove"] as const;

type ConfigPath = (typeof VALID_PATHS)[number];

function parseConfigPath(raw: string): ConfigPath | null {
  return VALID_PATHS.includes(raw as ConfigPath) ? (raw as ConfigPath) : null;
}

function validateBooleanValue(raw: string): boolean | null {
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return null;
}

function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = path[path.length - 1]!;
  current[lastKey] = value;
}

export async function configSetCommand(key: string, value: string): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(projectNotInitializedError(rootPath));
    process.exit(0);
  }

  const configPath = parseConfigPath(key);
  if (!configPath) {
    console.log(picocolors.red(`Unknown config key: "${key}"`));
    console.log(picocolors.dim(`Valid keys: ${VALID_PATHS.join(", ")}`));
    process.exit(1);
  }

  const boolVal = validateBooleanValue(value);
  if (boolVal === null) {
    console.log(picocolors.red(`Invalid value "${value}". Use "true" or "false".`));
    process.exit(1);
  }

  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);

  const rawConfig = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  setNestedValue(rawConfig, configPath.split("."), boolVal);

  await loader.save(rootPath, rawConfig as Parameters<typeof loader.save>[1]);

  console.log(picocolors.green(`\n✓ Config "${configPath}" set to ${boolVal}`));
  console.log("");
}

export async function configGetCommand(key?: string): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(projectNotInitializedError(rootPath));
    process.exit(0);
  }

  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);

  if (key) {
    const configPath = parseConfigPath(key);
    if (!configPath) {
      console.log(picocolors.red(`Unknown config key: "${key}"`));
      console.log(picocolors.dim(`Valid keys: ${VALID_PATHS.join(", ")}`));
      process.exit(1);
    }
    const parts = key.split(".");
    let value: unknown = config as never;
    for (const part of parts) {
      if (value && typeof value === "object" && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }
    console.log(`${key} = ${picocolors.cyan(String(value))}`);
  } else {
    console.log(picocolors.cyan("\nCurrent configuration:"));
    for (const p of VALID_PATHS) {
      const parts = p.split(".");
      let value: unknown = config as never;
      for (const part of parts) {
        if (value && typeof value === "object" && part in value) {
          value = (value as Record<string, unknown>)[part];
        } else {
          value = undefined;
          break;
        }
      }
      console.log(`  ${p} = ${picocolors.cyan(String(value))}`);
    }
    console.log("");
  }
}

export async function configListCommand(): Promise<void> {
  const rootPath = process.cwd();
  const manager = new ProjectManager();

  const initialized = await manager.isInitialized(rootPath);
  if (!initialized) {
    console.log(projectNotInitializedError(rootPath));
    process.exit(0);
  }

  const loader = new ConfigLoader();
  const config = await loader.load(rootPath);

  console.log(picocolors.cyan("\nConfigurable settings:"));
  for (const p of VALID_PATHS) {
    const parts = p.split(".");
    let value: unknown = config as never;
    for (const part of parts) {
      if (value && typeof value === "object" && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }
    console.log(`  ${p} = ${picocolors.cyan(String(value))}`);
  }
  console.log("");
}
