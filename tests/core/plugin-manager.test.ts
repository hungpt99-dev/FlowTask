import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PluginManager, Plugin, PluginError } from "../../src/core/plugin-manager.js";
import type {
  PluginMeta,
  PluginContext,
  CapabilityProvider,
} from "../../src/core/plugin-manager.js";
import { generateDefaultConfig } from "../../src/config/default-config.js";
import type { FlowTaskConfig } from "../../src/schemas/config.schema.js";

// ── Test Plugin Implementations ───────────────────────

class TestPlugin extends Plugin {
  readonly meta: PluginMeta;
  public initCalled = false;
  public destroyCalled = false;

  constructor(
    id: string,
    capabilities: PluginMeta["capabilities"] = [],
    private context?: PluginContext,
  ) {
    super();
    this.meta = {
      id,
      name: `Test Plugin ${id}`,
      version: "1.0.0",
      description: `Test plugin ${id} for unit tests`,
      capabilities,
    };
  }

  async init(ctx: PluginContext): Promise<void> {
    this.initCalled = true;
    if (this.context) {
      Object.assign(this.context, ctx);
    }
  }

  async destroy(): Promise<void> {
    this.destroyCalled = true;
  }
}

class FailingInitPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: "failing-init",
    name: "Failing Init",
    version: "1.0.0",
    description: "Plugin that fails on init",
    capabilities: [],
  };

  async init(_context: PluginContext): Promise<void> {
    throw new Error("Intentional init failure");
  }
}

class FailingDestroyPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: "failing-destroy",
    name: "Failing Destroy",
    version: "1.0.0",
    description: "Plugin that fails on destroy",
    capabilities: [],
  };

  async destroy(): Promise<void> {
    throw new Error("Intentional destroy failure");
  }
}

class CapabilityPlugin extends Plugin {
  readonly meta: PluginMeta = {
    id: "capability-test",
    name: "Capability Test",
    version: "1.0.0",
    description: "Plugin with capability providers",
    capabilities: ["scanner", "validator"],
  };

  getCapabilityProviders(): CapabilityProvider[] {
    return [
      {
        capability: "scanner" as const,
        async scan(rootPath: string, prompt?: string) {
          return { rootPath, prompt, scanned: true };
        },
      },
      {
        capability: "validator" as const,
        async validate(_params: { runId: string }) {
          return { valid: true, message: "Validated by capability plugin" };
        },
      },
    ];
  }
}

