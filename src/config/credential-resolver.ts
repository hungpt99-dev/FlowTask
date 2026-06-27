import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { credentialRef } from "./secret-store.js";

import type { AiProviderConfig } from "../ai/ai.schema.js";
import { z } from "zod";

const SecretsFileSchema = z.record(z.string());

function secretsFilePath(): string {
  const envOverride = process.env.FLOWTASK_SECRETS_PATH;
  if (envOverride) return envOverride;
  return path.join(homedir(), ".flowtask", "secrets.json");
}

export interface ResolvedCredential {
  apiKey?: string;
  source: "env" | "secret_store" | "no_key";
}

const credentialCache = new Map<string, ResolvedCredential>();

function readSecretSync(key: string): string | undefined {
  try {
    const filePath = secretsFilePath();
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const parsed = SecretsFileSchema.safeParse(data);
    if (!parsed.success) return undefined;
    return parsed.data[key];
  } catch {
    return undefined;
  }
}

export function resolveCredentialSync(
  providerName: string,
  config: AiProviderConfig,
): ResolvedCredential {
  const cacheKey = `${providerName}:${config.apiKeyEnv ?? ""}:${config.apiKeyRef ?? ""}`;
  const cached = credentialCache.get(cacheKey);
  if (cached && cached.source !== "no_key") return cached;
  if (cached && cached.source === "no_key" && !config.apiKeyEnv && !config.apiKeyRef) return cached;

  // 1. Explicit environment variable from config
  if (config.apiKeyEnv) {
    const envVal = process.env[config.apiKeyEnv];
    if (envVal) {
      const result: ResolvedCredential = { apiKey: envVal, source: "env" };
      credentialCache.set(cacheKey, result);
      return result;
    }
  }

  // 2. Secret reference from secure store
  if (config.apiKeyRef) {
    const stored = readSecretSync(config.apiKeyRef);
    if (stored) {
      const result: ResolvedCredential = { apiKey: stored, source: "secret_store" };
      credentialCache.set(cacheKey, result);
      return result;
    }
  }

  // 3. Try the default ref format
  const defaultRef = credentialRef(providerName);
  const stored = readSecretSync(defaultRef);
  if (stored) {
    const result: ResolvedCredential = { apiKey: stored, source: "secret_store" };
    credentialCache.set(cacheKey, result);
    return result;
  }

  // 4. Provider-specific default env var
  const defaultEnvVar = getDefaultEnvVar(providerName, config.type);
  if (defaultEnvVar) {
    const envVal = process.env[defaultEnvVar];
    if (envVal) {
      const result: ResolvedCredential = { apiKey: envVal, source: "env" };
      credentialCache.set(cacheKey, result);
      return result;
    }
  }

  return { apiKey: undefined, source: "no_key" };
}

export async function resolveCredential(
  providerName: string,
  config: AiProviderConfig,
): Promise<ResolvedCredential> {
  return resolveCredentialSync(providerName, config);
}

export function clearCredentialCache(): void {
  credentialCache.clear();
}

export function getDefaultEnvVar(providerName: string, type: string): string | undefined {
  const name = providerName.toLowerCase();

  if (name === "openai" || type === "openai") return "OPENAI_API_KEY";
  if (name === "anthropic" || type === "anthropic") return "ANTHROPIC_API_KEY";
  if (name === "gemini" || type === "gemini") return "GEMINI_API_KEY";
  if (name === "mistral" || type === "mistral") return "MISTRAL_API_KEY";
  if (name === "openrouter") return "OPENROUTER_API_KEY";
  if (name === "deepseek") return "DEEPSEEK_API_KEY";
  if (name === "groq") return "GROQ_API_KEY";
  if (name === "azure-openai" || name === "azure-openai") return "AZURE_OPENAI_API_KEY";

  if (type === "openai") return "OPENAI_API_KEY";

  return undefined;
}
