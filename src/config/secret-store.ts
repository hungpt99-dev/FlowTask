import { homedir } from "node:os";
import path from "node:path";
import { fileExists, atomicWriteJsonFile, readJsonFile, ensureDir } from "../utils/fs.js";

const SECRETS_DIR = ".flowtask";
const SECRETS_FILE = "secrets.json";

function isAllowedSecretsDir(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const allowedBase = path.resolve(homedir(), ".flowtask");
  return resolved.startsWith(allowedBase);
}

export function secretsFilePath(): string {
  const envOverride = process.env.FLOWTASK_SECRETS_PATH;
  if (envOverride) {
    if (!isAllowedSecretsDir(envOverride)) {
      console.warn(
        `[secret-store] WARNING: FLOWTASK_SECRETS_PATH "${envOverride}" is outside ~/.flowtask/. Using default path instead.`,
      );
      return path.join(homedir(), SECRETS_DIR, SECRETS_FILE);
    }
    return envOverride;
  }
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
  private cache: Record<string, string> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    try {
      const exists = await fileExists(this.filePath);
      if (!exists) {
        this.cache = {};
        return this.cache;
      }
      const data = await readJsonFile<Record<string, string>>(this.filePath);
      this.cache = data ?? {};
      return this.cache;
    } catch {
      this.cache = {};
      return this.cache;
    }
  }

  async get(key: string): Promise<string | undefined> {
    const data = await this.load();
    return data[key];
  }

  async set(key: string, value: string): Promise<void> {
    const data = await this.load();
    data[key] = value;
    this.cache = data;
    await ensureDir(path.dirname(this.filePath));
    await atomicWriteJsonFile(this.filePath, data, true, 0o600);
  }

  async remove(key: string): Promise<void> {
    const data = await this.load();
    delete data[key];
    this.cache = data;
    await ensureDir(path.dirname(this.filePath));
    await atomicWriteJsonFile(this.filePath, data, true, 0o600);
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
