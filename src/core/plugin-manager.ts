import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { FlowTaskError } from "../utils/errors.js";

// ── Capabilities ──────────────────────────────────────

export type PluginCapability =
  | "scanner"
  | "planner-hint"
  | "validator"
  | "artifact-detector"
  | "risk-rule"
  | "command"
  | "template"
  | "output-parser"
  | "context-builder";

// ── Plugin Metadata ───────────────────────────────────

export interface PluginMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: PluginCapability[];
}

// ── Plugin Context ────────────────────────────────────

export interface PluginContext {
  rootPath: string;
  config: FlowTaskConfig;
  pluginConfig?: Record<string, unknown>;
}

// ── Capability Provider Interfaces ────────────────────

export interface ScannerProvider {
  capability: "scanner";
  scan(rootPath: string, prompt?: string): Promise<unknown>;
}

export interface PlannerHintProvider {
  capability: "planner-hint";
  getHints(prompt: string): Promise<string[]>;
}

export interface ValidatorProvider {
  capability: "validator";
  validate(params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ valid: boolean; message?: string }>;
}

export interface ArtifactDetectorProvider {
  capability: "artifact-detector";
  detectArtifacts(params: {
    runId: string;
    taskId?: string;
    stepId?: string;
  }): Promise<{ type: string; path: string; summary: string }[]>;
}

export interface RiskRuleProvider {
  capability: "risk-rule";
  evaluateRisk(command: string): Promise<{ risky: boolean; reason?: string; score: number }>;
}

export interface CommandProvider {
  capability: "command";
  getCommands(): Promise<
    { name: string; description: string; run(args: string[]): Promise<void> }[]
  >;
}

export interface TemplateProvider {
  capability: "template";
  getTemplates(): Promise<{ name: string; description: string; content: unknown }[]>;
}

export interface OutputParserProvider {
  capability: "output-parser";
  parse(output: string, format: string): Promise<unknown>;
}

export interface ContextBuilderProvider {
  capability: "context-builder";
  enrichContext(context: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export type CapabilityProvider =
  | ScannerProvider
  | PlannerHintProvider
  | ValidatorProvider
  | ArtifactDetectorProvider
  | RiskRuleProvider
  | CommandProvider
  | TemplateProvider
  | OutputParserProvider
  | ContextBuilderProvider;

// ── Plugin Registration Descriptor ────────────────────

export interface PluginRegistration {
  meta: PluginMeta;
  instance: Plugin;
}

// ── PluginError ───────────────────────────────────────

export class PluginError extends FlowTaskError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PLUGIN_ERROR", message, details);
    this.name = "PluginError";
  }
}

// ── Base Plugin ───────────────────────────────────────

export abstract class Plugin {
  abstract readonly meta: PluginMeta;

  async init(_context: PluginContext): Promise<void> {}

  async destroy(): Promise<void> {}

  getCapabilityProviders(): CapabilityProvider[] {
    return [];
  }
}

// ── PluginManager ─────────────────────────────────────

export class PluginManager {
  private plugins: Map<string, PluginRegistration> = new Map();
  private context: PluginContext | null = null;
  private initialized = false;

  async initialize(rootPath: string, config: FlowTaskConfig): Promise<void> {
    this.context = { rootPath, config };
    for (const [id, registration] of this.plugins) {
      try {
        await registration.instance.init(this.context);
      } catch (err) {
        throw new PluginError(
          `Failed to initialize plugin "${id}": ${err instanceof Error ? err.message : String(err)}`,
          { pluginId: id },
        );
      }
    }
    this.initialized = true;
  }

  register(plugin: Plugin): void {
    const { id } = plugin.meta;

    if (this.plugins.has(id)) {
      throw new PluginError(`Plugin already registered: "${id}"`, { pluginId: id });
    }

    this.plugins.set(id, { meta: plugin.meta, instance: plugin });
  }

  unregister(pluginId: string): void {
    const registration = this.plugins.get(pluginId);
    if (!registration) {
      throw new PluginError(`Plugin not found: "${pluginId}"`, { pluginId });
    }

    registration.instance.destroy().catch(() => {});
    this.plugins.delete(pluginId);
  }

  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId)?.instance;
  }

  getPluginMeta(pluginId: string): PluginMeta | undefined {
    return this.plugins.get(pluginId)?.meta;
  }

  hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  listPlugins(): PluginMeta[] {
    return Array.from(this.plugins.values()).map((r) => r.meta);
  }

  getPluginsByCapability(capability: PluginCapability): Plugin[] {
    return Array.from(this.plugins.values())
      .filter((r) => r.meta.capabilities.includes(capability))
      .map((r) => r.instance);
  }

  getCapabilityProviders<T extends CapabilityProvider>(capability: T["capability"]): T[] {
    const results: T[] = [];
    for (const [, registration] of this.plugins) {
      if (!registration.meta.capabilities.includes(capability)) continue;
      const providers = registration.instance.getCapabilityProviders();
      for (const provider of providers) {
        if (provider.capability === capability) {
          results.push(provider as T);
        }
      }
    }
    return results;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getContext(): PluginContext | null {
    return this.context;
  }

  async destroyAll(): Promise<void> {
    const errors: string[] = [];
    for (const [id, registration] of this.plugins) {
      try {
        await registration.instance.destroy();
      } catch (err) {
        errors.push(`Plugin "${id}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.plugins.clear();
    this.context = null;
    this.initialized = false;

    if (errors.length > 0) {
      throw new PluginError(`Errors during plugin destruction: ${errors.join("; ")}`);
    }
  }

  async reloadPlugin(pluginId: string, newPlugin?: Plugin): Promise<void> {
    const existing = this.plugins.get(pluginId);
    if (!existing) {
      throw new PluginError(`Plugin not found: "${pluginId}"`, { pluginId });
    }

    await existing.instance.destroy();
    this.plugins.delete(pluginId);

    if (newPlugin) {
      this.register(newPlugin);
      if (this.context && this.initialized) {
        await newPlugin.init(this.context);
      }
    }
  }
}
