import { type FlowTaskConfig, FlowTaskConfigSchema } from "../schemas/config.schema.js";
import { fileExists, readJsonFile } from "../utils/fs.js";
import { configJsonPath } from "../utils/paths.js";
import { generateDefaultConfig } from "./default-config.js";

export class ConfigLoader {
  async load(rootPath: string): Promise<FlowTaskConfig> {
    const configPath = configJsonPath(rootPath);
    const exists = await fileExists(configPath);
    if (!exists) {
      return generateDefaultConfig();
    }
    const raw = await readJsonFile<Record<string, unknown>>(configPath);
    const result = FlowTaskConfigSchema.safeParse(raw);
    if (!result.success) {
      return generateDefaultConfig();
    }
    return result.data;
  }

  async save(rootPath: string, config: FlowTaskConfig): Promise<void> {
    const { atomicWriteJsonFile } = await import("../utils/fs.js");
    await atomicWriteJsonFile(configJsonPath(rootPath), config);
  }
}