describe("PluginManager", () => {
  let manager: PluginManager;
  let defaultConfig: FlowTaskConfig;

  beforeEach(() => {
    manager = new PluginManager();
    defaultConfig = generateDefaultConfig();
  });

  afterEach(async () => {
    await manager.destroyAll().catch(() => {});
  });

  describe("registration", () => {
    it("should register a plugin", () => {
      const plugin = new TestPlugin("test-1", ["scanner"]);
      manager.register(plugin);
      expect(manager.hasPlugin("test-1")).toBe(true);
    });

    it("should throw PluginError when registering a duplicate plugin id", () => {
      const plugin1 = new TestPlugin("dup", []);
      const plugin2 = new TestPlugin("dup", []);
      manager.register(plugin1);
      expect(() => manager.register(plugin2)).toThrow(PluginError);
      expect(() => manager.register(plugin2)).toThrow(/already registered/i);
    });

    it("should list registered plugins", () => {
      const plugin1 = new TestPlugin("plugin-a", ["scanner"]);
      const plugin2 = new TestPlugin("plugin-b", ["validator"]);
      manager.register(plugin1);
      manager.register(plugin2);
      const list = manager.listPlugins();
      expect(list).toHaveLength(2);
      expect(list.map((m) => m.id)).toEqual(["plugin-a", "plugin-b"]);
    });

    it("should unregister a plugin and call destroy", async () => {
      const plugin = new TestPlugin("to-remove", []);
      manager.register(plugin);
      expect(manager.hasPlugin("to-remove")).toBe(true);

      manager.unregister("to-remove");
      expect(manager.hasPlugin("to-remove")).toBe(false);
      expect(plugin.destroyCalled).toBe(true);
    });

    it("should throw PluginError when unregistering a non-existent plugin", () => {
      expect(() => manager.unregister("nonexistent")).toThrow(PluginError);
    });

    it("should get a plugin by id", () => {
      const plugin = new TestPlugin("get-test", []);
      manager.register(plugin);
      expect(manager.getPlugin("get-test")).toBe(plugin);
    });

    it("should return undefined for unknown plugin id", () => {
      expect(manager.getPlugin("unknown")).toBeUndefined();
    });

    it("should get plugin meta by id", () => {
      const plugin = new TestPlugin("meta-test", ["scanner", "validator"]);
      manager.register(plugin);
      const meta = manager.getPluginMeta("meta-test");
      expect(meta).toBeDefined();
      expect(meta!.id).toBe("meta-test");
      expect(meta!.capabilities).toEqual(["scanner", "validator"]);
    });
  });

  describe("lifecycle", () => {
    it("should initialize plugins", async () => {
      const plugin = new TestPlugin("init-test", []);
      manager.register(plugin);
      await manager.initialize("/tmp/test", defaultConfig);
      expect(plugin.initCalled).toBe(true);
    });

    it("should provide context during initialization", async () => {
      const ctx: Partial<PluginContext> = {};
      const plugin = new TestPlugin("ctx-test", [], ctx as PluginContext);
      manager.register(plugin);
      await manager.initialize("/tmp/test", defaultConfig);
      expect(ctx.rootPath).toBe("/tmp/test");
      expect(ctx.config).toBe(defaultConfig);
    });

    it("should throw PluginError when a plugin fails to init", async () => {
      const plugin = new FailingInitPlugin();
      manager.register(plugin);
      await expect(manager.initialize("/tmp/test", defaultConfig)).rejects.toThrow(PluginError);
      await expect(manager.initialize("/tmp/test", defaultConfig)).rejects.toThrow(/failing-init/);
    });

    it("should track initialization state", async () => {
      expect(manager.isInitialized()).toBe(false);
      const plugin = new TestPlugin("state-test", []);
      manager.register(plugin);
      await manager.initialize("/tmp/test", defaultConfig);
      expect(manager.isInitialized()).toBe(true);
    });

    it("should destroy all plugins", async () => {
      const p1 = new TestPlugin("destroy-1", []);
      const p2 = new TestPlugin("destroy-2", []);
      manager.register(p1);
      manager.register(p2);
      await manager.initialize("/tmp/test", defaultConfig);
      await manager.destroyAll();
      expect(p1.destroyCalled).toBe(true);
      expect(p2.destroyCalled).toBe(true);
      expect(manager.isInitialized()).toBe(false);
      expect(manager.listPlugins()).toHaveLength(0);
    });

    it("should handle destroy errors gracefully", async () => {
      const good = new TestPlugin("good", []);
      const bad = new FailingDestroyPlugin();
      manager.register(good);
      manager.register(bad);
      await manager.initialize("/tmp/test", defaultConfig);

      await expect(manager.destroyAll()).rejects.toThrow(PluginError);
      expect(good.destroyCalled).toBe(true);
      expect(manager.listPlugins()).toHaveLength(0);
    });
  });

  describe("capability querying", () => {
    it("should filter plugins by capability", () => {
      const scanner = new TestPlugin("scanner-1", ["scanner"]);
      const validator = new TestPlugin("validator-1", ["validator"]);
      const both = new TestPlugin("both-1", ["scanner", "validator"]);
      manager.register(scanner);
      manager.register(validator);
      manager.register(both);

      const scanners = manager.getPluginsByCapability("scanner");
      expect(scanners).toHaveLength(2);
      expect(scanners.map((p) => p.meta.id)).toEqual(["scanner-1", "both-1"]);

      const validators = manager.getPluginsByCapability("validator");
      expect(validators).toHaveLength(2);
      expect(validators.map((p) => p.meta.id)).toEqual(["validator-1", "both-1"]);
    });

    it("should get capability providers from plugins", () => {
      const plugin = new CapabilityPlugin();
      manager.register(plugin);

      const scanners = manager.getCapabilityProviders("scanner");
      expect(scanners).toHaveLength(1);
      expect(scanners[0]!.capability).toBe("scanner");

      const validators = manager.getCapabilityProviders("validator");
      expect(validators).toHaveLength(1);

      const planners = manager.getCapabilityProviders("planner-hint");
      expect(planners).toHaveLength(0);
    });
  });

  describe("reload", () => {
    it("should reload a plugin with new instance", async () => {
      const oldPlugin = new TestPlugin("reload-test", []);
      manager.register(oldPlugin);
      await manager.initialize("/tmp/test", defaultConfig);
      expect(oldPlugin.initCalled).toBe(true);

      const newPlugin = new TestPlugin("reload-test", ["scanner"]);
      await manager.reloadPlugin("reload-test", newPlugin);

      expect(manager.hasPlugin("reload-test")).toBe(true);
      expect(manager.getPlugin("reload-test")).toBe(newPlugin);
      expect(newPlugin.meta.capabilities).toContain("scanner");
    });

    it("should throw PluginError when reloading a non-existent plugin", async () => {
      await expect(manager.reloadPlugin("nonexistent")).rejects.toThrow(PluginError);
    });
  });

  describe("context", () => {
    it("should return null context before initialization", () => {
      expect(manager.getContext()).toBeNull();
    });

    it("should return context after initialization", async () => {
      await manager.initialize("/tmp/test-ctx", defaultConfig);
      const ctx = manager.getContext();
      expect(ctx).not.toBeNull();
      expect(ctx!.rootPath).toBe("/tmp/test-ctx");
      expect(ctx!.config).toBe(defaultConfig);
    });
  });
});
