import { homedir } from "node:os";
import path from "node:path";
import { fileExists, atomicWriteJsonFile, readJsonFile, ensureDir } from "../utils/fs.js";

const SECRETS_DIR = ".flowtask";
const SECRETS_FILE = "secrets.json";

export function secretsFilePath(): string {
  const envOverride = process.env.FLOWTASK_SECRETS_PATH;
  if (envOverride) return envOverride;
  return path.join(homedir(), SECRETS_DIR, SECRETS_FILE);
}

export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
}

class FileSecretStore implements SecretStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async load(): Promise<Record<string, string>> {
    try {
      const exists = await fileExists(this.filePath);
      if (!exists) return {};
      const data = await readJsonFile<Record<string, string>>(this.filePath);
      return data ?? {};
    } catch {
      return {};
    }
  }

  async get(key: string): Promise<string | undefined> {
    const data = await this.load();
    return data[key];
  }

  async set(key: string, value: string): Promise<void> {
    const data = await this.load();
    data[key] = value;
    await ensureDir(path.dirname(this.filePath));
    await atomicWriteJsonFile(this.filePath, data);
  }

  async remove(key: string): Promise<void> {
    const data = await this.load();
    delete data[key];
    await ensureDir(path.dirname(this.filePath));
    await atomicWriteJsonFile(this.filePath, data);
  }

  async list(): Promise<string[]> {
    const data = await this.load();
    return Object.keys(data);
  }
}

let _instance: SecretStore | undefined;

export function getSecretStore(filePath?: string): SecretStore {
  if (filePath) {
    return new FileSecretStore(filePath);
  }
  if (!_instance) {
    _instance = new FileSecretStore(secretsFilePath());
  }
  return _instance;
}

export function resetSecretStore(): void {
  _instance = undefined;
}

export function credentialRef(providerName: string): string {
  return `flowtask:${providerName}`;
}
