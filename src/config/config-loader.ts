import { type FlowTaskConfig, FlowTaskConfigSchema } from "../schemas/config.schema.js";
import { fileExists, readJsonFile } from "../utils/fs.js";
import { configJsonPath } from "../utils/paths.js";
import { generateDefaultConfig } from "./default-config.js";

function migrateConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const executors = raw.executors as Record<string, Record<string, unknown>> | undefined;
  if (!executors) return raw;

  let changed = false;
  for (const [name, entry] of Object.entries(executors)) {
    if (entry.type === "command" && entry.command && typeof entry.command === "string") {
      const cmdStr = entry.command as string;
      const parts = cmdStr.split(/\s+/);
      if (parts.length > 1) {
        console.warn(
          `[warn] Executor "${name}" uses legacy command string "${cmdStr}". Please migrate to command + args.`,
        );
        entry.command = parts[0]!;
        const existingArgs = (entry.args as string[]) ?? [];
        const commandArgs = parts.slice(1);
        entry.args = [...commandArgs, ...existingArgs];
        if (!entry.inputMode) {
          entry.inputMode = "stdin";
        }
        changed = true;
      }
    }
  }

  if (changed) {
    raw.executors = executors as Record<string, unknown>;
  }
  return raw;
}

export class ConfigLoader {
  async load(rootPath: string): Promise<FlowTaskConfig> {
    const configPath = configJsonPath(rootPath);
    const exists = await fileExists(configPath);
    if (!exists) {
      return generateDefaultConfig();
    }
    const raw = await readJsonFile<Record<string, unknown>>(configPath);
    const migrated = migrateConfig(raw);
    const result = FlowTaskConfigSchema.safeParse(migrated);
    if (!result.success) {
      console.warn("Config validation failed, using default config:", result.error.message);
      return generateDefaultConfig();
    }
    return result.data;
  }

  async save(rootPath: string, config: FlowTaskConfig): Promise<void> {
    const { atomicWriteJsonFile } = await import("../utils/fs.js");
    await atomicWriteJsonFile(configJsonPath(rootPath), config);
  }
}
